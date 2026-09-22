import { ConfigService } from '@nestjs/config';
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
});
