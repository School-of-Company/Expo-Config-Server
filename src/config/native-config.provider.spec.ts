import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { NativeConfigProvider, ProfileNotFoundError } from './native-config.provider';
import { AppEnv } from './env.validation';

function providerWithConfigDir(configDir: string): NativeConfigProvider {
  return new NativeConfigProvider(
    new ConfigService<AppEnv, true>({
      CONFIG_DIR: configDir,
      VAULT_ADDR: 'http://vault.local',
      VAULT_TOKEN: 'test-token',
    }),
  );
}

describe('NativeConfigProvider', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'native-config-test-'));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it('merges application and service files for a profile', async () => {
    await writeFile(
      join(configDir, 'application-local.yml'),
      'port: 3000\ndb:\n  host: localhost\n',
    );
    await writeFile(join(configDir, 'auth-local.yml'), 'db:\n  password: devpass\n');

    const provider = providerWithConfigDir(configDir);
    const result = await provider.load('auth', 'local');

    expect(result).toEqual({
      port: 3000,
      db: { host: 'localhost', password: 'devpass' },
    });
  });

  it('returns application-only config when the service file does not exist', async () => {
    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');

    const provider = providerWithConfigDir(configDir);
    const result = await provider.load('unknown-service', 'local');

    expect(result).toEqual({ port: 3000 });
  });

  it('throws ProfileNotFoundError when application-{profile}.yml is missing', async () => {
    const provider = providerWithConfigDir(configDir);

    await expect(provider.load('auth', 'missing-profile')).rejects.toThrow(
      ProfileNotFoundError,
    );
  });

  it('throws when application-{profile}.yml does not parse to an object', async () => {
    await writeFile(join(configDir, 'application-local.yml'), '- a\n- b\n');

    const provider = providerWithConfigDir(configDir);

    await expect(provider.load('auth', 'local')).rejects.toThrow(
      /must parse to a YAML mapping/,
    );
  });
});
