import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(
  process.argv[2],
  'Usage: node scripts/verify-gateway.mjs /path/to/built/Expo-Gateway',
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

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function accessToken() {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ sub: '1', iat, exp: iat + 600 })}`;
  const signature = sign('sha256', Buffer.from(unsigned), createPrivateKey(privateKey));
  return `${unsigned}.${signature.toString('base64url')}`;
}

// Real Config Server (real profile files) -> real Gateway bootstrap -> local stubs.
// Only infrastructure (JWT key, Eureka address) is overridden via the Vault stub.
async function bootStack(t, profile) {
  const hits = [];
  const upstreams = new Map();
  async function upstreamFor(app) {
    if (!upstreams.has(app)) {
      const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const hit = {
          app,
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString(),
          cookie: req.headers.cookie,
        };
        hits.push(hit);
        res.writeHead(req.url.includes('probe=missing') ? 404 : 200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'PARTICIPANT_SESSION=stub; Path=/; HttpOnly; Secure; SameSite=Lax',
        });
        res.end(JSON.stringify(hit));
      });
      t.after(() => close(server));
      upstreams.set(app, listen(server));
    }
    return upstreams.get(app);
  }

  const eureka = createServer(async (req, res) => {
    req.resume();
    if (req.method !== 'GET') {
      res.writeHead(req.method === 'POST' ? 204 : 200).end();
      return;
    }
    const app = decodeURIComponent(req.url.split('/').at(-1)).toUpperCase();
    const port = await upstreamFor(app);
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
              port: { $: port, '@enabled': 'true' },
            },
          ],
        },
      }),
    );
  });
  const eurekaPort = await listen(eureka);
  t.after(() => close(eureka));

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
            jwt: { publicKey },
            eureka: { serviceUrl: `http://127.0.0.1:${eurekaPort}/eureka` },
            // prod docs.requireAuth: Gateway refuses to boot without it. Throwaway test value, not a real secret.
            ...(profile === 'prod' && {
              docs: { basicAuth: { username: 'verify', password: randomUUID() } },
            }),
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
  async function call(method, path, ip, headers = {}) {
    return fetch(`${gatewayUrl}${path}`, {
      method,
      headers: {
        'X-Forwarded-For': ip,
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(['POST', 'PUT', 'PATCH'].includes(method)
        ? { body: JSON.stringify({ probe: 'stub-only' }) }
        : {}),
      signal: AbortSignal.timeout(5000),
    });
  }
  return { config, hits, call };
}

const RATE_LIMIT = {
  ttlSeconds: 60,
  limit: 500,
  survey: { ttlSeconds: 60, limit: 300 },
  sms: { ttlSeconds: 60, limit: 10 },
  participantAuthCode: { ttlSeconds: 600, limit: 50 },
  signin: { ttlSeconds: 600, limit: 10 },
};

