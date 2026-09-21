// Runs before any e2e spec file's imports. NestConfigModule.forRoot({ validate })
// runs synchronously when AppModule is first imported, so VAULT_ADDR/VAULT_TOKEN
// must already be set in process.env before that import happens — a spec file's
// own beforeAll() runs too late for this.
process.env.VAULT_ADDR ??= 'http://vault.test';
process.env.VAULT_TOKEN ??= 'test-token';
