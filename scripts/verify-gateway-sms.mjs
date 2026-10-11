import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(
  process.argv[2],
  'Usage: node scripts/verify-gateway-sms.mjs /path/to/built/Expo-Gateway',
);
const gatewayDir = resolve(process.argv[2]);

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.kill('SIGTERM');
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

async function startApp(t, options) {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  t.after(() => stop(child));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'App exited before listening');
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      await response.arrayBuffer();
      return url;
    } catch (error) {
      if (!(error instanceof TypeError) || error.cause?.code !== 'ECONNREFUSED')
        throw error;
      await delay(25);
    }
  }
  throw new Error('App did not listen within 15 seconds');
}

for (const profile of ['local', 'dev', 'prod']) {
  test(
    `${profile}: real Config Server -> Gateway bootstrap -> SMS stub`,
    { timeout: 30000 },
    async (t) => {
      const hits = [];
      const upstream = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const hit = {
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString(),
        };
        hits.push(hit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(hit));
      });
      const upstreamPort = await listen(upstream);
      t.after(() => close(upstream));

      const lookups = [];
      const eureka = createServer((req, res) => {
        req.resume();
        if (req.method !== 'GET') {
          res.writeHead(req.method === 'POST' ? 204 : 200).end();
          return;
        }
        const app = decodeURIComponent(req.url.split('/').at(-1)).toUpperCase();
        lookups.push(app);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            application: {
              name: app,
              instance: [
                {
                  instanceId: `stub-${app}`,
                  app,
                  hostName: '127.0.0.1',
                  ipAddr: '127.0.0.1',
                  status: 'UP',
                  port: { $: upstreamPort, '@enabled': 'true' },
                },
              ],
            },
          }),
        );
      });
      const eurekaPort = await listen(eureka);
      t.after(() => close(eureka));

      // Override only infrastructure; SMS policies and routing come from the real profile files.
      const vault = createServer((req, res) => {
        if (req.url !== '/v1/secret/data/gateway') {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: {
              data: {
                jwt: { publicKey: 'unused-by-tokenless-test' },
                eureka: { serviceUrl: `http://127.0.0.1:${eurekaPort}/eureka` },
              },
            },
          }),
        );
      });
      const vaultPort = await listen(vault);
      t.after(() => close(vault));
      const configUrl = await startApp(t, {
        cwd: root,
        env: {
          CONFIG_DIR: resolve(root, 'configs'),
          VAULT_ADDR: `http://127.0.0.1:${vaultPort}`,
          VAULT_TOKEN: randomUUID(),
        },
      });
      const response = await fetch(`${configUrl}/configs/gateway/${profile}`);
      assert.equal(response.status, 200);
      const config = await response.json();
      assert.deepEqual(config.rateLimit, {
        ttlSeconds: 60,
        limit: 500,
        survey: { ttlSeconds: 60, limit: 300 },
        sms: { ttlSeconds: 60, limit: 10 },
      });
      assert.equal(config.routing.prefixes['/sms'], 'expo-notification-server');
      assert.deepEqual(
        config.publicPaths.filter((entry) => entry.includes('/sms')),
        ['POST /sms', 'POST /sms/verify', 'GET /sms'],
      );

      const gatewayUrl = await startApp(t, {
        cwd: gatewayDir,
        env: {
          CONFIG_SERVER_URL: configUrl,
          PROFILE: profile,
          INSTANCE_HOSTNAME: '127.0.0.1',
          INSTANCE_IP_ADDR: '127.0.0.1',
          METRICS_ENABLED: 'false',
        },
      });
      async function call(method, path, ip) {
        return fetch(`${gatewayUrl}${path}`, {
          method,
          headers: {
            'X-Forwarded-For': ip,
            'Content-Type': 'application/json',
          },
          ...(method === 'POST'
            ? { body: JSON.stringify({ probe: 'stub-only' }) }
            : {}),
          signal: AbortSignal.timeout(5000),
        });
      }
      const denied = [
        ['PUT', '/sms'],
        ['PATCH', '/sms'],
        ['DELETE', '/sms'],
        ['HEAD', '/sms'],
        ['OPTIONS', '/sms'],
        ['GET', '/sms/verify'],
        ['POST', '/sms/admin'],
        ['POST', '/sms/verify/more'],
        ['POST', '/sms-other'],
      ];
      for (const [method, path] of denied) {
        const deniedResponse = await call(method, path, '203.0.113.20');
        assert.equal(deniedResponse.status, 401, `${method} ${path}`);
        await deniedResponse.arrayBuffer();
      }
      assert.equal(hits.length, 0, 'Denied requests must not reach upstream');
      const allowed = [
        ['POST', '/sms'],
        ['POST', '/sms/verify'],
        ['GET', '/sms?probe=stub'],
      ];
      for (let i = 0; i < 10; i += 1) {
        const [method, path] = allowed[i % allowed.length];
        const proxied = await call(method, path, '203.0.113.10');
        assert.equal(proxied.status, 200, `SMS request ${i + 1}`);
        assert.deepEqual(await proxied.json(), {
          method,
          url: path,
          body: method === 'POST' ? JSON.stringify({ probe: 'stub-only' }) : '',
        });
      }
      const limited = await call('POST', '/sms', '203.0.113.10');
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after-sms')) > 0);
      await limited.arrayBuffer();
      assert.equal(
        hits.length,
        10,
        'The eleventh request must not reach upstream',
      );
      assert.ok(lookups.includes('EXPO-NOTIFICATION-SERVER'));
      for (const [method, path, ip] of [
        ['POST', '/sms/verify/', '203.0.113.11'],
        ['POST', '/auth', '203.0.113.10'],
        ['POST', '/surveys/answer/public/probe', '203.0.113.10'],
      ]) {
        const adjacent = await call(method, path, ip);
        assert.equal(adjacent.status, 200, `${method} ${path} (${ip})`);
        await adjacent.arrayBuffer();
      }
      console.log(
        `${profile}: config 200; 9 denied 401 (0 upstream); mixed SMS 10x200 + 11th 429 (10 upstream); other IP/auth/survey 200`,
      );
    },
  );
}
