# Expo Config Server — Claude Code Operating Guide

## Project Overview

`expo-config-server`는 Expo(스타트업 박람회 프로젝트) MSA의 config server다.
비민감 공통/서비스별 설정은 이 리포의 `configs/` 아래 yml로 관리하고, 시크릿은 Vault에서 조회해
병합한 뒤 `GET /configs/:service/:profile`로 서빙한다. 각 서비스는 부팅 시 이 엔드포인트 하나만
호출해서 필요한 설정을 전부 받는다.

**Framework:** NestJS 11
**Language:** TypeScript
**Package manager:** npm
**Status:** 초기 구현 완료 (native + Vault 병합 서빙), 16개 클라이언트 서비스 부트스트랩 통합은 후속

> **응답 언어:** 항상 한국어로 응답한다.

---

## Validation Commands

```bash
# Required
npm test                # 유닛 테스트 (jest)
npm run test:e2e        # e2e 테스트 (실제 HTTP 스택)

# Recommended
npx tsc -p tsconfig.build.json --noEmit   # 타입 체크
npm run lint             # eslint

# Run
npm run start:dev
```

---

## Project Structure

```
expo-config-server/
├── configs/                        # native 설정 원본 (git, 이 리포 안)
│   ├── application-local.yml       # 전체 공통 (profile별)
│   ├── application-dev.yml
│   ├── application-prod.yml
│   └── auth-local.yml              # 서비스별 override (선택)
├── src/
│   ├── main.ts
│   ├── app.module.ts               # ConfigModule import
│   └── config/
│       ├── deep-merge.ts           # 순수 함수, 병합 로직 (I/O 없음)
│       ├── native-config.provider.ts   # configs/*.yml 읽기 (I/O)
│       ├── vault-config.provider.ts    # Vault KV v2 조회 (I/O)
│       ├── config-merge.service.ts     # 두 provider 조합, 병합 우선순위
│       ├── config.controller.ts        # GET /configs/:service/:profile, 에러→HTTP 매핑
│       └── config.module.ts
└── test/
    └── config.e2e-spec.ts
```

---

## Config Server Domain Flow

```
Client Service → GET /configs/:service/:profile
  → ConfigController: service/profile 형식 검증 (400)
  → ConfigMergeService
      → NativeConfigProvider: configs/application-{profile}.yml (필수, 없으면 404)
                             + configs/{service}-{profile}.yml (선택)
      → VaultConfigProvider: secret/application (공통) + secret/{service} (서비스별)
      → deep merge: Vault {service} > Vault application > native {service} > native application
  → 200 병합된 JSON, 또는 404(미정의 profile)/503(Vault 불통)
Client는 부팅 시 이 응답을 받아 반영, 실패 시 재시도 없이 기동 실패(fail-fast)
```

---

## Agent Routing

| Task | Agent |
|------|-------|
| Add new feature | `feature-agent` |
| Fix a bug | `fix-agent` |
| Write tests | `test-agent` |
| Code review | `review-agent` |
| Write PR description | `pr-agent` |
| Apply review feedback | `feedback-agent` |

---

## Feature Development Flow

1. `git status` — check current state
2. Create branch: `git checkout -b feat/<scope>`
3. Implement with `feature-agent`
4. Verify with `npm test` and `npm run test:e2e`
5. Verify with `npx tsc -p tsconfig.build.json --noEmit`
6. Review diff with `review-agent`
7. Draft PR with `pr-agent`

## Bug Fix Flow

1. Reproduce the bug
2. `git checkout -b fix/<scope>`
3. Apply minimal fix with `fix-agent`
4. Add regression test
5. Verify with `npm test`

## Test Writing Flow

- Write jest-based tests with `test-agent`
- Unit test: mock the provider/service being consumed with `jest.fn()`, direct instantiation (no DI container needed for a single class)
- e2e test: boot the real `AppModule` via `@nestjs/testing` + `supertest`, mock `global.fetch` for Vault, override `CONFIG_DIR` for native files
- Isolate side effects: always restore `process.env`, spies, and temp dirs in `afterAll`/`afterEach`

---

## Git Rules

- No direct commits to `main`
- Do not commit or push without explicit request
- Always run `git status` before starting work
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`

## Coding Standards

- 병합 로직처럼 I/O 없는 로직은 순수 함수로 분리한다 (`deep-merge.ts`가 기준)
- 외부 I/O(파일 읽기, HTTP 호출)는 provider 클래스에만 두고, 서비스/컨트롤러에 직접 넣지 않는다
- Vault/CONFIG_DIR 같은 환경변수는 provider 내부에서만 읽는다 — 컨트롤러나 서비스에서 `process.env`를 직접 읽지 않는다
- 라우트 파라미터로 파일 경로나 외부 API 경로를 구성할 때는 항상 화이트리스트 정규식으로 검증한다 (path traversal 방지)
- TypeScript 엄격 타이핑 — `any` 금지, 파싱 결과는 명시적으로 타입 좁히기
- 주석은 WHY가 비자명할 때만 (예: 왜 shallow merge가 아니라 deep merge인지)

## Security Rules Summary

> Full rules: `.claude/rules/security.md`

- Do not read or print `.env`, `.env.*` files
- Never log `VAULT_TOKEN` or any value returned by `VaultConfigProvider`
- Never hardcode Vault tokens or credentials in code
- Never commit real secret values into `configs/*.yml` — that file tree is for non-secret config only
- Never include tokens, keys, or Vault response bodies in logs or error messages sent to clients

## Architecture Rules Summary

> Full rules: `.claude/rules/architecture.md`

- Dependency direction: `controller → service → provider`. Reverse dependencies forbidden.
- `*.controller.ts`: route definitions, param validation only. No business logic.
- `*.service.ts`: orchestration/business logic. No direct I/O.
- `*.provider.ts`: external I/O only (fs, HTTP). No business logic.
- Do not introduce a shared abstraction (e.g. a generic `ConfigSource` interface) before a second real provider needs it.
