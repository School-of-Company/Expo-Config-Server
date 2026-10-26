import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { installHttpAccessLog } from '../src/logging/http-access-log.middleware';

describe('HTTP access log (e2e)', () => {
  let app: INestApplication<App>;
  const logger = {
    log: jest.fn<void, [string]>(),
    warn: jest.fn<void, [string]>(),
    error: jest.fn<void, [string]>(),
  };
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Vault 가 실패해도 액세스 로그 경로·상태만 확인하면 된다.
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('down', { status: 500 }));
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    installHttpAccessLog(app, logger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  beforeEach(() => jest.clearAllMocks());

  const lines = () =>
    [
      ...logger.log.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ].map(([message]) => message);

  it('매칭된 라우트는 템플릿으로 남긴다', async () => {
    const res = await request(app.getHttpServer()).get(
      '/configs/auth/local?x=1',
    );

    expect(lines()).toEqual([
      expect.stringMatching(
        new RegExp(`^GET /configs/:service/:profile ${res.status} \\d+ms$`),
      ),
    ]);
  });

  it('매칭되지 않은 경로는 쿼리 없이 남긴다', async () => {
    await request(app.getHttpServer()).get('/nope?token=abc').expect(404);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/^GET \/nope 404 \d+ms$/);
  });
});
