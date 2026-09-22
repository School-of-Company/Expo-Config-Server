# Config Server Security Rules

## Strictly Forbidden

- Reading or printing `.env`, `.env.*` files
- Printing `VAULT_TOKEN` or any other Vault credential
- Logging the response body returned by `VaultConfigProvider` (it may contain secrets)
- Hardcoding Vault tokens, DB passwords, or any credential in code
- Committing real secret values into `configs/*.yml` — that tree is for non-secret settings only, Vault owns secrets
- Reading files under a `secrets/` directory if one is ever introduced

## Environment Variable Management

The config server's own bootstrap values (`CONFIG_DIR`, `VAULT_ADDR`, `VAULT_TOKEN`) are read from
`process.env` only inside their respective provider. The controller and service layers never read
`process.env` directly.

```ts
// only inside vault-config.provider.ts
const vaultAddr = process.env.VAULT_ADDR;
const vaultToken = process.env.VAULT_TOKEN;
```

## Route Parameter Injection

- `service`/`profile` params must never reach a file path or a Vault API path without validation
  (see the Route Parameter Safety section in `.claude/rules/architecture.md`).
- A value that fails the whitelist regex returns 400 and is blocked at the controller level before
  it ever reaches a provider.

## Vault Response Handling

- Never forward a malformed Vault 200 response body to the client as-is — a parse failure maps to
  `VaultUnavailableError` and responds 503.
- A 404 from a specific Vault path means "no secret at that path" and is not an error — treat it as
  an empty object.

## Error Messages to Clients

- Do not expose internal details (Vault address, raw network error strings) in the message carried
  by an `HttpException`. Send detail to server logs; respond to clients with a generalized message.

## Logging

- Never include `VAULT_TOKEN`, Vault response bodies, or the contents of any `secret/*` path in logs
- Do not log full request/response bodies for `/configs/:service/:profile` in production
- Use structured logging (JSON) if logging is added
