import { Injectable } from '@nestjs/common';
import { deepMerge, ConfigRecord } from './deep-merge';
import { NativeConfigProvider } from './native-config.provider';
import { VaultConfigProvider } from './vault-config.provider';

@Injectable()
export class ConfigMergeService {
  constructor(
    private readonly nativeConfigProvider: NativeConfigProvider,
    private readonly vaultConfigProvider: VaultConfigProvider,
  ) {}

  async getMergedConfig(service: string, profile: string): Promise<ConfigRecord> {
    const [native, vault] = await Promise.all([
      this.nativeConfigProvider.load(service, profile),
      this.vaultConfigProvider.load(service),
    ]);
    return deepMerge(native, vault);
  }
}
