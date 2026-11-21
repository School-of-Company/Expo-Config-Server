---
paths:
  - "src/**/*.ts"
  - "test/**/*.ts"
---

# Coding standards

- Keep I/O-free logic (like the merge algorithm) as pure functions — `deep-merge.ts` is the reference
- External I/O (file reads, HTTP calls) belongs only in provider classes, never directly in a service or controller
- Read Vault/CONFIG_DIR-style env vars only inside their provider — never `process.env` directly in a controller or service
- Whenever a route parameter is used to build a file path or an external API path, validate it against a whitelist regex first (path traversal prevention)
- Strict TypeScript typing — no `any`; narrow parsed results explicitly
- Comments only when the WHY is non-obvious (e.g., why deep merge instead of shallow merge)
