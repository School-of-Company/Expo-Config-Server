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
        participantAuthCode: { ttlSeconds: 600, limit: 50 },
        signin: { ttlSeconds: 600, limit: 10 },
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
        'POST /application/expos/{expoId}/program-sessions/{programType:STANDARD|TRAINING}/{programId}/application-batches',
        'POST /application/expos/{expoId}/program-sessions/{programType:STANDARD|TRAINING}/{programId}/onsite-applications',
        'POST /application/expos/{expoId}/program-sessions/{programType:STANDARD|TRAINING}/{programId}/onsite-application-batches',
        'GET /application/expos/{expoId}/program-sessions/{programType:STANDARD|TRAINING}/{programId}/participants',
        'GET /application/expos/{expoId}/participants/{participantId}/qr',
        'GET /application/expos/{expoId}/my-applications',
        'POST /application/expos/{expoId}/my-applications/{type:PREREGISTER|STANDARD|TRAINING}/{applicationId}/cancellation',
        'POST /application/expos/{expoId}/my-applications/PREREGISTER/{applicationId}/companions',
        'GET /application/expos/{expoId}/my-applications/preregister-waitlist',
        'GET /application/expos/{expoId}/my-applications/preregister-waitlists',
        'POST /application/expos/{expoId}/my-applications/preregister-sessions',
        'POST /application/expos/{expoId}/my-applications/preregister-waitlist/cancellation',
        'GET /application/expos/{expoId}/my-applications/promotion-offers',
        'POST /application/expos/{expoId}/my-applications/promotion-offers/{offerId}/acceptance',
        'POST /application/expos/{expoId}/my-applications/promotion-offers/{offerId}/decline',
        'POST /application/expos/{expoId}/page-views',
      ]);
      // 실제 프론트 origin 근거가 없어 넣지 않는다. 넣으면 목록 밖 Origin의 쓰기가 403이 된다.
      expect(config.cors).toBeUndefined();
    },
  );

  it.each(['local', 'dev', 'prod'])(
    'keeps the per-IP participant code budget within the Notification SMS caps in %s',
    async (profile) => {
      const gateway: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      const notification: unknown = yaml.load(
        await readFile(
          join(configsDir, `notification-${profile}.yml`),
          'utf-8',
        ),
      );
      if (
        !isPlainObject(gateway) ||
        !isPlainObject(gateway.rateLimit) ||
        !isPlainObject(gateway.rateLimit.participantAuthCode) ||
        !isPlainObject(notification) ||
        !isPlainObject(notification.sms)
      ) {
        throw new Error('Expected Gateway rateLimit and Notification sms');
      }
      const { ttlSeconds, limit } = gateway.rateLimit.participantAuthCode;
      const { authMaxSendCount, authMaxSendCountPerHour } = notification.sms;
      if (
        typeof ttlSeconds !== 'number' ||
        typeof limit !== 'number' ||
        typeof authMaxSendCountPerHour !== 'number'
      ) {
        throw new Error('Expected numeric limits');
      }

      // #92: the venue IP budget is loosened on the assumption that paid SMS cost is capped per number and
      // service-wide in Notification. One IP must not be allowed more than that service-wide hourly cap.
      expect(authMaxSendCount).toBe(5);
      expect(authMaxSendCountPerHour).toBe(300);
      expect((limit * 3600) / ttlSeconds).toBeLessThanOrEqual(
        authMaxSendCountPerHour,
      );
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

  it.each(['local', 'dev', 'prod'])(
    'opens only participant program list reads under /training and /standard in gateway-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config) || !Array.isArray(config.publicPaths)) {
        throw new Error('Expected Gateway config with publicPaths');
      }

      const programEntries = config.publicPaths.filter(
        (entry: unknown) =>
          typeof entry === 'string' &&
          /^(\S+ )?\/(training|standard)(\/|$)/.test(entry),
      );
      // 참가자 신청이 토큰 없이 읽는 목록만 연다. 상세·쓰기는 JWT 검사를 거친다
      expect(programEntries).toEqual([
        'GET /training/program/{expoId}',
        'GET /standard/program/{expoId}',
      ]);
      expect(config.routing).toMatchObject({
        prefixes: {
          '/training': 'expo-expo-server',
          '/standard': 'expo-expo-server',
        },
      });
    },
  );

  it.each(['local', 'dev', 'prod'])(
    'opens only the participant expo and preregister session reads under /expo in gateway-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config) || !Array.isArray(config.publicPaths)) {
        throw new Error('Expected Gateway config with publicPaths');
      }

      // 참가자 박람회 공개 조회와 회차 목록 조회만 연다. 관리자 회차 조회·쓰기와 박람회 API는 JWT 검사를 거친다
      expect(
        config.publicPaths.filter(
          (entry: unknown) =>
            typeof entry === 'string' &&
            /^(\S+ )?\/expo(\/|$)/.test(entry) &&
            entry !== 'GET /expo/v3/api-docs',
        ),
      ).toEqual([
        'GET /expo/{expoId}/preregister-sessions/public',
        'GET /expo/{expoId}/public',
      ]);
      expect(config.routing).toMatchObject({
        prefixes: { '/expo': 'expo-expo-server' },
      });
    },
  );

  it.each(['local', 'dev', 'prod'])(
    'opens only form reads, not form writes, in gateway-%s',
    async (profile) => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config) || !Array.isArray(config.publicPaths)) {
        throw new Error('Expected Gateway config with publicPaths');
      }

      // 신청 폼·프로그램용 폼 조회만 연다. 생성·수정·삭제는 JWT 검사를 거친다
      expect(
        config.publicPaths.filter(
          (entry: unknown) =>
            typeof entry === 'string' &&
            /^(\S+ )?\/forms(\/|$)/.test(entry) &&
            entry !== 'GET /forms/v3/api-docs',
        ),
      ).toEqual(['GET /forms/by-id/{formId}', 'GET /forms/{expoId}']);
    },
  );

  it.each(['local', 'dev', 'prod'])(
    'opens only the survey read and participant answer submits, not survey writes, besides the public survey prefixes in gateway-%s',
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
            typeof entry === 'string' && /^(\S+ )?\/surveys(\/|$)/.test(entry),
        ),
      ).toEqual([
        '/surveys/public',
        '/surveys/answer/public',
        'GET /surveys/{expoId}',
        'POST /surveys/answer/standard/{expoId}',
        'POST /surveys/answer/trainee/{expoId}',
      ]);
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

  it('serves the prod integrated docs only behind a docs-only Basic auth that comes from Vault', async () => {
    const load = async (profile: string): Promise<Record<string, unknown>> => {
      const config: unknown = yaml.load(
        await readFile(join(configsDir, `gateway-${profile}.yml`), 'utf-8'),
      );
      if (!isPlainObject(config)) {
        throw new Error('Expected a YAML mapping');
      }
      return config;
    };
    const prod = await load('prod');
    const dev = await load('dev');
    if (
      !isPlainObject(prod.docs) ||
      !isPlainObject(dev.docs) ||
      !Array.isArray(prod.docs.services) ||
      !Array.isArray(prod.publicPaths)
    ) {
      throw new Error('Expected docs.services and publicPaths in gateway-prod');
    }

    // 운영은 인증 없이 부팅하지 않게 하고(requireAuth), Try it out을 끈다
    expect(prod.docs.enabled).toBe(true);
    expect(prod.docs.requireAuth).toBe(true);
    expect(prod.docs.tryItOut).toBe(false);
    // 자격 증명은 Vault에서 병합되므로 yml에 없어야 한다
    expect(prod.docs.basicAuth).toBeUndefined();
    expect(JSON.stringify(prod)).not.toMatch(/password|username/i);
    // 보는 서비스는 dev 통합 문서와 같다
    expect(prod.docs.services).toEqual(dev.docs.services);
    // 문서 JSON과 화면은 publicPaths로 열지 않는다(Basic 인증으로만 열린다)
    expect(
      prod.publicPaths.filter(
        (entry: unknown) =>
          typeof entry === 'string' &&
          (entry.includes('api-docs') ||
            entry.includes('swagger') ||
            entry.includes('/docs')),
      ),
    ).toEqual([]);
  });

  it.each(['local'])('keeps API docs out of gateway-%s', async (profile) => {
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
  });

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
