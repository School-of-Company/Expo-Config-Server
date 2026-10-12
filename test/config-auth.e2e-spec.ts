import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAVED_ENV_KEYS = ['CONFIG_DIR', 'CONFIG_CLIENT_CREDENTIALS'];
const SECRET = 'auth-db-password';

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const AUTH = basic('auth', 'auth-pw');
const GATEWAY = basic('gateway', 'gateway-pw');

describe('Config API authentication (e2e)', () => {
  let app: INestApplication | undefined;
  let configDir: string;
  let fetchSpy: jest.SpyInstance;
  let vaultDown = false;
  const savedEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'config-auth-e2e-'));
    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');
    await writeFile(join(configDir, 'auth-local.yml'), 'serviceName: auth\n');

    for (const key of SAVED_ENV_KEYS) savedEnv.set(key, process.env[key]);
    process.env.CONFIG_DIR = configDir;
    process.env.CONFIG_CLIENT_CREDENTIALS = JSON.stringify({
      auth: 'auth-pw',
      gateway: 'gateway-pw',
    });

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (vaultDown) {
        return Promise.resolve(new Response('down', { status: 500 }));
      }
      const data = (url as string).endsWith('/secret/data/auth')
        ? { dbPassword: SECRET }
        : {};
      return Promise.resolve(
        new Response(JSON.stringify({ data: { data } }), { status: 200 }),
      );
    });

    // env 를 바꾼 뒤에 import 해야 NestConfigModule 의 검증 스냅샷에 반영된다 (architecture.md 참고).
    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(() => {
    vaultDown = false;
  });

  afterAll(async () => {
    await app?.close();
    fetchSpy.mockRestore();
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(configDir, { recursive: true, force: true });
  });

  const PATHS = [
    '/configs/auth/local',
    '/spring/auth/local',
    '/spring/auth/local/main',
  ];

  describe.each([
    ['no Authorization header', undefined],
    ['a wrong password', basic('auth', 'wrong')],
    ['an unknown service user', basic('nobody', 'auth-pw')],
    ['an empty password', basic('auth', '')],
    ['a non-Basic scheme', 'Bearer auth-pw'],
    [
      'a header without a colon',
      `Basic ${Buffer.from('auth').toString('base64')}`,
    ],
  ])('with %s', (_name, header) => {
    it.each(PATHS)('GET %s → 401 without config values', async (path) => {
      const req = request(app!.getHttpServer()).get(path);
      const response = await (header ? req.set('Authorization', header) : req);

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Basic realm="config"');
      expect(response.text).not.toContain(SECRET);
      expect(response.text).not.toContain('serviceName');
    });
  });

  it.each(PATHS)(
    'GET %s with another service’s credentials → 403 without config values',
    async (path) => {
      const response = await request(app!.getHttpServer())
        .get(path)
        .set('Authorization', GATEWAY);

      expect(response.status).toBe(403);
      expect(response.text).not.toContain(SECRET);
    },
  );

  it('serves the merged nested config to the owning service', async () => {
    const response = await request(app!.getHttpServer())
      .get('/configs/auth/local')
      .set('Authorization', AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      port: 3000,
      serviceName: 'auth',
      dbPassword: SECRET,
    });
  });

  it.each(['/spring/auth/local', '/spring/auth/local/main'])(
    'serves the Spring Environment at %s to the owning service',
    async (path) => {
      const response = await request(app!.getHttpServer())
        .get(path)
        .set('Authorization', AUTH);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'auth',
        propertySources: [
          {
            name: 'auth-local',
            source: { port: 3000, serviceName: 'auth', dbPassword: SECRET },
          },
        ],
      });
    },
  );

  it.each([
    ['/configs/auth/bad.profile', 400],
    ['/spring/auth/bad.profile', 400],
    ['/configs/auth/missing', 404],
    ['/spring/auth/missing', 404],
  ])(
    'keeps the error contract for an authenticated %s → %p',
    async (path, status) => {
      const response = await request(app!.getHttpServer())
        .get(path)
        .set('Authorization', AUTH);

      expect(response.status).toBe(status);
    },
  );

  it.each(['/configs/auth/local', '/spring/auth/local'])(
    'keeps 503 for an authenticated %s when Vault is down',
    async (path) => {
      vaultDown = true;
      const response = await request(app!.getHttpServer())
        .get(path)
        .set('Authorization', AUTH);

      expect(response.status).toBe(503);
    },
  );
});
