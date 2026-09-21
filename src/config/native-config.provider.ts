import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { deepMerge, ConfigRecord } from './deep-merge';

export class ProfileNotFoundError extends Error {
  constructor(profile: string) {
    super(`Profile not defined: ${profile}`);
    this.name = 'ProfileNotFoundError';
  }
}

@Injectable()
export class NativeConfigProvider {
  async load(service: string, profile: string): Promise<ConfigRecord> {
    const applicationConfig = await this.readYaml(`application-${profile}.yml`, true, profile);
    const serviceConfig = await this.readYaml(`${service}-${profile}.yml`, false, profile);
    return deepMerge(applicationConfig, serviceConfig);
  }

  private getConfigDir(): string {
    return process.env.CONFIG_DIR ?? join(process.cwd(), 'configs');
  }

  private async readYaml(
    fileName: string,
    required: boolean,
    profile: string,
  ): Promise<ConfigRecord> {
    try {
      const raw = await readFile(join(this.getConfigDir(), fileName), 'utf-8');
      return (yaml.load(raw) as ConfigRecord) ?? {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (required) {
          throw new ProfileNotFoundError(profile);
        }
        return {};
      }
      throw error;
    }
  }
}
