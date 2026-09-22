# Expo Config Server — Claude Code Operating Guide

## Project Overview

`expo-config-server` is the config server for the Expo (startup expo project) MSA.
Non-sensitive shared/service-specific settings live as yml under this repo's `configs/`;
secrets are looked up from Vault and merged in, then served via `GET /configs/:service/:profile`.
Each service calls this single endpoint on boot to receive everything it needs.

**Framework:** NestJS 11
**Language:** TypeScript
**Package manager:** npm
**Status:** Initial implementation complete (native + Vault merge serving); bootstrap integration for the 16 client services is a follow-up

> **Response language:** Always respond in English.

---

## Validation Commands

```bash
# Required
npm test                # Unit tests (jest)
npm run test:e2e        # e2e tests (real HTTP stack)

# Recommended
npx tsc -p tsconfig.build.json --noEmit   # Type check
npm run lint             # eslint

# Run
npm run start:dev
```

---

## Project Structure

```
expo-config-server/
├── configs/                        # Native config source (git, inside this repo)
│   ├── application-local.yml       # Shared across all services (per profile)
│   ├── application-dev.yml
│   ├── application-prod.yml
│   └── auth-local.yml              # Service-specific override (optional)
├── src/
│   ├── main.ts
│   ├── app.module.ts               # Imports ConfigModule
│   └── config/
│       ├── deep-merge.ts           # Pure function, merge logic (no I/O)
│       ├── native-config.provider.ts   # Reads configs/*.yml (I/O)
│       ├── vault-config.provider.ts    # Queries Vault KV v2 (I/O)
│       ├── config-merge.service.ts     # Combines both providers, merge priority
│       ├── config.controller.ts        # GET /configs/:service/:profile, error→HTTP mapping
│       └── config.module.ts
└── test/
    └── config.e2e-spec.ts
```

---

## Config Server Domain Flow

```
Client Service → GET /configs/:service/:profile
  → ConfigController: validates service/profile shape (400)
  → ConfigMergeService
      → NativeConfigProvider: configs/application-{profile}.yml (required, 404 if missing)
                             + configs/{service}-{profile}.yml (optional)
      → VaultConfigProvider: secret/application (common) + secret/{service} (per-service)
      → deep merge: Vault {service} > Vault application > native {service} > native application
  → 200 with the merged JSON, or 404 (undefined profile) / 503 (Vault unreachable)
Client applies the response on boot; on failure it fails fast without retrying.
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

- Keep I/O-free logic (like the merge algorithm) as pure functions — `deep-merge.ts` is the reference
- External I/O (file reads, HTTP calls) belongs only in provider classes, never directly in a service or controller
- Read Vault/CONFIG_DIR-style env vars only inside their provider — never `process.env` directly in a controller or service
- Whenever a route parameter is used to build a file path or an external API path, validate it against a whitelist regex first (path traversal prevention)
- Strict TypeScript typing — no `any`; narrow parsed results explicitly
- Comments only when the WHY is non-obvious (e.g., why deep merge instead of shallow merge)

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
