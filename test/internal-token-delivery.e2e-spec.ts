import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

type ConfigBody = Record<string, unknown>;

function restoreEnv(key: string, previousValue: string | undefined) {
  if (previousValue === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previousValue;
  }
}

/** docs/internal-token.md 의 서비스별 키 구조 (scripts/seed-internal-tokens.sh 가 넣는 모양) */
function internalTokenSecrets(token: string): Record<string, ConfigBody> {
  return {
    auth: {
      internal: { token },
      clients: { expo: { 'internal-token': token } },
    },
    expo: {
      EXPO_INTERNAL_TOKEN: token,
      expo: {
        standard: { 'internal-token': token },
        training: { 'internal-token': token },
        'delete-internal-token': token,
      },
    },
    apply: { application: { 'internal-token': token } },
    form: { INTERNAL_TOKEN: token, USER_SERVICE_INTERNAL_TOKEN: token },
  };
}

describe('Internal token delivery (e2e)', () => {
  let app: INestApplication | undefined;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let fetchSpy: jest.SpyInstance;
  let requestedVaultPaths: string[];

  const token = randomBytes(32).toString('hex');
  const secrets = internalTokenSecrets(token);

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'internal-token-e2e-'));
    previousConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = configDir;
    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');

    requestedVaultPaths = [];
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const path = url as string;
      requestedVaultPaths.push(path);
      const service = path.split('/secret/data/')[1];
      const secret = service === undefined ? undefined : secrets[service];
      if (secret !== undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { data: secret } }), {
            status: 200,
          }),
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

  beforeEach(() => {
    requestedVaultPaths.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    fetchSpy.mockRestore();
    restoreEnv('CONFIG_DIR', previousConfigDir);
    await rm(configDir, { recursive: true, force: true });
  });

  async function fetchConfig(service: string): Promise<ConfigBody> {
    const response = await request(app!.getHttpServer()).get(
      `/configs/${service}/local`,
    );
    expect(response.status).toBe(200);
    return response.body as ConfigBody;
  }

  it('delivers the same token to every service under its own config key', async () => {
    const auth = await fetchConfig('auth');
    const expo = await fetchConfig('expo');
    const apply = await fetchConfig('apply');
    const form = await fetchConfig('form');

    expect(auth).toMatchObject({
      internal: { token },
      clients: { expo: { 'internal-token': token } },
    });
    expect(expo).toMatchObject({
      EXPO_INTERNAL_TOKEN: token,
      expo: {
        standard: { 'internal-token': token },
        training: { 'internal-token': token },
        'delete-internal-token': token,
      },
    });
    expect(apply).toMatchObject({ application: { 'internal-token': token } });
    expect(form).toMatchObject({
      INTERNAL_TOKEN: token,
      USER_SERVICE_INTERNAL_TOKEN: token,
    });
  });

  it('never delivers the token to the gateway, and the gateway never reads those paths', async () => {
    const gateway = await fetchConfig('gateway');

    expect(JSON.stringify(gateway)).not.toContain(token);
    const tokenPaths = Object.keys(secrets).map(
      (service) => `/secret/data/${service}`,
    );
    expect(
      requestedVaultPaths.some((path) =>
        tokenPaths.some((tokenPath) => path.endsWith(tokenPath)),
      ),
    ).toBe(false);
  });

  it('does not deliver the token to a service without internal calls', async () => {
    const report = await fetchConfig('report');

    expect(JSON.stringify(report)).not.toContain(token);
  });
});
