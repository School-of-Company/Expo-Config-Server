import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppEnv } from './env.validation';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * 설정 API(`/configs`, `/spring`) Basic 인증 (#54).
 * 사용자 이름은 서비스 식별자이고, 그 서비스의 설정만 조회할 수 있다. 공용 자격증명 하나로는 한 서비스가
 * 다른 서비스의 Vault 비밀(개인키·DB 비밀번호)까지 읽게 되므로 서비스마다 비밀번호를 따로 둔다.
 * CONFIG_CLIENT_CREDENTIALS 가 없으면 꺼진다 — 소비 서비스가 헤더를 보내도록 먼저 배포한 뒤 켜기 위해서다.
 */
@Injectable()
export class ConfigAuthGuard implements CanActivate {
  private readonly logger = new Logger(ConfigAuthGuard.name);
  private readonly credentials: Record<string, string> | undefined;

  constructor(configService: ConfigService<AppEnv, true>) {
    const credentials: unknown = configService.get(
      'CONFIG_CLIENT_CREDENTIALS',
      { infer: true },
    );
    // 검증을 거치지 않은 값(예: 검증 스냅샷 이후 process.env 에 들어온 원문 문자열)으로 인증을 끄거나 오동작하지 않게 한다.
    if (
      credentials !== undefined &&
      (typeof credentials !== 'object' ||
        credentials === null ||
        Array.isArray(credentials))
    ) {
      throw new Error('CONFIG_CLIENT_CREDENTIALS was not validated');
    }
    this.credentials = credentials as Record<string, string> | undefined;
    if (!this.credentials) {
      this.logger.warn(
        'CONFIG_CLIENT_CREDENTIALS is not set: config API authentication is disabled',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.credentials) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const params = req.params as Record<string, string | undefined>;
    const requested = params.service ?? params.name;
    const caller = this.authenticate(req.headers.authorization);

    if (caller === undefined) {
      http
        .getResponse<Response>()
        .setHeader('WWW-Authenticate', 'Basic realm="config"');
      this.logger.warn(
        `Rejected unauthenticated config request for ${JSON.stringify(requested)}`,
      );
      throw new UnauthorizedException();
    }
    if (caller !== requested) {
      this.logger.warn(
        `Rejected config request from ${caller} for ${JSON.stringify(requested)}`,
      );
      throw new ForbiddenException();
    }
    return true;
  }

  /** 인증된 서비스 식별자, 실패하면 undefined */
  private authenticate(header: string | undefined): string | undefined {
    const match = /^Basic ([A-Za-z0-9+/]+=*)$/i.exec(header ?? '');
    if (!match) return undefined;

    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return undefined;
    const service = decoded.slice(0, separator);
    const expected = Object.hasOwn(this.credentials!, service)
      ? this.credentials![service]
      : undefined;

    // 존재하지 않는 서비스도 같은 비교를 거쳐 응답 시간으로 식별자를 추측하기 어렵게 한다.
    const ok = timingSafeEqual(
      digest(decoded.slice(separator + 1)),
      digest(expected ?? ''),
    );
    return ok && expected !== undefined ? service : undefined;
  }
}
