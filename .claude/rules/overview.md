---
paths:
  - "src/**"
  - "test/**"
  - "configs/**"
---

# Overview

## Project Overview

`expo-config-server` is the config server for the Expo (startup expo project) MSA.
Non-sensitive shared/service-specific settings live as yml under this repo's `configs/`;
secrets are looked up from Vault and merged in, then served via `GET /configs/:service/:profile`.
Each service calls this single endpoint on boot to receive everything it needs.

**Framework:** NestJS 11
**Language:** TypeScript
**Package manager:** npm
**Status:** Initial implementation complete (native + Vault merge serving); bootstrap integration for the 16 client services is a follow-up

## Project Structure

```
expo-config-server/
├── configs/                        # Native config source (git, inside this repo)
│   ├── application-local.yml       # Shared across all services (per profile)
│   ├── application-dev.yml
│   ├── application-prod.yml
│   └── auth-local.yml              # Service-specific override (optional)
├── src/
│   ├── main.ts                     # Installs the JSON logger, then loads AppModule
│   ├── logging/json-logger.ts      # Standard JSON log line (pino), see Logging
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
