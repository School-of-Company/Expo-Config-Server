import { Controller, Get, HttpException, HttpStatus, Param } from '@nestjs/common';
import { ConfigMergeService } from './config-merge.service';
import { ProfileNotFoundError } from './native-config.provider';
import { VaultUnavailableError } from './vault-config.provider';

@Controller('configs')
export class ConfigController {
  constructor(private readonly configMergeService: ConfigMergeService) {}

  @Get(':service/:profile')
  async getConfig(@Param('service') service: string, @Param('profile') profile: string) {
    try {
      return await this.configMergeService.getMergedConfig(service, profile);
    } catch (error) {
      if (error instanceof ProfileNotFoundError) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error instanceof VaultUnavailableError) {
        throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw error;
    }
  }
}
