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
      CONFIG_CLIENT_CREDENTIALS: undefined,
      VAULT_TIMEOUT_MS: undefined,
      HTTP_ACCESS_LOG_ENABLED: true,
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
      CONFIG_CLIENT_CREDENTIALS: undefined,
      VAULT_TIMEOUT_MS: undefined,
      HTTP_ACCESS_LOG_ENABLED: true,
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

  it('parses CONFIG_CLIENT_CREDENTIALS as a service → password map', () => {
    const result = validateEnv({
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'token',
      CONFIG_CLIENT_CREDENTIALS: '{"gateway":"pw-1","notification":"pw-2"}',
    });

    expect(result.CONFIG_CLIENT_CREDENTIALS).toEqual({
      gateway: 'pw-1',
      notification: 'pw-2',
    });
  });

  it.each([
    'not json pw-secret',
    '{}',
    '[]',
    '{"gateway":""}',
    '{"gateway":1}',
    '{"../auth":"pw"}',
  ])('rejects CONFIG_CLIENT_CREDENTIALS %p without echoing it', (value) => {
    expect(() =>
      validateEnv({
        VAULT_ADDR: 'http://vault.local',
        VAULT_TOKEN: 'token',
        CONFIG_CLIENT_CREDENTIALS: value,
      }),
    ).toThrow(/^CONFIG_CLIENT_CREDENTIALS must be/);
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

  it.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['false', false],
    [' FALSE ', false],
  ])('HTTP_ACCESS_LOG_ENABLED %p → %p', (value, expected) => {
    expect(
      validateEnv({
        VAULT_ADDR: 'http://vault.local',
        VAULT_TOKEN: 'token',
        HTTP_ACCESS_LOG_ENABLED: value,
      }).HTTP_ACCESS_LOG_ENABLED,
    ).toBe(expected);
  });
});
