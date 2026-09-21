import { ConfigMergeService } from './config-merge.service';
import { NativeConfigProvider, ProfileNotFoundError } from './native-config.provider';
import { VaultConfigProvider, VaultUnavailableError } from './vault-config.provider';

describe('ConfigMergeService', () => {
  it('merges native and vault config with vault winning on conflicts', async () => {
    const nativeConfigProvider = {
      load: jest.fn().mockResolvedValue({ port: 3000, db: { host: 'localhost' } }),
    } as unknown as NativeConfigProvider;
    const vaultConfigProvider = {
      load: jest.fn().mockResolvedValue({ db: { password: 'secret' } }),
    } as unknown as VaultConfigProvider;

    const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);
    const result = await service.getMergedConfig('auth', 'local');

    expect(result).toEqual({ port: 3000, db: { host: 'localhost', password: 'secret' } });
  });

  it('propagates ProfileNotFoundError from the native provider', async () => {
    const nativeConfigProvider = {
      load: jest.fn().mockRejectedValue(new ProfileNotFoundError('missing')),
    } as unknown as NativeConfigProvider;
    const vaultConfigProvider = { load: jest.fn() } as unknown as VaultConfigProvider;

    const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);

    await expect(service.getMergedConfig('auth', 'missing')).rejects.toThrow(
      ProfileNotFoundError,
    );
  });

  it('propagates VaultUnavailableError from the vault provider', async () => {
    const nativeConfigProvider = {
      load: jest.fn().mockResolvedValue({}),
    } as unknown as NativeConfigProvider;
    const vaultConfigProvider = {
      load: jest.fn().mockRejectedValue(new VaultUnavailableError('down')),
    } as unknown as VaultConfigProvider;

    const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);

    await expect(service.getMergedConfig('auth', 'local')).rejects.toThrow(
      VaultUnavailableError,
    );
  });
});
