import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deepMerge, isPlainObject, ConfigRecord } from './deep-merge';
import { AppEnv } from './env.validation';

export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultUnavailableError';
  }
}

const DEFAULT_TIMEOUT_MS = 5000;

@Injectable()
export class VaultConfigProvider {
  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  async load(service: string): Promise<ConfigRecord> {
    // 두 경로 조회 전체(헤더 + 본문)에 하나의 기한을 둔다. 소비 서비스는 부팅 중 이 응답을 기다린다.
    // 검증 스냅샷에 값이 없으면 ConfigService 가 process.env 원문(예: '')을 돌려주므로 숫자일 때만 쓴다.
    const timeoutMs: unknown = this.configService.get('VAULT_TIMEOUT_MS', {
      infer: true,
    });
    const signal = AbortSignal.timeout(
      typeof timeoutMs === 'number' ? timeoutMs : DEFAULT_TIMEOUT_MS,
    );
    const applicationSecrets = await this.readSecret('application', signal);
    const serviceSecrets = await this.readSecret(service, signal);
    return deepMerge(applicationSecrets, serviceSecrets);
  }

  private async readSecret(
    path: string,
    signal: AbortSignal,
  ): Promise<ConfigRecord> {
    const vaultAddr = this.configService.get('VAULT_ADDR', { infer: true });
    const vaultToken = this.configService.get('VAULT_TOKEN', { infer: true });

    if (!vaultAddr || !vaultToken) {
      throw new VaultUnavailableError(
        'VAULT_ADDR or VAULT_TOKEN is not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(
        `${vaultAddr}/v1/secret/data/${encodeURIComponent(path)}`,
        {
          headers: { 'X-Vault-Token': vaultToken },
          signal,
        },
      );
    } catch (error) {
      throw new VaultUnavailableError(
        `Failed to reach Vault: ${(error as Error).message}`,
      );
    }

    if (response.status === 404) {
      return {};
    }
    if (!response.ok) {
      throw new VaultUnavailableError(
        `Vault responded with status ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new VaultUnavailableError(
        signal.aborted
          ? 'Timed out reading the Vault response body'
          : 'Vault returned a response that could not be read or parsed as JSON',
      );
    }

    // KV v2 의 200 은 항상 data.data 객체를 담는다 (빈 시크릿은 {}). 삭제·파기된 버전은 200 이 아니라
    // 404 로 오므로 위에서 빈 설정이 된다. 그 밖의 200 은 비밀 값을 잃은 채 기동시키지 않도록 실패로 본다.
    const data = isPlainObject(body) ? body.data : undefined;
    const secretData = isPlainObject(data) ? data.data : undefined;

    if (!isPlainObject(secretData)) {
      throw new VaultUnavailableError(
        'Vault returned a 200 response without a KV v2 data.data object',
      );
    }
    return secretData;
  }
}
