# Config Server Architecture Rules

## Layer Structure

```
config/
├── deep-merge.ts               — Pure function. No I/O, no NestJS dependency.
├── native-config.provider.ts   — File I/O. Reads configs/*.yml.
├── vault-config.provider.ts    — HTTP I/O. Queries Vault KV v2.
├── config-merge.service.ts     — Combines providers, applies deep-merge.
├── config.controller.ts        — Entry point. Param validation and error→HTTP mapping only.
└── config.module.ts            — Wiring only.
```

## Dependency Direction

```
config.controller → config-merge.service → native-config.provider
                                          → vault-config.provider
```

Reverse dependencies are forbidden (e.g., a provider knowing about a service, or a service knowing about the controller).

## File Responsibilities

- `*.controller.ts`: route definitions, param validation (whitelist regex), error-type→HTTP-status mapping only. No merge logic or direct I/O.
- `*.service.ts`: provider call order and merge orchestration. No direct file reads or fetch calls.
- `*.provider.ts`: external I/O (filesystem, HTTP) only. No business logic (e.g. priority decisions).
- `deep-merge.ts`: keep it a pure function. Do not add I/O or NestJS decorators to this file.

## Error Contract

- `ProfileNotFoundError` (thrown by the native provider) → 404 in the controller
- `VaultUnavailableError` (thrown by the vault provider) → 503 in the controller
- Any other error propagates unchanged (never swallowed)

## Abstraction Principle

- Do not introduce abstractions before a second real use case exists.
  Example: with only two providers (native, vault) right now, don't create a shared
  `ConfigSource` interface. Decide once a third provider (e.g. a separate secrets manager) is actually added.
- Move shared utilities out only when used in three or more places.

## Route Parameter Safety

- `service` and `profile` route params are used as-is to build a filesystem path
  (`native-config.provider.ts`) and a Vault API path (`vault-config.provider.ts`).
  Without whitelist regex validation (`^[A-Za-z0-9][A-Za-z0-9_-]*$`-shaped) at the controller entry
  point, this leads directly to path traversal. Apply the same validation to any new route
  parameter that flows into a path.

## Async

- All I/O is `async`/`await`. Use async/await consistently instead of promise chaining.
- External calls (Vault) use Node 26's global `fetch`. Do not add a separate HTTP client library.
