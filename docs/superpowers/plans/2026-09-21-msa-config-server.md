# MSA Config Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `expo-config-server`가 `GET /configs/:service/:profile`로 native git 설정과 Vault 시크릿을 병합해 서빙하도록 만든다.

**Architecture:** `NativeConfigProvider`(리포 내 `configs/*.yml`)와 `VaultConfigProvider`(Vault KV v2)가 각각 값을 가져오고, `ConfigMergeService`가 deep merge로 합쳐 `ConfigController`가 JSON으로 응답한다.

**Tech Stack:** NestJS 11.2.5, Node 26, `js-yaml`(native 파일 파싱), Node 26 전역 `fetch`(Vault HTTP 호출, 추가 HTTP 라이브러리 없음), Jest + ts-jest + supertest(기존 devDependencies).

**Spec:** `docs/superpowers/specs/2026-09-21-msa-config-server-design.md`

## Global Constraints

- Node `>=26`, `@nestjs/*` `^11.2.5` 고정 (이미 package.json에 반영됨) — 더 올리지 않음.
- 핫 리로드 없음 — 설정은 요청 시점에 매번 새로 읽되, 프로세스 재시작 전까지 서버 자체의 "watch" 기능은 만들지 않음.
- Config Server 자체는 암복호화 로직을 갖지 않음 — 시크릿의 암호화/보관은 Vault에 위임.
- 설정값 전용 별도 git 리포는 만들지 않음 — native 파일은 이 리포의 `configs/` 폴더에 둔다.
- 병합은 항상 **deep merge** (shallow merge로 형제 키를 날리지 않는다).
- 병합 우선순위: `Vault secret/{service}` > `Vault secret/application` > `native configs/{service}-{profile}.yml` > `native configs/application-{profile}.yml`.
- `application-{profile}.yml`이 없으면 `404`. `{service}-{profile}.yml`만 없는 것은 에러가 아니다(공통 설정만 반환).
- Vault 조회 실패(네트워크/인증 오류, 4xx/5xx 중 404 제외)는 `503`. Vault의 개별 경로가 `404`인 것은 "그 경로에 시크릿 없음"으로 취급하고 빈 객체로 처리한다(에러 아님).
- 클라이언트(16개 서비스)의 부트스트랩 통합은 **이 플랜의 범위 밖**이다 — 별도 리포마다 다른 배포 형태(npm 패키지 vs 코드 스니펫) 결정이 필요해 독립된 후속 플랜으로 분리한다. 이 플랜은 `expo-config-server`가 `curl`로 검증 가능한 완결된 결과물을 내는 것까지만 다룬다.

---

## Task 1: Deep merge 유틸리티

**Files:**
- Create: `src/config/deep-merge.ts`
- Test: `src/config/deep-merge.spec.ts`

**Interfaces:**
- Produces: `export type ConfigRecord = Record<string, unknown>;` / `export function deepMerge(base: ConfigRecord, override: ConfigRecord): ConfigRecord` — 이후 모든 Task가 이 타입과 함수를 가져다 씀.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/config/deep-merge.spec.ts`:

```ts
import { deepMerge } from './deep-merge';

