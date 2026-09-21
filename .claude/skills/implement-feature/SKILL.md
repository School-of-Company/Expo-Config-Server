# Implement Feature

## Steps

1. **Understand** — Read related existing files. Check the same layer's controller, service, and provider.
2. **Plan** — List which files to create or modify.
3. **Provider first (if new I/O is needed)** — external I/O (filesystem, HTTP) goes in a `*.provider.ts`, nothing else.
4. **Implement service** — Business logic / merge orchestration. Delegate I/O to provider(s).
5. **Wire controller** — Add endpoint, validate any route param used to build a path (whitelist regex), map known error types to HTTP status.
6. **Write tests** — Add jest cases for new behavior, including failure paths.
7. **Validate** — `npm test && npm run test:e2e && npx tsc -p tsconfig.build.json --noEmit`
8. **Report** — Changed files, validation result, remaining risks.

## Notes

- Follow existing patterns. Explain if introducing a new pattern.
- Access `process.env` only inside `*.provider.ts` files.
- Isolate external I/O (filesystem, Vault) with mocks in tests.
- Do not introduce a shared abstraction across providers before a second real need exists.
