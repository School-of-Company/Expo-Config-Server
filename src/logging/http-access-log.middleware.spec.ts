import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import {
  createHttpAccessLogMiddleware,
  installHttpAccessLog,
} from './http-access-log.middleware';

type FakeResponse = EventEmitter & {
  statusCode: number;
  writableFinished: boolean;
};

const setup = (request: Partial<Request>) => {
  const logger = {
    log: jest.fn<void, [string]>(),
    warn: jest.fn<void, [string]>(),
    error: jest.fn<void, [string]>(),
  };
  // Express의 Response는 Node 스트림(EventEmitter)이라 같은 이벤트 모델로 흉내 낸다.
  const response: FakeResponse = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
  });
  const next = jest.fn();
  createHttpAccessLogMiddleware(logger)(
    {
      method: 'GET',
      path: '/configs/auth/prod',
      originalUrl: '/configs/auth/prod',
      baseUrl: '',
      ...request,
    } as Request,
    response as unknown as Response,
    next,
  );
  return { logger, response, next };
};

const ROUTE = { path: '/configs/:service/:profile' };

describe('createHttpAccessLogMiddleware', () => {
  it('응답이 끝나면 라우트 템플릿·상태·시간을 한 번만 남긴다', () => {
    const { logger, response, next } = setup({ route: ROUTE });

    response.writableFinished = true;
    response.emit('finish');
    response.emit('close');

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0][0]).toMatch(
      /^GET \/configs\/:service\/:profile status: 200 \(\d+ms\)$/,
    );
  });

  it('4xx는 WARN, 5xx는 ERROR로 남긴다', () => {
    const client = setup({ route: ROUTE });
    client.response.statusCode = 401;
    client.response.emit('finish');
    expect(client.logger.warn).toHaveBeenCalledTimes(1);
    expect(client.logger.log).not.toHaveBeenCalled();

    const server = setup({ route: ROUTE });
    server.response.statusCode = 503;
    server.response.emit('finish');
    expect(server.logger.error).toHaveBeenCalledTimes(1);
  });

  it('응답 전에 연결이 끊기면 499로 ERROR를 남긴다', () => {
    const { logger, response } = setup({ route: ROUTE });

    response.emit('close');
    response.emit('finish');

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatch(/ status: 499 \(\d+ms\)$/);
  });

  it('매칭된 라우트가 없으면 쿼리를 뗀 경로를 길이 제한해 남긴다', () => {
    const { logger, response } = setup({
      path: '/nope',
      originalUrl: '/nope?token=secret-value',
    });
    response.statusCode = 404;
    response.emit('finish');

    const message = String(logger.warn.mock.calls[0][0]);
    expect(message).toMatch(/^GET \/nope status: 404 \(\d+ms\)$/);
    expect(message).not.toContain('secret');

    const long = `/${'a'.repeat(300)}`;
    const truncated = setup({ path: long, originalUrl: long });
    truncated.response.statusCode = 404;
    truncated.response.emit('finish');
    expect(String(truncated.logger.warn.mock.calls[0][0])).toContain(
      `/${'a'.repeat(199)}… status: 404`,
    );
  });

  it.each(['/health', '/metrics', '/actuator/health', '/docs'])(
    '%s 는 남기지 않는다',
    (path) => {
      const { logger, response, next } = setup({ path, originalUrl: path });

      response.emit('finish');

      expect(next).toHaveBeenCalledTimes(1);
      expect(logger.log).not.toHaveBeenCalled();
    },
  );
});

describe('installHttpAccessLog', () => {
  const fakeApp = (enabled: boolean) => ({
    get: jest.fn(() => ({ get: () => enabled })),
    use: jest.fn(),
  });

  it('켜져 있으면 미들웨어를 등록한다', () => {
    const app = fakeApp(true);
    installHttpAccessLog(app as never);
    expect(app.use).toHaveBeenCalledTimes(1);
  });

  it('HTTP_ACCESS_LOG_ENABLED=false면 등록하지 않는다', () => {
    const app = fakeApp(false);
    installHttpAccessLog(app as never);
    expect(app.use).not.toHaveBeenCalled();
  });
});