describe('deepMerge', () => {
  it('overrides top-level keys', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it('merges nested objects without losing sibling keys', () => {
    const base = { db: { host: 'localhost', port: 5432 } };
    const override = { db: { password: 'secret' } };

    expect(deepMerge(base, override)).toEqual({
      db: { host: 'localhost', port: 5432, password: 'secret' },
    });
  });

  it('replaces arrays wholesale instead of merging them', () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  it('keeps base keys that override does not touch', () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/config/deep-merge.spec.ts`
Expected: FAIL — `Cannot find module './deep-merge'`

- [ ] **Step 3: 최소 구현 작성**

`src/config/deep-merge.ts`:

```ts
export type ConfigRecord = Record<string, unknown>;

export function deepMerge(base: ConfigRecord, override: ConfigRecord): ConfigRecord {
  const result: ConfigRecord = { ...base };

  for (const key of Object.keys(override)) {
    const baseValue = result[key];
    const overrideValue = override[key];

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/config/deep-merge.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/config/deep-merge.ts src/config/deep-merge.spec.ts
git commit -m "feat: add deep-merge utility for config sources"
```

---

## Task 2: NativeConfigProvider

**Files:**
- Create: `src/config/native-config.provider.ts`
- Test: `src/config/native-config.provider.spec.ts`

**Interfaces:**
- Consumes: `deepMerge`, `ConfigRecord` from `./deep-merge` (Task 1)
- Produces: `export class ProfileNotFoundError extends Error` / `export class NativeConfigProvider { load(service: string, profile: string): Promise<ConfigRecord> }` — Task 4/5가 이 클래스와 에러 타입을 그대로 사용.
- 환경변수 `CONFIG_DIR`로 설정 디렉터리를 오버라이드할 수 있음 (없으면 `process.cwd()/configs`).

- [ ] **Step 1: 의존성 설치**

Run: `npm install js-yaml`

(js-yaml 5.x는 자체 타입을 내장하므로 `@types/js-yaml`은 필요 없음)

- [ ] **Step 2: 실패하는 테스트 작성**

`src/config/native-config.provider.spec.ts`:

```ts
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeConfigProvider, ProfileNotFoundError } from './native-config.provider';

describe('NativeConfigProvider', () => {
  let configDir: string;
  let previousConfigDir: string | undefined;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'native-config-test-'));
    previousConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    process.env.CONFIG_DIR = previousConfigDir;
    await rm(configDir, { recursive: true, force: true });
  });

  it('merges application and service files for a profile', async () => {
    await writeFile(
      join(configDir, 'application-local.yml'),
      'port: 3000\ndb:\n  host: localhost\n',
    );
    await writeFile(join(configDir, 'auth-local.yml'), 'db:\n  password: devpass\n');

    const provider = new NativeConfigProvider();
    const result = await provider.load('auth', 'local');

    expect(result).toEqual({
      port: 3000,
      db: { host: 'localhost', password: 'devpass' },
    });
  });

  it('returns application-only config when the service file does not exist', async () => {
    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');

    const provider = new NativeConfigProvider();
    const result = await provider.load('unknown-service', 'local');

    expect(result).toEqual({ port: 3000 });
  });

  it('throws ProfileNotFoundError when application-{profile}.yml is missing', async () => {
    const provider = new NativeConfigProvider();

    await expect(provider.load('auth', 'missing-profile')).rejects.toThrow(
      ProfileNotFoundError,
    );
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx jest src/config/native-config.provider.spec.ts`
Expected: FAIL — `Cannot find module './native-config.provider'`

- [ ] **Step 4: 최소 구현 작성**

`src/config/native-config.provider.ts`:

```ts
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest src/config/native-config.provider.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json src/config/native-config.provider.ts src/config/native-config.provider.spec.ts
git commit -m "feat: add NativeConfigProvider for git-based config files"
```

---

## Task 3: VaultConfigProvider

**Files:**
- Create: `src/config/vault-config.provider.ts`
- Test: `src/config/vault-config.provider.spec.ts`

**Interfaces:**
- Consumes: `deepMerge`, `ConfigRecord` from `./deep-merge` (Task 1)
- Produces: `export class VaultUnavailableError extends Error` / `export class VaultConfigProvider { load(service: string): Promise<ConfigRecord> }` — Task 4/5가 그대로 사용.
- 환경변수 `VAULT_ADDR`, `VAULT_TOKEN` 필요. Vault KV v2 API(`GET {VAULT_ADDR}/v1/secret/data/{path}`, 헤더 `X-Vault-Token`) 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/config/vault-config.provider.spec.ts`:

```ts
import { VaultConfigProvider, VaultUnavailableError } from './vault-config.provider';

describe('VaultConfigProvider', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.VAULT_ADDR = 'http://vault.local';
    process.env.VAULT_TOKEN = 'test-token';
  });

  afterEach(() => {
    process.env = { ...previousEnv };
    jest.restoreAllMocks();
  });

  it('merges application and service secrets, service wins on conflicts', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/secret/data/application')) {
        return new Response(
          JSON.stringify({ data: { data: { jwtSecret: 'common', dbPassword: 'common-pw' } } }),
          { status: 200 },
        );
      }
      if (path.endsWith('/secret/data/auth')) {
        return new Response(JSON.stringify({ data: { data: { dbPassword: 'auth-pw' } } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected url: ${path}`);
    });

    const provider = new VaultConfigProvider();
    const result = await provider.load('auth');

    expect(result).toEqual({ jwtSecret: 'common', dbPassword: 'auth-pw' });
  });

  it('treats a 404 path as an empty object, not an error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

    const provider = new VaultConfigProvider();
    const result = await provider.load('unknown-service');

    expect(result).toEqual({});
  });

  it('throws VaultUnavailableError when Vault is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const provider = new VaultConfigProvider();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });

  it('throws VaultUnavailableError when VAULT_ADDR is missing', async () => {
    delete process.env.VAULT_ADDR;

    const provider = new VaultConfigProvider();

    await expect(provider.load('auth')).rejects.toThrow(VaultUnavailableError);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/config/vault-config.provider.spec.ts`
Expected: FAIL — `Cannot find module './vault-config.provider'`

- [ ] **Step 3: 최소 구현 작성**

`src/config/vault-config.provider.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { deepMerge, ConfigRecord } from './deep-merge';

export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultUnavailableError';
  }
}

@Injectable()
export class VaultConfigProvider {
  async load(service: string): Promise<ConfigRecord> {
    const applicationSecrets = await this.readSecret('application');
    const serviceSecrets = await this.readSecret(service);
    return deepMerge(applicationSecrets, serviceSecrets);
  }

  private async readSecret(path: string): Promise<ConfigRecord> {
    const vaultAddr = process.env.VAULT_ADDR;
    const vaultToken = process.env.VAULT_TOKEN;

    if (!vaultAddr || !vaultToken) {
      throw new VaultUnavailableError('VAULT_ADDR or VAULT_TOKEN is not configured');
    }

    let response: Response;
    try {
      response = await fetch(`${vaultAddr}/v1/secret/data/${path}`, {
        headers: { 'X-Vault-Token': vaultToken },
      });
    } catch (error) {
      throw new VaultUnavailableError(`Failed to reach Vault: ${(error as Error).message}`);
    }

    if (response.status === 404) {
      return {};
    }
    if (!response.ok) {
      throw new VaultUnavailableError(`Vault responded with status ${response.status}`);
    }

    const body = (await response.json()) as { data?: { data?: ConfigRecord } };
    return body.data?.data ?? {};
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/config/vault-config.provider.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/config/vault-config.provider.ts src/config/vault-config.provider.spec.ts
git commit -m "feat: add VaultConfigProvider for secret lookups"
```

---

## Task 4: ConfigMergeService

**Files:**
- Create: `src/config/config-merge.service.ts`
- Test: `src/config/config-merge.service.spec.ts`

**Interfaces:**
- Consumes: `deepMerge`/`ConfigRecord` (Task 1), `NativeConfigProvider`/`ProfileNotFoundError` (Task 2), `VaultConfigProvider`/`VaultUnavailableError` (Task 3)
- Produces: `export class ConfigMergeService { constructor(nativeConfigProvider: NativeConfigProvider, vaultConfigProvider: VaultConfigProvider); getMergedConfig(service: string, profile: string): Promise<ConfigRecord> }` — Task 5가 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/config/config-merge.service.spec.ts`:

```ts
import { ConfigMergeService } from './config-merge.service';
import { NativeConfigProvider, ProfileNotFoundError } from './native-config.provider';
import { VaultConfigProvider, VaultUnavailableError } from './vault-config.provider';

describe('ConfigMergeService', () => {
  it('merges native and vault config with vault winning on conflicts', async () => {
    const nativeConfigProvider = {
      load: jest.fn().mockResolvedValue({ port: 3000, db: { host: 'localhost' } }),
    } as unknown as NativeConfigProvider;
    const vaultConfigProvider = {
      load: jest.fn().mockResolvedValue({ db: { password: 'secret' } }),
    } as unknown as VaultConfigProvider;

    const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);
    const result = await service.getMergedConfig('auth', 'local');

    expect(result).toEqual({ port: 3000, db: { host: 'localhost', password: 'secret' } });
  });

  it('propagates ProfileNotFoundError from the native provider', async () => {
    const nativeConfigProvider = {
      load: jest.fn().mockRejectedValue(new ProfileNotFoundError('missing')),
    } as unknown as NativeConfigProvider;
    const vaultConfigProvider = { load: jest.fn() } as unknown as VaultConfigProvider;

    const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);

    await expect(service.getMergedConfig('auth', 'missing')).rejects.toThrow(
      ProfileNotFoundError,
    );
  });

  it('propagates VaultUnavailableError from the vault provider', async () => {
    const nativeConfigProvider = {
      load: jest.fn().mockResolvedValue({}),
    } as unknown as NativeConfigProvider;
    const vaultConfigProvider = {
      load: jest.fn().mockRejectedValue(new VaultUnavailableError('down')),
    } as unknown as VaultConfigProvider;

    const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);

    await expect(service.getMergedConfig('auth', 'local')).rejects.toThrow(
      VaultUnavailableError,
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/config/config-merge.service.spec.ts`
Expected: FAIL — `Cannot find module './config-merge.service'`

- [ ] **Step 3: 최소 구현 작성**

`src/config/config-merge.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { deepMerge, ConfigRecord } from './deep-merge';
import { NativeConfigProvider } from './native-config.provider';
import { VaultConfigProvider } from './vault-config.provider';

@Injectable()
export class ConfigMergeService {
  constructor(
    private readonly nativeConfigProvider: NativeConfigProvider,
    private readonly vaultConfigProvider: VaultConfigProvider,
  ) {}

  async getMergedConfig(service: string, profile: string): Promise<ConfigRecord> {
    const native = await this.nativeConfigProvider.load(service, profile);
    const vault = await this.vaultConfigProvider.load(service);
    return deepMerge(native, vault);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/config/config-merge.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/config/config-merge.service.ts src/config/config-merge.service.spec.ts
git commit -m "feat: add ConfigMergeService combining native and vault sources"
```

---

## Task 5: ConfigController, ConfigModule, 예시 설정 파일, AppModule 연결

**Files:**
- Create: `src/config/config.controller.ts`
- Create: `src/config/config.controller.spec.ts`
- Create: `src/config/config.module.ts`
- Create: `configs/application-local.yml`
- Create: `configs/application-dev.yml`
- Create: `configs/application-prod.yml`
- Create: `configs/auth-local.yml`
- Modify: `src/app.module.ts` (전체 내용 교체)

**Interfaces:**
- Consumes: `ConfigMergeService` (Task 4), `ProfileNotFoundError` (Task 2), `VaultUnavailableError` (Task 3)
- Produces: `GET /configs/:service/:profile` HTTP 엔드포인트 — Task 6(e2e)이 이 라우트를 호출.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/config/config.controller.spec.ts`:

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigMergeService } from './config-merge.service';
import { ProfileNotFoundError } from './native-config.provider';
import { VaultUnavailableError } from './vault-config.provider';

describe('ConfigController', () => {
  it('returns the merged config on success', async () => {
    const configMergeService = {
      getMergedConfig: jest.fn().mockResolvedValue({ port: 3000 }),
    } as unknown as ConfigMergeService;

    const controller = new ConfigController(configMergeService);
    const result = await controller.getConfig('auth', 'local');

    expect(result).toEqual({ port: 3000 });
  });

  it('maps ProfileNotFoundError to a 404 HttpException', async () => {
    expect.assertions(2);
    const configMergeService = {
      getMergedConfig: jest.fn().mockRejectedValue(new ProfileNotFoundError('missing')),
    } as unknown as ConfigMergeService;
    const controller = new ConfigController(configMergeService);

    try {
      await controller.getConfig('auth', 'missing');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  it('maps VaultUnavailableError to a 503 HttpException', async () => {
    expect.assertions(2);
    const configMergeService = {
      getMergedConfig: jest.fn().mockRejectedValue(new VaultUnavailableError('down')),
    } as unknown as ConfigMergeService;
    const controller = new ConfigController(configMergeService);

    try {
      await controller.getConfig('auth', 'local');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/config/config.controller.spec.ts`
Expected: FAIL — `Cannot find module './config.controller'`

- [ ] **Step 3: 최소 구현 작성**

`src/config/config.controller.ts`:

```ts
import { Controller, Get, HttpException, HttpStatus, Param } from '@nestjs/common';
import { ConfigMergeService } from './config-merge.service';
import { ProfileNotFoundError } from './native-config.provider';
import { VaultUnavailableError } from './vault-config.provider';

@Controller('configs')
export class ConfigController {
  constructor(private readonly configMergeService: ConfigMergeService) {}

  @Get(':service/:profile')
  async getConfig(@Param('service') service: string, @Param('profile') profile: string) {
    try {
      return await this.configMergeService.getMergedConfig(service, profile);
    } catch (error) {
      if (error instanceof ProfileNotFoundError) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error instanceof VaultUnavailableError) {
        throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw error;
    }
  }
}
```

`src/config/config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigMergeService } from './config-merge.service';
import { NativeConfigProvider } from './native-config.provider';
import { VaultConfigProvider } from './vault-config.provider';

@Module({
  controllers: [ConfigController],
  providers: [ConfigMergeService, NativeConfigProvider, VaultConfigProvider],
})
export class ConfigModule {}
```

`src/app.module.ts` (전체 교체):

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';

@Module({
  imports: [ConfigModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

`configs/application-local.yml`:

```yaml
port: 3000
```

`configs/application-dev.yml`:

```yaml
port: 3000
```

`configs/application-prod.yml`:

```yaml
port: 3000
```

`configs/auth-local.yml`:

```yaml
serviceName: auth
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/config/config.controller.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 종료

- [ ] **Step 6: 커밋**

```bash
git add src/config/config.controller.ts src/config/config.controller.spec.ts src/config/config.module.ts src/app.module.ts configs/
git commit -m "feat: wire up config controller/module and add sample config files"
```

---

## Task 6: E2E 테스트

**Files:**
- Create: `test/config.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppModule` (Task 5, `../src/app.module`)
- 이 태스크는 새로운 프로덕션 코드를 만들지 않고, Task 1~5로 완성된 서버 전체를 HTTP 레벨에서 검증한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/config.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

describe('Config API (e2e)', () => {
  let app: INestApplication;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let previousVaultAddr: string | undefined;
  let previousVaultToken: string | undefined;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'config-e2e-'));
    previousConfigDir = process.env.CONFIG_DIR;
    previousVaultAddr = process.env.VAULT_ADDR;
    previousVaultToken = process.env.VAULT_TOKEN;
    process.env.CONFIG_DIR = configDir;
    process.env.VAULT_ADDR = 'http://vault.local';
    process.env.VAULT_TOKEN = 'test-token';

    await writeFile(join(configDir, 'application-local.yml'), 'port: 3000\n');
    await writeFile(join(configDir, 'auth-local.yml'), 'serviceName: auth\n');

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/secret/data/application')) {
        return new Response(JSON.stringify({ data: { data: {} } }), { status: 200 });
      }
      if (path.endsWith('/secret/data/auth')) {
        return new Response(JSON.stringify({ data: { data: { dbPassword: 'auth-pw' } } }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
    process.env.CONFIG_DIR = previousConfigDir;
    process.env.VAULT_ADDR = previousVaultAddr;
    process.env.VAULT_TOKEN = previousVaultToken;
    await rm(configDir, { recursive: true, force: true });
  });

  it('GET /configs/auth/local merges native and vault config', async () => {
    const response = await request(app.getHttpServer()).get('/configs/auth/local');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      port: 3000,
      serviceName: 'auth',
      dbPassword: 'auth-pw',
    });
  });

  it('GET /configs/auth/missing-profile returns 404', async () => {
    const response = await request(app.getHttpServer()).get('/configs/auth/missing-profile');

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:e2e`
Expected: FAIL — 아직 라우트가 없거나 컴파일 에러 (Task 5 완료 전이면). Task 5까지 끝난 상태라면 이 스텝은 사실상 바로 PASS로 넘어갈 수 있음 — 그 경우 다음 스텝에서 그대로 확인.

- [ ] **Step 3: 통과 확인 (구현은 Task 1~5에서 이미 끝났으므로 추가 구현 없음)**

Run: `npm run test:e2e`
Expected: PASS (2 tests)

- [ ] **Step 4: 커밋**

```bash
git add test/config.e2e-spec.ts
git commit -m "test: add e2e coverage for GET /configs/:service/:profile"
```

---

## 후속 작업 (이 플랜 범위 밖)

- 16개 클라이언트 서비스가 부팅 시 이 Config Server를 호출하는 부트스트랩 통합 — 서비스마다 리포가
  달라 배포 형태(공유 npm 패키지 vs 스니펫)를 서비스 쪽에서 별도로 정하고 진행. 독립된 플랜으로 분리.
- Vault 서버 자체의 프로비저닝(로컬 dev-mode, 운영 실서버) — 인프라 작업, 이 플랜에 포함하지 않음.
- Config Server를 private network에서만 접근 가능하게 막는 것 — 배포/네트워크 설정이라 코드
  플랜이 아닌 인프라 작업으로 별도 처리.
