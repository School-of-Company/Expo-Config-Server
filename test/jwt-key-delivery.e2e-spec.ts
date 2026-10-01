import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

interface ConfigBody {
  jwt: { privateKey?: string; publicKey?: string };
}

function restoreEnv(key: string, previousValue: string | undefined) {
  if (previousValue === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previousValue;
  }
}

describe('JWT signing key delivery (e2e)', () => {
  let app: INestApplication | undefined;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let fetchSpy: jest.SpyInstance;
  let requestedVaultPaths: string[];

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'jwt-key-e2e-'));
    previousConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = configDir;
    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');

    requestedVaultPaths = [];
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const path = url as string;
      requestedVaultPaths.push(path);
      if (path.endsWith('/secret/data/auth')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: { data: { jwt: { privateKey } } } }),
            { status: 200 },
          ),
        );
      }
      if (path.endsWith('/secret/data/gateway')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: { data: { jwt: { publicKey } } } }),
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

  it('delivers the private key to auth with its PEM newlines intact', async () => {
    const config = await fetchConfig('auth');

    expect(config.jwt.privateKey).toBe(privateKey);
    expect(config.jwt.privateKey).toContain('\n');
    expect(config.jwt.publicKey).toBeUndefined();
  });

  it('delivers only the public key to gateway and never reads the auth secret', async () => {
    const config = await fetchConfig('gateway');

    expect(config.jwt.publicKey).toBe(publicKey);
    expect(config.jwt.privateKey).toBeUndefined();
    expect(
      requestedVaultPaths.some((path) => path.endsWith('/secret/data/auth')),
    ).toBe(false);
  });

  it('delivers a key pair that signs on auth and verifies on gateway (RS256)', async () => {
    const authConfig = await fetchConfig('auth');
    const gatewayConfig = await fetchConfig('gateway');
    const deliveredPrivateKey = authConfig.jwt.privateKey;
    const deliveredPublicKey = gatewayConfig.jwt.publicKey;
    if (deliveredPrivateKey === undefined || deliveredPublicKey === undefined) {
      throw new Error('auth/gateway config did not include the delivered key');
    }
    const signingInput = 'header.payload';

    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(deliveredPrivateKey);
    const verified = createVerify('RSA-SHA256')
      .update(signingInput)
      .verify(deliveredPublicKey, signature);

    expect(verified).toBe(true);
  });
});
