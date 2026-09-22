import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { deepMerge, isPlainObject, ConfigRecord } from './deep-merge';
import { AppEnv } from './env.validation';

export class ProfileNotFoundError extends Error {
  constructor(profile: string) {
    super(`Profile not defined: ${profile}`);
    this.name = 'ProfileNotFoundError';
  }
}

@Injectable()
export class NativeConfigProvider {
  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  async load(service: string, profile: string): Promise<ConfigRecord> {
    const applicationConfig = await this.readYaml(
      `application-${profile}.yml`,
      true,
      profile,
    );
    const serviceConfig = await this.readYaml(
      `${service}-${profile}.yml`,
      false,
      profile,
    );
    return deepMerge(applicationConfig, serviceConfig);
  }

  private getConfigDir(): string {
    return (
      this.configService.get('CONFIG_DIR', { infer: true }) ??
      join(process.cwd(), 'configs')
    );
  }

  private async readYaml(
    fileName: string,
    required: boolean,
    profile: string,
  ): Promise<ConfigRecord> {
    let raw: string;
    try {
      raw = await readFile(join(this.getConfigDir(), fileName), 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (required) {
          throw new ProfileNotFoundError(profile);
        }
        return {};
      }
      throw error;
    }

    const parsed: unknown = yaml.load(raw);
    if (parsed === undefined || parsed === null) {
      return {};
    }
    if (!isPlainObject(parsed)) {
      throw new Error(
        `${fileName} must parse to a YAML mapping (object), got ${typeof parsed}`,
      );
    }
    return parsed;
  }
}
