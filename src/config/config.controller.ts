import { Controller, Get, HttpException, HttpStatus, Logger, Param } from '@nestjs/common';
import { ConfigMergeService } from './config-merge.service';
import { ProfileNotFoundError } from './native-config.provider';
import { VaultUnavailableError } from './vault-config.provider';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

@Controller('configs')
export class ConfigController {
  private readonly logger = new Logger(ConfigController.name);

  constructor(private readonly configMergeService: ConfigMergeService) {}

  @Get(':service/:profile')
  async getConfig(@Param('service') service: string, @Param('profile') profile: string) {
    if (!SAFE_SEGMENT.test(service) || !SAFE_SEGMENT.test(profile)) {
      throw new HttpException('Invalid service or profile', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.configMergeService.getMergedConfig(service, profile);
    } catch (error) {
      if (error instanceof ProfileNotFoundError) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error instanceof VaultUnavailableError) {
        this.logger.error(`Vault unavailable for ${service}/${profile}: ${error.message}`);
        throw new HttpException('Vault is currently unavailable', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw error;
    }
  }
}
