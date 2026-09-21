import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('returns validated config when required vars are present', () => {
    const result = validateEnv({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
      CONFIG_DIR: '/tmp/configs',
    });

    expect(result).toEqual({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
      CONFIG_DIR: '/tmp/configs',
    });
  });

  it('omits CONFIG_DIR when not provided', () => {
    const result = validateEnv({ VAULT_ADDR: 'http://vault.local', VAULT_TOKEN: 'token' });

    expect(result).toEqual({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
      CONFIG_DIR: undefined,
    });
  });

  it('throws when VAULT_ADDR is missing', () => {
    expect(() => validateEnv({ VAULT_TOKEN: 'token' })).toThrow('VAULT_ADDR');
  });

  it('throws when VAULT_TOKEN is missing', () => {
    expect(() => validateEnv({ VAULT_ADDR: 'http://vault.local' })).toThrow('VAULT_TOKEN');
  });

  it('throws when VAULT_ADDR is an empty string', () => {
    expect(() => validateEnv({ VAULT_ADDR: '', VAULT_TOKEN: 'token' })).toThrow('VAULT_ADDR');
  });
});
