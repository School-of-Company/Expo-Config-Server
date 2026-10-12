import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  VaultConfigProvider,
  VaultUnavailableError,
} from './vault-config.provider';
import { AppEnv } from './env.validation';

function providerWithVaultConfig(
  overrides: Partial<AppEnv> = {},
): VaultConfigProvider {
  return new VaultConfigProvider(
    new ConfigService<AppEnv, true>({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'test-token',
      ...overrides,
    }),
  );
}

describe('VaultConfigProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('merges application and service secrets, service wins on conflicts', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const path = url as string;
      if (path.endsWith('/secret/data/application')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: { data: { jwtSecret: 'common', dbPassword: 'common-pw' } },
            }),
            { status: 200 },
          ),
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
      return Promise.reject(new Error(`unexpected url: ${path}`));
    });

    const provider = providerWithVaultConfig();
    const result = await provider.load('auth');

    expect(result).toEqual({ jwtSecret: 'common', dbPassword: 'auth-pw' });
  });

  it('treats a 404 path as an empty object, not an error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('not found', { status: 404 }));

    const provider = providerWithVaultConfig();
    const result = await provider.load('unknown-service');

    expect(result).toEqual({});
  });

  it('throws VaultUnavailableError when Vault is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const provider = providerWithVaultConfig();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it('throws VaultUnavailableError when VAULT_ADDR is missing', async () => {
    const provider = providerWithVaultConfig({
      VAULT_ADDR: undefined as unknown as string,
    });

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it('throws VaultUnavailableError when Vault returns a malformed (non-JSON) body', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('not json', { status: 200 }));

    const provider = providerWithVaultConfig();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it('does not leak the raw parse error text into the thrown message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          new Response('<html>gateway error</html>', { status: 200 }),
        ),
      );

    const provider = providerWithVaultConfig();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
    await expect(provider.load('auth')).rejects.not.toThrow(/gateway error/);
  });

  it('throws VaultUnavailableError when Vault secret data is not an object', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { data: 'not-an-object' } }), {
        status: 200,
      }),
    );

    const provider = providerWithVaultConfig();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it.each([
    ['{}', {}],
    ['an unrelated object', { unexpected: true }],
    ['data without data.data', { data: {} }],
    ['data.data: null', { data: { data: null } }],
    ['a JSON array', []],
  ])(
    'throws VaultUnavailableError for a 200 body with %s',
    async (_name, body) => {
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
        );

      const provider = providerWithVaultConfig();

      await expect(provider.load('auth')).rejects.toThrow(
        VaultUnavailableError,
      );
    },
  );

  it('accepts a normal 200 with an empty data.data as an empty secret', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { data: {}, metadata: {} } }), {
          status: 200,
        }),
      ),
    );

    const provider = providerWithVaultConfig();

    await expect(provider.load('auth')).resolves.toEqual({});
  });

  it('treats a deleted latest version (404 with data.data: null) as empty', async () => {
    // Vault 1.20 dev 서버에서 kv delete / destroy 후 실제로 받은 응답 형태
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              data: null,
              metadata: {
                deletion_time: '2026-10-11T23:22:02Z',
                destroyed: false,
              },
            },
          }),
          { status: 404 },
        ),
      ),
    );

    const provider = providerWithVaultConfig();

    await expect(provider.load('auth')).resolves.toEqual({});
  });

  it('falls back to the default timeout when ConfigService returns a raw empty string', async () => {
    // VAULT_TIMEOUT_MS='' 는 검증에서 미설정으로 빠지고, ConfigService 는 그때 process.env 원문을 돌려준다.
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: { data: {} } }), { status: 200 }),
        ),
      );
    const provider = providerWithVaultConfig({
      VAULT_TIMEOUT_MS: '' as unknown as number,
    });

    await expect(provider.load('auth')).resolves.toEqual({});
  });

  describe('timeouts against a loopback Vault stub', () => {
    let server: Server;
    let vaultAddr: string;
    let mode: 'no-headers' | 'stalled-body';

    beforeAll(async () => {
      server = createServer((_req, res) => {
        if (mode === 'stalled-body') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.write('{"data":');
        }
        // 응답을 끝내지 않는다 — Vault 가 연결만 받고 멈춘 상황
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      vaultAddr = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    it.each(['no-headers', 'stalled-body'] as const)(
      'fails with VaultUnavailableError within the limit when Vault hangs (%s)',
      async (hangMode) => {
        mode = hangMode;
        const provider = providerWithVaultConfig({
          VAULT_ADDR: vaultAddr,
          VAULT_TIMEOUT_MS: 200,
        });

        const startedAt = Date.now();
        await expect(provider.load('auth')).rejects.toThrow(
          VaultUnavailableError,
        );
        expect(Date.now() - startedAt).toBeLessThan(2000);
      },
    );
  });
});
