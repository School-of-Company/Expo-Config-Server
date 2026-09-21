import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deepMerge, ConfigRecord } from './deep-merge';
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
      throw new VaultUnavailableError('VAULT_ADDR or VAULT_TOKEN is not configured');
    }

    let response: Response;
    try {
      response = await fetch(`${vaultAddr}/v1/secret/data/${encodeURIComponent(path)}`, {
        headers: { 'X-Vault-Token': vaultToken },
      });
    } catch (error) {
      throw new VaultUnavailableError(`Failed to reach Vault: ${(error as Error).message}`);
    }

    if (response.status === 404) {
      return {};
    }
    if (!response.ok) {
      throw new VaultUnavailableError(`Vault responded with status ${response.status}`);
    }

    try {
      const body = (await response.json()) as { data?: { data?: ConfigRecord } };
      return body.data?.data ?? {};
    } catch (error) {
      throw new VaultUnavailableError(`Vault returned a malformed response: ${(error as Error).message}`);
    }
  }
}
