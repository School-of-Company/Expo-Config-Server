# Write Test

## Steps

1. **Understand** — Read the code under test. Identify inputs, outputs, and side effects (filesystem reads, HTTP calls).
2. **Check existing patterns** — See how sibling `*.spec.ts` files in `src/config/` set up mocks.
3. **Write cases** — Happy path → error cases (404/503/400 where applicable) → edge cases.
4. **Isolate external deps** — Mock the filesystem (temp dir + `CONFIG_DIR` override) and `global.fetch` (Vault), or mock the collaborator class directly with `jest.fn()`.
5. **Run** — `npm test -- src/config/<file>.spec.ts`

## Unit Test Pattern (direct instantiation)

```ts
const vaultConfigProvider = {
  load: jest.fn().mockResolvedValue({ dbPassword: 'secret' }),
} as unknown as VaultConfigProvider;

const service = new ConfigMergeService(nativeConfigProvider, vaultConfigProvider);
const result = await service.getMergedConfig('auth', 'local');
```

## e2e Pattern (real AppModule + supertest)

```ts
const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
app = moduleFixture.createNestApplication();
await app.init();

const response = await request(app.getHttpServer()).get('/configs/auth/local');
expect(response.status).toBe(200);
```

Clean up with `app?.close()` (not `app.close()`), restore env vars by deleting keys that were
`undefined` before the test (assigning `undefined` to `process.env.X` coerces to the string
`"undefined"`, not deletion), and restore any `fetch` spy.

## Notes

- Each test must be runnable independently.
- When testing merge precedence ("X wins over Y"), the fixtures must share a colliding key — disjoint fixtures only prove union, not precedence.
- Always test the validation/error paths (400 for invalid params, 404 for undefined profile, 503 for Vault failure), not just the happy path.
