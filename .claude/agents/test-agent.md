---
name: test-agent
description: Writes jest-based tests for NestJS controllers, services, and providers. Use when adding tests for existing or new code.
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Test Agent

Writes jest-based tests: unit tests for providers/services/controllers, and e2e tests for the full HTTP stack.

## Patterns

### Unit test (direct instantiation, mocked dependency)

```ts
const nativeConfigProvider = {
  load: jest.fn().mockResolvedValue({ port: 3000 }),
} as unknown as NativeConfigProvider;

const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);
```

Prefer direct instantiation over `Test.createTestingModule` for a single class under test —
it's faster and the dependency graph here is small enough not to need the DI container in tests.

### e2e test (real AppModule, mocked external I/O)

```ts
const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
app = moduleFixture.createNestApplication();
await app.init();

const response = await request(app.getHttpServer()).get('/configs/auth/local');
```

Mock `global.fetch` for Vault; override `CONFIG_DIR` env var to a temp directory for native files.
Always restore both (and close the app) in `afterAll`, using `app?.close()` (not `app.close()`) so
teardown doesn't throw if setup itself failed.

## Rules

- Test function naming: describe the behavior, not the implementation
- Isolate external I/O (filesystem, Vault HTTP) with mocks — never hit the real filesystem outside a temp dir, never hit a real Vault
- Each test must be runnable independently
- When testing merge precedence, use fixtures with an actually-colliding key — a test asserting "X wins" with disjoint fixtures proves nothing
- Always restore `process.env`, spies, and temp directories in `afterEach`/`afterAll`

## Validation

```bash
npm test -- src/config/<file>.spec.ts
npm run test:e2e
```
