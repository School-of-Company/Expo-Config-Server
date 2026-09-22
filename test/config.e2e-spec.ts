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

describe('Config API (e2e)', () => {
  let app: INestApplication | undefined;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'config-e2e-'));
    previousConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = configDir;
    // VAULT_ADDR/VAULT_TOKEN are set in test/jest-e2e.setup.ts, before AppModule
    // (and therefore NestConfigModule.forRoot's validation) is ever imported.
    // Setting them here would be too late to affect the frozen validated snapshot.

    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');
    await writeFile(join(configDir, 'auth-local.yml'), 'serviceName: auth\n');

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const path = url as string;
      if (path.endsWith('/secret/data/application')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { data: {} } }), { status: 200 }),
        );
      }
      if (path.endsWith('/secret/data/auth')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: { data: { dbPassword: 'auth-pw' } } }),
            {
              status: 200,
            },
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

  afterAll(async () => {
    await app?.close();
    fetchSpy.mockRestore();
    restoreEnv('CONFIG_DIR', previousConfigDir);
    await rm(configDir, { recursive: true, force: true });
  });

  it('GET /configs/auth/local merges native and vault config', async () => {
    const response = await request(app!.getHttpServer()).get(
      '/configs/auth/local',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      port: 3000,
      serviceName: 'auth',
      dbPassword: 'auth-pw',
    });
  });

  it('GET /configs/auth/missing-profile returns 404', async () => {
    const response = await request(app!.getHttpServer()).get(
      '/configs/auth/missing-profile',
    );

    expect(response.status).toBe(404);
  });
});
