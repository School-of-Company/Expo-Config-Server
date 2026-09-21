import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeConfigProvider, ProfileNotFoundError } from './native-config.provider';

describe('NativeConfigProvider', () => {
  let configDir: string;
  let previousConfigDir: string | undefined;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'native-config-test-'));
    previousConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    process.env.CONFIG_DIR = previousConfigDir;
    await rm(configDir, { recursive: true, force: true });
  });

  it('merges application and service files for a profile', async () => {
    await writeFile(
      join(configDir, 'application-local.yml'),
      'port: 3000\ndb:\n  host: localhost\n',
    );
    await writeFile(join(configDir, 'auth-local.yml'), 'db:\n  password: devpass\n');

    const provider = new NativeConfigProvider();
    const result = await provider.load('auth', 'local');

    expect(result).toEqual({
      port: 3000,
      db: { host: 'localhost', password: 'devpass' },
    });
  });

  it('returns application-only config when the service file does not exist', async () => {
    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');

    const provider = new NativeConfigProvider();
    const result = await provider.load('unknown-service', 'local');

    expect(result).toEqual({ port: 3000 });
  });

  it('throws ProfileNotFoundError when application-{profile}.yml is missing', async () => {
    const provider = new NativeConfigProvider();

    await expect(provider.load('auth', 'missing-profile')).rejects.toThrow(
      ProfileNotFoundError,
    );
  });
});
