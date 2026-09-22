import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigMergeService } from './config-merge.service';
import { NativeConfigProvider } from './native-config.provider';
import { VaultConfigProvider } from './vault-config.provider';

@Module({
  controllers: [ConfigController],
  providers: [ConfigMergeService, NativeConfigProvider, VaultConfigProvider],
})
export class ConfigModule {}
