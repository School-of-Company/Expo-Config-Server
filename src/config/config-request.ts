import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigMergeService } from './config-merge.service';
import { ConfigRecord } from './deep-merge';
import { ProfileNotFoundError } from './native-config.provider';
import { VaultUnavailableError } from './vault-config.provider';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * `/configs/...` 와 `/spring/...` 가 같은 검증·오류 규칙을 쓰도록 모아 둔다.
 * - 잘못된 식별자·프로파일 → 400
 * - 프로파일 없음 → 404
 * - Vault 장애 → 503 (빈 설정으로 내려주면 서비스가 비밀 값 없이 기동하므로 실패로 돌려준다)
 * 로그에는 서비스·프로파일과 오류 메시지만 남기고 설정 값은 남기지 않는다.
 */
export async function loadMergedConfig(
  configMergeService: ConfigMergeService,
  logger: Logger,
  service: string,
  profile: string,
): Promise<ConfigRecord> {
  if (!SAFE_SEGMENT.test(service) || !SAFE_SEGMENT.test(profile)) {
    throw new HttpException(
      'Invalid service or profile',
      HttpStatus.BAD_REQUEST,
    );
  }
  try {
    return await configMergeService.getMergedConfig(service, profile);
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
    if (error instanceof VaultUnavailableError) {
      logger.error(
        `Vault unavailable for ${service}/${profile}: ${error.message}`,
      );
      throw new HttpException(
        'Vault is currently unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw error;
  }
}
