import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigMergeService } from './config-merge.service';
import { NativeConfigProvider } from './native-config.provider';
import { VaultConfigProvider } from './vault-config.provider';
import { SpringConfigController } from './spring-config.controller';

@Module({
  controllers: [ConfigController, SpringConfigController],
  providers: [ConfigMergeService, NativeConfigProvider, VaultConfigProvider],
})
export class ConfigModule {}
