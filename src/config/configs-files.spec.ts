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
            typeof entry === 'string' && entry.includes('/sms'),
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
      });
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
