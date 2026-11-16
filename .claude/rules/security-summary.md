---
paths:
  - "**"
---

# Security rules summary

> Full rules: `.claude/rules/security.md`

- Do not read or print `.env`, `.env.*` files
- Never log `VAULT_TOKEN` or any value returned by `VaultConfigProvider`
- Never hardcode Vault tokens or credentials in code
- Never commit real secret values into `configs/*.yml` — that file tree is for non-secret config only
- Private/signing keys go only in the owning service's Vault path, never `secret/application` — JWT key delivery convention: `docs/jwt-signing-key.md`
- Never include tokens, keys, or Vault response bodies in logs or error messages sent to clients
