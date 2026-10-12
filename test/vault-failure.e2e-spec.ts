import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAVED_ENV_KEYS = ['CONFIG_DIR', 'VAULT_ADDR', 'VAULT_TIMEOUT_MS'];

type VaultBehavior = (res: ServerResponse) => void;

const kv2 =
  (data: unknown): VaultBehavior =>
  (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { data, metadata: { version: 1 } } }));
  };

// 실제 HTTP 로 붙는 loopback Vault stub. global.fetch 를 mock 하지 않아 헤더·본문 대기까지 그대로 탄다.
describe('Vault failures over HTTP (e2e)', () => {
  let app: INestApplication | undefined;
  let vault: Server;
  let configDir: string;
  let behavior: VaultBehavior;
  const savedEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    vault = createServer((_req, res) => behavior(res));
    await new Promise<void>((resolve) => vault.listen(0, '127.0.0.1', resolve));

    configDir = await mkdtemp(join(tmpdir(), 'vault-failure-e2e-'));
    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');

    for (const key of SAVED_ENV_KEYS) savedEnv.set(key, process.env[key]);
    process.env.CONFIG_DIR = configDir;
    process.env.VAULT_ADDR = `http://127.0.0.1:${(vault.address() as AddressInfo).port}`;
    process.env.VAULT_TIMEOUT_MS = '300';

    // env 를 바꾼 뒤에 import 해야 NestConfigModule 의 검증 스냅샷에 반영된다 (architecture.md 참고).
    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    vault.closeAllConnections();
    await new Promise((resolve) => vault.close(resolve));
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(configDir, { recursive: true, force: true });
  });

  it('serves the merged config when the stub answers normally', async () => {
    behavior = kv2({ dbPassword: 'pw' });

    const response = await request(app!.getHttpServer()).get(
      '/configs/auth/local',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ port: 3000, dbPassword: 'pw' });
  });

  describe.each([
    ['Vault accepts the connection but never sends headers', () => undefined],
    [
      'Vault sends headers but the JSON body stalls',
      (res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"data":');
      },
    ],
  ])('when %s', (_name, hang: VaultBehavior) => {
    it.each(['/configs/auth/local', '/spring/auth/local'])(
      'GET %s returns 503 within the limit',
      async (path) => {
        behavior = hang;

        const startedAt = Date.now();
        const response = await request(app!.getHttpServer()).get(path);

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
          message: 'Vault is currently unavailable',
        });
        expect(Date.now() - startedAt).toBeLessThan(2000);
      },
    );
  });
  describe.each([
    ['{}', {}],
    ['{"unexpected":true}', { unexpected: true }],
    ['{"data":{}}', { data: {} }],
  ])('when Vault answers 200 with %s', (_name, body) => {
    it.each(['/configs/auth/local', '/spring/auth/local'])(
      'GET %s returns 503 instead of a native-only config',
      async (path) => {
        behavior = (res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };

        const response = await request(app!.getHttpServer()).get(path);

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
          message: 'Vault is currently unavailable',
        });
      },
    );
  });

  it('keeps an empty data.data and a 404 path as a normal empty secret', async () => {
    behavior = kv2({});
    const empty = await request(app!.getHttpServer()).get(
      '/configs/auth/local',
    );
    behavior = (res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"errors":[]}');
    };
    const missing = await request(app!.getHttpServer()).get(
      '/spring/auth/local',
    );

    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ port: 3000 });
    expect(missing.status).toBe(200);
    const { propertySources } = missing.body as {
      propertySources: { source: unknown }[];
    };
    expect(propertySources[0].source).toEqual({ port: 3000 });
  });
});