for (const profile of ['local', 'dev', 'prod']) {
  test(`${profile}: standard program public list`, { timeout: 30000 }, async (t) => {
    const { hits, call } = await bootStack(t, profile);
    const path = `/standard/program/${randomUUID()}`;
    if (process.env.VERIFY_STANDARD_BASELINE === '1') {
      const response = await call('GET', path, '203.0.113.80');
      assert.equal(response.status, 401);
      await response.arrayBuffer();
      assert.equal(hits.length, 0);
      console.log(`${profile}: before fix GET 401; upstream 0`);
      return;
    }
    for (const url of [path, `${path}?probe=list`, `${path}/`, '/standard/program/123', '/training/program/123']) {
      const response = await call('GET', url, '203.0.113.80');
      assert.equal(response.status, 200, url);
      const hit = await response.json();
      assert.deepEqual([hit.app, hit.method, hit.url], ['EXPO-EXPO-SERVER', 'GET', url]);
    }
    const missing = await call('GET', `${path}?probe=missing`, '203.0.113.80');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).url, `${path}?probe=missing`);
    for (const url of ['/forms/123', '/forms/by-id/123', '/surveys/123']) {
      const response = await call('GET', url, '203.0.113.83');
      assert.equal(response.status, 200, url);
      assert.equal((await response.json()).app, 'EXPO-FORM-SERVER');
    }
    const docs = await call('GET', '/docs', '203.0.113.83');
    assert.equal(docs.status, profile === 'dev' ? 200 : 401);
    await docs.arrayBuffer();
    const before = hits.length;
    const denied = [
      ['POST', path], ['PATCH', path], ['DELETE', path], ['PUT', path], ['HEAD', path], ['OPTIONS', path],
      ['GET', '/standard/123'], ['GET', `${path}/extra`], ['GET', '/standard/program'],
      ['GET', '/standard/program/abc'], ['GET', '/standard/programs/123'],
      ['GET', '/standard/program/123;admin'], ['GET', '/standard/program/123%2Fextra'],
      ['POST', '/standard/123'], ['PATCH', '/standard/123'], ['DELETE', '/standard/123'],
    ];
    for (const [method, url] of denied) {
      const response = await call(method, url, '203.0.113.81');
      assert.equal(response.status, 401, `${method} ${url}`);
      await response.arrayBuffer();
    }
    assert.equal(hits.length, before, 'Protected requests must not reach upstream');
    const authorization = { Authorization: `Bearer ${accessToken()}` };
    for (const [method, url] of [['GET', path], ['GET', '/standard/123'], ['POST', '/standard/123'], ['PATCH', '/standard/123'], ['DELETE', '/standard/123']]) {
      const response = await call(method, url, '203.0.113.82', authorization);
      assert.equal(response.status, 200, `admin ${method} ${url}`);
      const hit = await response.json();
      assert.deepEqual([hit.app, hit.method, hit.url], ['EXPO-EXPO-SERVER', method, url]);
    }
    console.log(`${profile}: public UUID/query/slash/numeric + training 200; upstream 404 preserved; ${denied.length} protected 401 (0 upstream); signed admin 5x200`);
  });

  test(
    `${profile}: real Config Server -> Gateway bootstrap -> SMS stub`,
    { timeout: 30000 },
    async (t) => {
      const { config, hits, call } = await bootStack(t, profile);
      assert.deepEqual(config.rateLimit, RATE_LIMIT);
      assert.equal(config.routing.prefixes['/sms'], 'expo-notification-server');
      assert.deepEqual(
        config.publicPaths.filter((entry) => entry.includes('/sms') && entry !== 'GET /sms/v3/api-docs'),
        ['POST /sms', 'POST /sms/verify', 'GET /sms'],
      );

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
        const hit = await proxied.json();
        assert.deepEqual(
          { app: hit.app, method: hit.method, url: hit.url, body: hit.body },
          {
            app: 'EXPO-NOTIFICATION-SERVER',
            method,
            url: path,
            body: method === 'POST' ? JSON.stringify({ probe: 'stub-only' }) : '',
          },
        );
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

  test(
    `${profile}: real Config Server -> Gateway bootstrap -> participant auth / application stubs`,
    { timeout: 30000 },
    async (t) => {
      const { config, hits, call } = await bootStack(t, profile);
      assert.deepEqual(config.rateLimit, RATE_LIMIT);
      assert.equal(config.cors, undefined);

      const expo = randomUUID();
      const opened = [
        ['USER', 'POST', '/participant-auth/code'],
        ['USER', 'POST', '/participant-auth/verify'],
        ['USER', 'GET', '/participant-auth/session'],
        ['USER', 'DELETE', '/participant-auth/session'],
        ['APPLICATION', 'POST', `/application/${expo}`],
        ['APPLICATION', 'POST', `/application/pre-standard/${expo}`],
        ['APPLICATION', 'POST', `/application/field/${expo}`],
        ['APPLICATION', 'POST', `/application/field/standard/${expo}`],
        ['APPLICATION', 'GET', `/application/expos/${expo}/preregister-sessions/7/capacity`],
        ['APPLICATION', 'GET', '/application/program-session-csrf'],
        ['APPLICATION', 'POST', `/application/expos/${expo}/program-sessions/STANDARD/3/applications`],
        ['APPLICATION', 'POST', `/application/expos/${expo}/program-sessions/TRAINING/3/applications`],
        ['APPLICATION', 'GET', `/application/expos/${expo}/program-sessions/TRAINING/3/participants`],
        ['APPLICATION', 'GET', `/application/expos/${expo}/participants/12/qr`],
        ['APPLICATION', 'GET', `/application/expos/${expo}/my-applications`],
        ['APPLICATION', 'POST', `/application/expos/${expo}/my-applications/PREREGISTER/42/cancellation`],
        ['APPLICATION', 'POST', `/application/expos/${expo}/my-applications/TRAINING/${randomUUID()}/cancellation`],
        ['APPLICATION', 'GET', `/application/expos/${expo}/my-applications/preregister-waitlist`],
        ['APPLICATION', 'POST', `/application/expos/${expo}/my-applications/preregister-waitlist/cancellation`],
      ];
      for (const [service, method, path] of opened) {
        const response = await call(method, path, '203.0.113.30', {
          Cookie: 'PARTICIPANT_SESSION=probe',
        });
        assert.equal(response.status, 200, `${method} ${path}`);
        assert.match(response.headers.get('set-cookie') ?? '', /^PARTICIPANT_SESSION=stub; Path=\/; HttpOnly/);
        const hit = await response.json();
        assert.deepEqual(
          { app: hit.app, method: hit.method, url: hit.url, cookie: hit.cookie },
          { app: `EXPO-${service}-SERVER`, method, url: path, cookie: 'PARTICIPANT_SESSION=probe' },
        );
      }

      const before = hits.length;
      // Wrong method, non-id word, unlisted enum value, extra/missing segment, sibling path: still JWT-protected.
      const denied = [
        ['GET', '/participant-auth/code'],
        ['PUT', '/participant-auth/session'],
        ['POST', '/participant-auth/admin'],
        ['POST', '/application/admin'],
        ['GET', `/application/${expo}`],
        ['DELETE', `/application/${expo}`],
        ['POST', `/application/field/${expo}/extra`],
        ['GET', '/application'],
        ['GET', `/application/expos/${expo}/program-sessions/OTHER/3/participants`],
        ['POST', `/application/expos/${expo}/program-sessions/STANDARD/abc/applications`],
        ['POST', `/application/expos/${expo}/my-applications/FOO/42/cancellation`],
        ['DELETE', `/application/expos/${expo}/my-applications/PREREGISTER/42/cancellation`],
        ['POST', `/application/expos/${expo}/my-applications/preregister-waitlist`],
        ['GET', `/application/expos/${expo}/my-applications/preregister-waitlist/cancellation`],
        ['GET', `/application/expos/${expo}/participants/12`],
        ['GET', '/participant'],
        ['GET', '/expo'],
      ];
      for (const [method, path] of denied) {
        const response = await call(method, path, '203.0.113.31');
        assert.equal(response.status, 401, `${method} ${path}`);
        await response.arrayBuffer();
      }
      // /internal is never routed: 401 without a JWT, 404 with a valid one, never forwarded.
      const bearer = { Authorization: `Bearer ${accessToken()}` };
      for (const path of ['/internal/users', '/participant-auth/internal/x', '/application/internal/x', '/application/%69nternal/x']) {
        const anonymous = await call('GET', path, '203.0.113.31');
        assert.equal(anonymous.status, 401, `anonymous ${path}`);
        await anonymous.arrayBuffer();
        const authed = await call('GET', path, '203.0.113.31', bearer);
        assert.equal(authed.status, 404, `authed ${path}`);
        await authed.arrayBuffer();
      }
      assert.equal(hits.length, before, 'Denied requests must not reach upstream');
      const protectedOk = await call('GET', '/expo', '203.0.113.31', bearer);
      assert.equal(protectedOk.status, 200, 'JWT-protected route still proxies');
      assert.equal((await protectedOk.json()).app, 'EXPO-EXPO-SERVER');

      // POST /participant-auth/code: 50 per IP per 600s (#92), counted across exact/encoded/trailing-slash variants.
      // The 6th request (blocked under the old 5) now passes; the 51st, in any variant, never reaches User.
      const codePaths = ['/participant-auth/code', '/participant-auth/%63ode', '/participant-auth/code/'];
      const codeHits = () => hits.filter((hit) => hit.method === 'POST' && codePaths.includes(hit.url)).length;
      const codeBefore = codeHits();
      // %63ode is not a public path (401) but still spends the same per-IP budget as exact/trailing-slash.
      for (let i = 0; i < 50; i += 1) {
        const path = codePaths[i % codePaths.length];
        const response = await call('POST', path, '203.0.113.40');
        if (path === '/participant-auth/code') {
          assert.equal(response.status, 200, `code request ${i + 1}`);
          assert.equal((await response.json()).app, 'EXPO-USER-SERVER');
        } else {
          assert.notEqual(response.status, 429, `code request ${i + 1} ${path}`);
          await response.arrayBuffer();
        }
      }
      const codeAllowed = codeHits() - codeBefore;
      for (const path of codePaths) {
        const limited = await call('POST', path, '203.0.113.40');
        assert.equal(limited.status, 429, path);
        assert.ok(Number(limited.headers.get('retry-after-participantauthcode')) > 0);
        await limited.arrayBuffer();
      }
      assert.equal(codeHits() - codeBefore, codeAllowed, 'Limited code requests must not reach upstream');
      for (const [method, path, ip] of [
        ['POST', '/participant-auth/code', '203.0.113.41'],
        ['POST', '/participant-auth/verify', '203.0.113.40'],
        ['POST', '/sms', '203.0.113.40'],
        ['POST', `/application/${expo}`, '203.0.113.40'],
      ]) {
        const adjacent = await call(method, path, ip);
        assert.equal(adjacent.status, 200, `${method} ${path} (${ip})`);
        await adjacent.arrayBuffer();
      }
      console.log(
        `${profile}: ${opened.length} public 200 (user/application, cookies passed); ${denied.length} denied 401 + 4 internal 401/404 (0 upstream); JWT route 200; code budget 50 shared by exact/trailing-slash (200, ${codeAllowed} reached User) and %63ode (401) + 51st 429 in all 3 variants; other IP/verify/sms/application 200`,
      );
    },
  );

  test(
    `${profile}: real Config Server -> Gateway bootstrap -> survey answer stubs`,
    { timeout: 30000 },
    async (t) => {
      const { config, hits, call } = await bootStack(t, profile);
      assert.deepEqual(config.rateLimit, RATE_LIMIT);

      // Participant satisfaction survey submit (#100): Form checks the respondent by phone number.
      const expo = randomUUID();
      const opened = [
        `/surveys/answer/standard/${expo}`,
        `/surveys/answer/trainee/${expo}`,
        `/surveys/answer/trainee/${expo}/`,
      ];
      for (const path of opened) {
        const response = await call('POST', path, '203.0.113.50');
        assert.equal(response.status, 200, `POST ${path} (upstream hits ${hits.length})`);
        const hit = await response.json();
        assert.deepEqual(
          { app: hit.app, method: hit.method, url: hit.url, body: hit.body },
          { app: 'EXPO-FORM-SERVER', method: 'POST', url: path, body: JSON.stringify({ probe: 'stub-only' }) },
        );
      }
      const before = hits.length;
      const denied = [
        ['GET', `/surveys/answer/standard/${expo}`],
        ['PUT', `/surveys/answer/standard/${expo}`],
        ['PATCH', `/surveys/answer/trainee/${expo}`],
        ['DELETE', `/surveys/answer/trainee/${expo}`],
        ['POST', '/surveys/answer/standard/abc'],
        ['POST', '/surveys/answer/standard/..%2Fpublic'],
        ['POST', `/surveys/answer/standard/${expo}/extra`],
        ['POST', `/surveys/answer/other/${expo}`],
        ['POST', '/surveys/answer/standard'],
        ['POST', `/surveys/answer/${expo}`],
        ['POST', `/surveys/${expo}`],
        ['PATCH', `/surveys/${expo}`],
        ['DELETE', `/surveys/${expo}/1`],
        ['POST', '/surveys'],
        ['GET', `/surveys/lottery/${expo}`],
      ];
      for (const [method, path] of denied) {
        const response = await call(method, path, '203.0.113.51');
        assert.equal(response.status, 401, `${method} ${path}`);
        await response.arrayBuffer();
      }
      assert.equal(hits.length, before, 'Denied requests must not reach upstream');

      // rateLimit.survey (300/60s per IP) covers only POST /surveys/answer/public/*: once it is spent,
      // standard/trainee submits from the same IP still pass, bounded only by the 500/60s default.
      for (let i = 0; i < RATE_LIMIT.survey.limit; i += 1) {
        const response = await call('POST', `/surveys/answer/public/${expo}`, '203.0.113.52');
        assert.equal(response.status, 200, `public survey submit ${i + 1}`);
        await response.arrayBuffer();
      }
      const limited = await call('POST', `/surveys/answer/public/${expo}`, '203.0.113.52');
      assert.equal(limited.status, 429);
      await limited.arrayBuffer();
      const unbudgeted = await call('POST', `/surveys/answer/standard/${expo}`, '203.0.113.52');
      assert.equal(unbudgeted.status, 200, 'standard submit is outside rateLimit.survey');
      await unbudgeted.arrayBuffer();
      console.log(
        `${profile}: ${opened.length} survey submits 200 (Form stub); ${denied.length} denied 401 (0 upstream); public survey budget 300 + 301st 429, standard submit after it 200`,
      );
    },
  );

  test(
    `${profile}: real Config Server -> Gateway bootstrap -> application page-view stub`,
    { timeout: 30000 },
    async (t) => {
      const { config, hits, call } = await bootStack(t, profile);
      assert.deepEqual(config.rateLimit, RATE_LIMIT);

      // Anonymous PV/UV record (#101): Application permits it without login or CSRF.
      const expo = randomUUID();
      for (const path of [`/application/expos/${expo}/page-views`, `/application/expos/${expo}/page-views/`]) {
        const response = await call('POST', path, '203.0.113.60');
        assert.equal(response.status, 200, `POST ${path} (upstream hits ${hits.length})`);
        const hit = await response.json();
        assert.deepEqual(
          { app: hit.app, method: hit.method, url: hit.url, body: hit.body },
          { app: 'EXPO-APPLICATION-SERVER', method: 'POST', url: path, body: JSON.stringify({ probe: 'stub-only' }) },
        );
      }
      const before = hits.length;
      const denied = [
        ['GET', `/application/admin/expos/${expo}/page-views`],
        ['POST', `/application/admin/expos/${expo}/page-views`],
        ['GET', `/application/expos/${expo}/page-views`],
        ['PUT', `/application/expos/${expo}/page-views`],
        ['PATCH', `/application/expos/${expo}/page-views`],
        ['DELETE', `/application/expos/${expo}/page-views`],
        ['POST', '/application/expos/abc/page-views'],
        ['POST', `/application/expos/${expo}/page-views/extra`],
        ['POST', `/application/expos/${expo}/page-view`],
        ['POST', '/application/expos/page-views'],
      ];
      for (const [method, path] of denied) {
        const response = await call(method, path, '203.0.113.61');
        assert.equal(response.status, 401, `${method} ${path}`);
        await response.arrayBuffer();
      }
      assert.equal(hits.length, before, 'Denied requests must not reach upstream');
      console.log(`${profile}: 2 page-view records 200 (Application stub); ${denied.length} denied 401 (0 upstream)`);
    },
  );

  test(
    `${profile}: real Config Server -> Gateway bootstrap -> expo preregister session list stub`,
    { timeout: 30000 },
    async (t) => {
      const { config, hits, call } = await bootStack(t, profile);
      assert.deepEqual(config.rateLimit, RATE_LIMIT);

      // Participant session list (Expo-Expo-Server#118): Expo permits only this path without login.
      const expo = randomUUID();
      const path = `/expo/${expo}/preregister-sessions/public`;
      const response = await call('GET', path, '203.0.113.70');
      assert.equal(response.status, 200, `GET ${path} (upstream hits ${hits.length})`);
      const hit = await response.json();
      assert.deepEqual({ app: hit.app, method: hit.method, url: hit.url }, { app: 'EXPO-EXPO-SERVER', method: 'GET', url: path });
      const before = hits.length;
      const denied = [
        ['GET', `/expo/${expo}/preregister-sessions`],
        ['GET', `/expo/${expo}/preregister-sessions/7`],
        ['POST', `/expo/${expo}/preregister-sessions/public`],
        ['PATCH', `/expo/${expo}/preregister-sessions/public`],
        ['DELETE', `/expo/${expo}/preregister-sessions/public`],
        ['GET', `/expo/${expo}/preregister-sessions/public/extra`],
        ['GET', '/expo/abc/preregister-sessions/public'],
        ['GET', `/expo/${expo}`],
        ['GET', '/expo'],
      ];
      for (const [method, deniedPath] of denied) {
        const deniedResponse = await call(method, deniedPath, '203.0.113.71');
        assert.equal(deniedResponse.status, 401, `${method} ${deniedPath}`);
        await deniedResponse.arrayBuffer();
      }
      assert.equal(hits.length, before, 'Denied requests must not reach upstream');
      console.log(`${profile}: preregister session list 200 (Expo stub); ${denied.length} denied 401 (0 upstream)`);
    },
  );

  test(
    `${profile}: real Config Server -> Gateway bootstrap -> signin IP limit`,
    { timeout: 30000 },
    async (t) => {
      const { config, hits, call } = await bootStack(t, profile);
      assert.deepEqual(config.rateLimit, RATE_LIMIT);

      // POST /auth/signin only (#83): 10 per IP per 600s, then 429 without reaching User.
      const { limit } = RATE_LIMIT.signin;
      for (let i = 0; i < limit; i += 1) {
        const response = await call('POST', '/auth/signin', '203.0.113.90');
        assert.equal(response.status, 200, `signin #${i + 1} (upstream hits ${hits.length})`);
        const hit = await response.json();
        assert.deepEqual([hit.app, hit.method, hit.url], ['EXPO-USER-SERVER', 'POST', '/auth/signin']);
      }
      const before = hits.length;
      for (const path of ['/auth/signin', '/auth/signin/', '/auth/%73ignin']) {
        const response = await call('POST', path, '203.0.113.90');
        assert.equal(response.status, 429, `POST ${path} after ${limit}`);
        await response.arrayBuffer();
      }
      assert.equal(hits.length, before, 'Throttled signin must not reach upstream');

      // Another IP still signs in; other auth paths on the throttled IP only see the base limit.
      for (const [method, path, ip] of [
        ['POST', '/auth/signin', '203.0.113.91'],
        ['PATCH', '/auth', '203.0.113.90'],
      ]) {
        const response = await call(method, path, ip);
        assert.equal(response.status, 200, `${method} ${path} from ${ip}`);
        await response.arrayBuffer();
      }
      console.log(`${profile}: signin ${limit} x 200, then 429 x 3 (0 upstream); other IP and PATCH /auth 200`);
    },
  );
}
