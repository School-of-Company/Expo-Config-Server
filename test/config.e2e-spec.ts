import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

describe('Config API (e2e)', () => {
  let app: INestApplication;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let previousVaultAddr: string | undefined;
  let previousVaultToken: string | undefined;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'config-e2e-'));
    previousConfigDir = process.env.CONFIG_DIR;
    previousVaultAddr = process.env.VAULT_ADDR;
    previousVaultToken = process.env.VAULT_TOKEN;
    process.env.CONFIG_DIR = configDir;
    process.env.VAULT_ADDR = 'http://vault.local';
    process.env.VAULT_TOKEN = 'test-token';

    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');
    await writeFile(join(configDir, 'auth-local.yml'), 'serviceName: auth\n');

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/secret/data/application')) {
        return new Response(JSON.stringify({ data: { data: {} } }), { status: 200 });
      }
      if (path.endsWith('/secret/data/auth')) {
        return new Response(JSON.stringify({ data: { data: { dbPassword: 'auth-pw' } } }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
    process.env.CONFIG_DIR = previousConfigDir;
    process.env.VAULT_ADDR = previousVaultAddr;
    process.env.VAULT_TOKEN = previousVaultToken;
    await rm(configDir, { recursive: true, force: true });
  });

  it('GET /configs/auth/local merges native and vault config', async () => {
    const response = await request(app.getHttpServer()).get('/configs/auth/local');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      port: 3000,
      serviceName: 'auth',
      dbPassword: 'auth-pw',
    });
  });

  it('GET /configs/auth/missing-profile returns 404', async () => {
    const response = await request(app.getHttpServer()).get('/configs/auth/missing-profile');

    expect(response.status).toBe(404);
  });
});
