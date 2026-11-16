---
paths:
  - "src/logging/**"
  - "src/main.ts"
---

# Logging

The Expo log standard, shared by every service (Spring and Nest) so the shared Loki in Expo-Monitoring labels them the same way:

- Every line on stdout is one JSON object with at least `@timestamp` (ISO-8601), `level` (uppercase
  `TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`; Nest `fatal` is written as `ERROR`, `verbose` as `TRACE`),
  `service` (`expo-config-server`), `module` and `message`. Errors add `stack_trace`. Nothing else goes
  to stdout — never `console.log` in `src/`.
- The log pipeline reads only these key names and has no per-service fallback. If this server's logs
  are missing or mis-labelled, fix the log output here, never add parsing fallbacks to the pipeline.
- `src/logging/json-logger.ts` (`JsonLogger`, pino) is installed with `Logger.overrideLogger()` at the
  top of `main.ts`, and `AppModule` is imported after it, so env validation failures are JSON too.
  `module` is the Nest logger context (`new Logger(Foo.name)`), the same mapping as nestjs-pino's
  `renameContext: 'module'`; lines without a context get `app`. Never pass `module` at the call site.
- `LOG_LEVEL` (default `info`). With `NODE_ENV=local` (or `PROFILE=local`) stdout is also mirrored to
  `${EXPO_LOG_DIR:-~/.expo/logs}/expo-config-server/app.log` for the local Loki file tail. Elsewhere
  stdout only (the container runtime captures it); add no log file settings there.
- Access log: `src/logging/http-access-log.middleware.ts`, registered in `main.ts` before routing, writes one
  line per request with module `HttpAccess`: `GET /configs/:service/:profile status: 200 (12ms)` (matched route template,
  else the raw path without query, max 200 chars). INFO <400, WARN 4xx, ERROR 5xx and 499 (client closed first).
  `/health`, `/metrics`, `/actuator`, `/docs` are skipped. `HTTP_ACCESS_LOG_ENABLED=false` turns it off (default on).
  Never add query strings, headers, cookies, or bodies to it.
- Never log `VAULT_TOKEN`, Basic auth passwords, or any served config value.
