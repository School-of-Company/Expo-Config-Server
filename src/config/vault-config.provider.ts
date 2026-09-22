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

@Injectable()
export class VaultConfigProvider {
  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  async load(service: string): Promise<ConfigRecord> {
    const applicationSecrets = await this.readSecret('application');
    const serviceSecrets = await this.readSecret(service);
    return deepMerge(applicationSecrets, serviceSecrets);
  }

  private async readSecret(path: string): Promise<ConfigRecord> {
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
        'Vault returned a response that could not be parsed as JSON',
      );
    }

    const data = isPlainObject(body) ? body.data : undefined;
    const secretData = isPlainObject(data) ? data.data : undefined;

    if (secretData === undefined) {
      return {};
    }
    if (!isPlainObject(secretData)) {
      throw new VaultUnavailableError(
        'Vault returned a secret payload that was not a JSON object',
      );
    }
    return secretData;
  }
}
