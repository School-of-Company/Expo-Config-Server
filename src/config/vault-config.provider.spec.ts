import { ConfigService } from '@nestjs/config';
import { VaultConfigProvider, VaultUnavailableError } from './vault-config.provider';
import { AppEnv } from './env.validation';

function providerWithVaultConfig(overrides: Partial<AppEnv> = {}): VaultConfigProvider {
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
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/secret/data/application')) {
        return new Response(
          JSON.stringify({ data: { data: { jwtSecret: 'common', dbPassword: 'common-pw' } } }),
          { status: 200 },
        );
      }
      if (path.endsWith('/secret/data/auth')) {
        return new Response(JSON.stringify({ data: { data: { dbPassword: 'auth-pw' } } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected url: ${path}`);
    });

    const provider = providerWithVaultConfig();
    const result = await provider.load('auth');

    expect(result).toEqual({ jwtSecret: 'common', dbPassword: 'auth-pw' });
  });

  it('treats a 404 path as an empty object, not an error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

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
    const provider = providerWithVaultConfig({ VAULT_ADDR: undefined as unknown as string });

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it('throws VaultUnavailableError when Vault returns a malformed (non-JSON) body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('not json', { status: 200 }));

    const provider = providerWithVaultConfig();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });
});
