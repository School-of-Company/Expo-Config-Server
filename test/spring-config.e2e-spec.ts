import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

function restoreEnv(key: string, previousValue: string | undefined) {
  if (previousValue === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previousValue;
  }
}

describe('Spring Cloud Config API (e2e)', () => {
  let app: INestApplication | undefined;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let fetchSpy: jest.SpyInstance;
  let vaultDown = false;

  const privateKey =
    '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n';

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'spring-config-e2e-'));
    previousConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = configDir;

    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');
    await writeFile(
      join(configDir, 'auth-local.yml'),
      [
        'spring:',
        '  datasource:',
        '    url: jdbc:postgresql://db:5432/expo_user',
        '  data:',
        '    redis:',
        '      port: 6379',
        'eureka:',
        '  client:',
        '    enabled: true',
        'publicPaths:',
        '  - /health',
        '  - POST /auth',
        '',
      ].join('\n'),
    );

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const path = url as string;
      if (vaultDown) {
        return Promise.resolve(new Response('down', { status: 500 }));
      }
      if (path.endsWith('/secret/data/auth')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                data: {
                  jwt: { privateKey },
                  spring: { datasource: { password: 'db-pw' } },
                },
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
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
    restoreEnv('CONFIG_DIR', previousConfigDir);
    await rm(configDir, { recursive: true, force: true });
  });

  it('GET /spring/auth/local returns a Spring Environment with flattened, merged values', async () => {
    const response = await request(app!.getHttpServer()).get(
      '/spring/auth/local',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      name: 'auth',
      profiles: ['local'],
      label: null,
      version: null,
      state: null,
      propertySources: [
        {
          name: 'auth-local',
          source: {
            port: 3000,
            'spring.datasource.url': 'jdbc:postgresql://db:5432/expo_user',
            'spring.datasource.password': 'db-pw',
            'spring.data.redis.port': 6379,
            'eureka.client.enabled': true,
            'publicPaths[0]': '/health',
            'publicPaths[1]': 'POST /auth',
            'jwt.privateKey': privateKey,
          },
        },
      ],
    });
  });

  it('accepts and ignores a label', async () => {
    const withLabel = await request(app!.getHttpServer()).get(
      '/spring/auth/local/main',
    );
    const withoutLabel = await request(app!.getHttpServer()).get(
      '/spring/auth/local',
    );

    expect(withLabel.status).toBe(200);
    expect(withLabel.body).toEqual(withoutLabel.body);
  });

  it('returns 400 for an invalid name or a multi-profile request', async () => {
    expect(
      (await request(app!.getHttpServer()).get('/spring/a..b/local')).status,
    ).toBe(400);
    expect(
      (await request(app!.getHttpServer()).get('/spring/auth/dev,local'))
        .status,
    ).toBe(400);
  });

  it('returns 404 for a missing profile', async () => {
    const response = await request(app!.getHttpServer()).get(
      '/spring/auth/missing-profile',
    );

    expect(response.status).toBe(404);
  });

  it('returns 503 when Vault is unavailable instead of an empty config', async () => {
    vaultDown = true;
    const response = await request(app!.getHttpServer()).get(
      '/spring/auth/local',
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('propertySources');
  });

  it('leaves GET /configs/... as the nested JSON it was', async () => {
    const response = await request(app!.getHttpServer()).get(
      '/configs/auth/local',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      port: 3000,
      spring: {
        datasource: {
          url: 'jdbc:postgresql://db:5432/expo_user',
          password: 'db-pw',
        },
        data: { redis: { port: 6379 } },
      },
      eureka: { client: { enabled: true } },
      publicPaths: ['/health', 'POST /auth'],
      jwt: { privateKey },
    });
  });
});
