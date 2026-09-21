import { Injectable } from '@nestjs/common';
import { deepMerge, ConfigRecord } from './deep-merge';

export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultUnavailableError';
  }
}

@Injectable()
export class VaultConfigProvider {
  async load(service: string): Promise<ConfigRecord> {
    const applicationSecrets = await this.readSecret('application');
    const serviceSecrets = await this.readSecret(service);
    return deepMerge(applicationSecrets, serviceSecrets);
  }

  private async readSecret(path: string): Promise<ConfigRecord> {
    const vaultAddr = process.env.VAULT_ADDR;
    const vaultToken = process.env.VAULT_TOKEN;

    if (!vaultAddr || !vaultToken) {
      throw new VaultUnavailableError('VAULT_ADDR or VAULT_TOKEN is not configured');
    }

    let response: Response;
    try {
      response = await fetch(`${vaultAddr}/v1/secret/data/${path}`, {
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

    const body = (await response.json()) as { data?: { data?: ConfigRecord } };
    return body.data?.data ?? {};
  }
}
