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
      VAULT_TIMEOUT_MS: undefined,
    });
  });

  it('omits CONFIG_DIR when not provided', () => {
    const result = validateEnv({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
    });

    expect(result).toEqual({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
      CONFIG_DIR: undefined,
      VAULT_TIMEOUT_MS: undefined,
    });
  });

  it('throws when VAULT_ADDR is missing', () => {
    expect(() => validateEnv({ VAULT_TOKEN: 'token' })).toThrow('VAULT_ADDR');
  });

  it('throws when VAULT_TOKEN is missing', () => {
    expect(() => validateEnv({ VAULT_ADDR: 'http://vault.local' })).toThrow(
      'VAULT_TOKEN',
    );
  });

  it('throws when VAULT_ADDR is an empty string', () => {
    expect(() => validateEnv({ VAULT_ADDR: '', VAULT_TOKEN: 'token' })).toThrow(
      'VAULT_ADDR',
    );
  });

  it('parses VAULT_TIMEOUT_MS as a number', () => {
    const result = validateEnv({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
      VAULT_TIMEOUT_MS: '1500',
    });

    expect(result.VAULT_TIMEOUT_MS).toBe(1500);
  });

  it.each(['0', '-1', '1.5', 'abc', '2147483648', '10000000000'])(
    'throws when VAULT_TIMEOUT_MS is %p',
    (value) => {
      expect(() =>
        validateEnv({
          VAULT_ADDR: 'http://vault.local',
          VAULT_TOKEN: 'token',
          VAULT_TIMEOUT_MS: value,
        }),
      ).toThrow('VAULT_TIMEOUT_MS');
    },
  );

  it('treats an empty VAULT_TIMEOUT_MS as unset', () => {
    expect(
      validateEnv({
        VAULT_ADDR: 'http://vault.local',
        VAULT_TOKEN: 'token',
        VAULT_TIMEOUT_MS: '',
      }).VAULT_TIMEOUT_MS,
    ).toBeUndefined();
  });
});
