import { VaultConfigProvider, VaultUnavailableError } from './vault-config.provider';

describe('VaultConfigProvider', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.VAULT_ADDR = 'http://vault.local';
    process.env.VAULT_TOKEN = 'test-token';
  });

  afterEach(() => {
    process.env = { ...previousEnv };
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

    const provider = new VaultConfigProvider();
    const result = await provider.load('auth');

    expect(result).toEqual({ jwtSecret: 'common', dbPassword: 'auth-pw' });
  });

  it('treats a 404 path as an empty object, not an error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

    const provider = new VaultConfigProvider();
    const result = await provider.load('unknown-service');

    expect(result).toEqual({});
  });

  it('throws VaultUnavailableError when Vault is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const provider = new VaultConfigProvider();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it('throws VaultUnavailableError when VAULT_ADDR is missing', async () => {
    delete process.env.VAULT_ADDR;

    const provider = new VaultConfigProvider();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it('throws VaultUnavailableError when Vault returns a malformed (non-JSON) body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('not json', { status: 200 }));

    const provider = new VaultConfigProvider();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });
});
