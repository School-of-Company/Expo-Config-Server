import { Controller, Get, Logger, Param } from '@nestjs/common';
import { ConfigMergeService } from './config-merge.service';
import { loadMergedConfig } from './config-request';

@Controller('configs')
export class ConfigController {
  private readonly logger = new Logger(ConfigController.name);

  constructor(private readonly configMergeService: ConfigMergeService) {}

  @Get(':service/:profile')
  async getConfig(
    @Param('service') service: string,
    @Param('profile') profile: string,
  ) {
    return loadMergedConfig(
      this.configMergeService,
      this.logger,
      service,
      profile,
    );
  }
}
