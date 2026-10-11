import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

// docs/metrics-convention.md: 같은 호스트의 서비스들은 서비스별 override 로 서로 다른 메트릭 포트를 받아야 한다.
// 포트 값은 테스트용이며 실제 할당이 아니다.
describe('Per-service metrics.port overrides (e2e)', () => {
  let app: INestApplication | undefined;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'metrics-port-e2e-'));
    previousConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = configDir;

    await writeFile(
      join(configDir, 'application-prod.yml'),
      'metrics:\n  enabled: true\n  port: 9464\n',
    );
    await writeFile(
      join(configDir, 'svc-a-prod.yml'),
      'metrics:\n  port: 19001\n',
    );
    await writeFile(join(configDir, 'svc-b-prod.yml'), 'port: 8080\n');

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const data = (url as string).endsWith('/secret/data/svc-b')
        ? { metrics: { port: 19002 } }
        : {};
      return Promise.resolve(
        new Response(JSON.stringify({ data: { data } }), { status: 200 }),
      );
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    fetchSpy.mockRestore();
    if (previousConfigDir === undefined) delete process.env.CONFIG_DIR;
    else process.env.CONFIG_DIR = previousConfigDir;
    await rm(configDir, { recursive: true, force: true });
  });

  it.each([
    ['svc-a', 19001, 'yml override'],
    ['svc-b', 19002, 'Vault override'],
    ['svc-c', 9464, 'no override (shared default)'],
  ])('%s keeps metrics.port %p over HTTP (%s)', async (service, port) => {
    const nested = await request(app!.getHttpServer()).get(
      `/configs/${service}/prod`,
    );
    const spring = await request(app!.getHttpServer()).get(
      `/spring/${service}/prod`,
    );

    expect(nested.status).toBe(200);
    expect(nested.body).toMatchObject({ metrics: { enabled: true, port } });
    expect(spring.status).toBe(200);
    expect(spring.body).toMatchObject({
      propertySources: [
        { source: { 'metrics.enabled': true, 'metrics.port': port } },
      ],
    });
  });
});
