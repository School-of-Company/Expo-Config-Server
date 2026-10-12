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
});
