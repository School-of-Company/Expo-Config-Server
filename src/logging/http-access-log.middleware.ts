import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { AppEnv } from '../config/env.validation';

/** 응답이 끝나기 전에 클라이언트가 끊은 요청에 쓰는 상태(nginx 관례). */
const CLIENT_CLOSED_STATUS = 499;
const MAX_PATH_LENGTH = 200;
/** 상태 확인·메트릭·문서처럼 주기적으로 들어와 로그만 늘리는 경로(하위 경로 포함). */
const SKIPPED_PREFIXES = ['/health', '/metrics', '/actuator', '/docs'];

type AccessLogger = Pick<Logger, 'log' | 'warn' | 'error'>;

/**
 * 요청마다 응답이 끝난 시점에 한 줄을 남긴다: `GET /configs/:service/:profile 200 12ms`.
 *
 * 경로는 매칭된 라우트 템플릿을 쓰고, 매칭되지 않았으면 쿼리를 뗀 원문 경로를 쓴다. 응답 본문에는 Vault 비밀이
 * 섞인 설정 값이 실리므로 헤더(Basic 인증)·쿠키·본문은 절대 남기지 않는다. 레벨은 4xx가 WARN, 5xx와 499가 ERROR다.
 */
export function createHttpAccessLogMiddleware(
  logger: AccessLogger = new Logger('HttpAccess'),
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (isSkipped(request.path)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    let logged = false;

    const write = (status: number) => {
      if (logged) return;
      logged = true;
      const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      const message = `${request.method} ${loggablePath(request)} ${status} ${ms}ms`;
      if (status === CLIENT_CLOSED_STATUS || status >= 500) {
        logger.error(message);
      } else if (status >= 400) {
        logger.warn(message);
      } else {
        logger.log(message);
      }
    };

    response.once('finish', () => write(response.statusCode));
    response.once('close', () =>
      write(
        response.writableFinished ? response.statusCode : CLIENT_CLOSED_STATUS,
      ),
    );
    next();
  };
}

function isSkipped(path: string): boolean {
  return SKIPPED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** 라우트 템플릿, 없으면 쿼리를 뗀 원문 경로(길이 제한). */
function loggablePath(request: Request): string {
  const route: unknown = (request.route as { path?: unknown } | undefined)
    ?.path;
  if (typeof route === 'string') {
    return `${request.baseUrl}${route}`;
  }

  const path = request.originalUrl.split('?', 1)[0] ?? '';
  return path.length > MAX_PATH_LENGTH
    ? `${path.slice(0, MAX_PATH_LENGTH)}…`
    : path;
}

/** 라우트보다 먼저 등록해야 하므로 `app.init()`/`listen()` 전에 부른다. `HTTP_ACCESS_LOG_ENABLED=false`면 끈다. */
export function installHttpAccessLog(
  app: Pick<INestApplication, 'get' | 'use'>,
  logger?: AccessLogger,
): void {
  const enabled = app
    .get<ConfigService<AppEnv, true>>(ConfigService)
    .get('HTTP_ACCESS_LOG_ENABLED', { infer: true });
  if (enabled) {
    app.use(createHttpAccessLogMiddleware(logger));
  }
}
