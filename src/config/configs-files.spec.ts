import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { isPlainObject } from './deep-merge';

const configsDir = join(__dirname, '..', '..', 'configs');

const SERVICES = [
  'gateway',
  'auth',
  'expo',
  'apply',
  'report',
  'form',
  'notification',
];
const PROFILES = ['dev', 'prod'];

describe('configs/ files', () => {
  let fileNames: string[];

  beforeAll(async () => {
    fileNames = (await readdir(configsDir)).filter((name) =>
      name.endsWith('.yml'),
    );
  });

  it.each(PROFILES)('has the shared application-%s.yml', (profile) => {
    expect(fileNames).toContain(`application-${profile}.yml`);
  });

  it.each(['local', 'dev', 'prod'])(
    'restricts public SMS access and preserves existing budgets in gateway-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config) || !Array.isArray(config.publicPaths)) {
        throw new Error('Expected Gateway config with publicPaths');
      }

      expect(
        config.publicPaths.filter(
          (entry: unknown) =>
            typeof entry === 'string' &&
            /^(?:[A-Z]+ )?\/sms(?:\/|$)/.test(entry) &&
            entry !== 'GET /sms/v3/api-docs',
        ),
      ).toEqual(['POST /sms', 'POST /sms/verify', 'GET /sms']);
      expect(config.routing).toMatchObject({
        prefixes: { '/sms': 'expo-notification-server' },
      });
      expect(config.rateLimit).toEqual({
        ttlSeconds: 60,
        limit: 500,
        survey: { ttlSeconds: 60, limit: 300 },
        sms: { ttlSeconds: 60, limit: 10 },
        participantAuthCode: { ttlSeconds: 600, limit: 5 },
      });
    },
  );

  it.each(['local', 'dev', 'prod'])(
    'routes participant auth and opens exactly the participant APIs in gateway-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (
        !isPlainObject(config) ||
        !isPlainObject(config.routing) ||
        !isPlainObject(config.routing.prefixes) ||
        !Array.isArray(config.publicPaths)
      ) {
        throw new Error('Expected Gateway config with routing and publicPaths');
      }
      // 메서드 없는 접두사 항목도 걸러 비교한다. 접두사 항목은 하위 경로 전체를 연다.

      expect(config.routing.prefixes['/participant-auth']).toBe(
        'expo-user-server',
      );
      expect(
        Object.keys(config.routing.prefixes).filter((prefix) =>
          prefix.includes('internal'),
        ),
      ).toEqual([]);
      expect(
        config.publicPaths.filter(
          (entry: unknown) =>
            typeof entry === 'string' &&
            /^(?:[A-Z]+ )?\/(participant-auth|application)(\/|$)/.test(entry) &&
            entry !== 'GET /application/v3/api-docs',
        ),
      ).toEqual([
        'POST /participant-auth/code',
        'POST /participant-auth/verify',
        'GET /participant-auth/session',
        'DELETE /participant-auth/session',
        'POST /application/{expoId}',
        'POST /application/pre-standard/{expoId}',
        'POST /application/field/{expoId}',
        'POST /application/field/standard/{expoId}',
        'GET /application/expos/{expoId}/preregister-sessions/{sessionId}/capacity',
        'GET /application/program-session-csrf',
        'POST /application/expos/{expoId}/program-sessions/{programType:STANDARD|TRAINING}/{programId}/applications',
        'GET /application/expos/{expoId}/program-sessions/{programType:STANDARD|TRAINING}/{programId}/participants',
        'GET /application/expos/{expoId}/participants/{participantId}/qr',
        'GET /application/expos/{expoId}/my-applications',
        'POST /application/expos/{expoId}/my-applications/{type:PREREGISTER|STANDARD|TRAINING}/{applicationId}/cancellation',
      ]);
      // 실제 프론트 origin 근거가 없어 넣지 않는다. 넣으면 목록 밖 Origin의 쓰기가 403이 된다.
      expect(config.cors).toBeUndefined();
    },
  );

  it.each(['local', 'dev', 'prod'])(
    'shares the metrics convention in application-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `application-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config)) {
        throw new Error('Expected a YAML mapping');
      }

      // 서비스 포트(port)와 분리돼 있어야 한다. docs/metrics-convention.md
      expect(config.metrics).toEqual({ enabled: true, port: 9464 });
      expect(config.port).not.toBe(9464);
    },
  );

  it.each(['local', 'dev', 'prod'])(
    'opens only image reads, not uploads, in gateway-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config) || !Array.isArray(config.publicPaths)) {
        throw new Error('Expected Gateway config with publicPaths');
      }

      const imageEntries = config.publicPaths.filter(
        (entry: unknown) =>
          typeof entry === 'string' && entry.includes('/image'),
      );
      // 조회만 열고 업로드(POST /image)는 Gateway JWT 검사를 거치게 한다
      expect(imageEntries).toEqual(['GET /image/{id}']);
      expect(config.routing).toMatchObject({
        prefixes: { '/image': 'expo-expo-server' },
      });
    },
  );

  it('opens exactly the OpenAPI JSON of every service listed in the dev docs screen', async () => {
    const config: unknown = yaml.load(
      await readFile(join(configsDir, 'gateway-dev.yml'), 'utf-8'),
    );
    if (
      !isPlainObject(config) ||
      !isPlainObject(config.docs) ||
      !Array.isArray(config.docs.services) ||
      !Array.isArray(config.publicPaths)
    ) {
      throw new Error('Expected Gateway dev config with docs.services');
    }

    const urls = config.docs.services.map((service: unknown) => {
      if (!isPlainObject(service) || typeof service.url !== 'string') {
        throw new Error('Expected docs service with a URL');
      }
      return service.url;
    });

    expect(urls).toEqual([
      '/attendance/v3/api-docs',
      '/forms/v3/api-docs',
      '/auth/v3/api-docs',
      '/expo/v3/api-docs',
      '/application/v3/api-docs',
      '/sms/v3/api-docs',
      '/stat/v3/api-docs',
    ]);
    expect(config.publicPaths).not.toContain('GET /attendance/swagger-ui');
    expect(
      config.publicPaths.filter(
        (entry: unknown) =>
          typeof entry === 'string' && entry.includes('/v3/api-docs'),
      ),
    ).toEqual(urls.map((url) => `GET ${url}`));
  });

  it.each(['local', 'prod'])(
    'keeps API docs out of gateway-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config) || !Array.isArray(config.publicPaths)) {
        throw new Error('Expected Gateway config with publicPaths');
      }

      expect(config.docs).toBeUndefined();
      expect(
        config.publicPaths.filter(
          (entry: unknown) =>
            typeof entry === 'string' &&
            (entry.includes('/v3/api-docs') || entry === 'GET /docs'),
        ),
      ).toEqual([]);
    },
  );

  it.each(
    SERVICES.flatMap((service) =>
      PROFILES.map((profile): [string, string] => [service, profile]),
    ),
  )('has %s-%s.yml', (service, profile) => {
    expect(fileNames).toContain(`${service}-${profile}.yml`);
  });

  it('keeps internal tokens out of the public configs (they belong in Vault)', async () => {
    // docs/internal-token.md 의 토큰 키 이름. 이 리포는 public 이라 yml 에 두면 공개된다.
    const tokenKeys =
      /^\s*(token|internal-token|delete-internal-token|[A-Z_]*INTERNAL_TOKEN)\s*:/m;
    for (const fileName of fileNames) {
      const content = await readFile(join(configsDir, fileName), 'utf-8');
      expect({ fileName, hasTokenKey: tokenKeys.test(content) }).toEqual({
        fileName,
        hasTokenKey: false,
      });
    }
  });

  it('parses every file to a YAML mapping', async () => {
    for (const fileName of fileNames) {
      const parsed: unknown = yaml.load(
        await readFile(join(configsDir, fileName), 'utf-8'),
      );
      expect({ fileName, isMapping: isPlainObject(parsed) }).toEqual({
        fileName,
        isMapping: true,
      });
    }
  });
});
