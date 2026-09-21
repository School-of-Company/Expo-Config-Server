# Review Local Diff

## Steps

1. `git diff` — see current changes.
2. `git diff --name-only` — list changed files.
3. Read each file — understand the context before and after.
4. Review against criteria below.
5. Report findings.

## General Review Criteria

**Bugs (must check)**
- Missing `await` on async calls
- Unhandled `fetch`/`response.json()` failure
- Missing exception handling
- Incorrect HTTP status codes

**Security**
- Route parameter used to build a file path or Vault API path without whitelist validation
- Hardcoded secrets
- `VAULT_TOKEN` or Vault response bodies in logs or client-facing error messages

**Missing tests**
- New endpoint without tests
- Failure cases not tested
- Merge-precedence assertions with disjoint (non-colliding) fixtures

**Performance**
- Blocking I/O inside async context
- Repeated Vault/file calls inside a loop

## Config-Server-Specific Review Criteria

**Path traversal**
- Any new route param that reaches `fs.readFile`/`fs.join` or a Vault URL path must be validated against a whitelist regex before use

**Error contract**
- `ProfileNotFoundError` → 404, `VaultUnavailableError` → 503, invalid param shape → 400. Confirm nothing else gets silently remapped or swallowed.

**Vault 404 vs. failure**
- A 404 from a specific Vault path means "no secret there" (return `{}`), not an error. Anything else non-2xx, or a network failure, or a malformed 200 body, must become `VaultUnavailableError`.

**Deep merge correctness**
- Any new merge call must not lose sibling keys (shallow-merge bug) and must resolve conflicts in the documented priority order.

## Output Format

```
[HIGH] file.ts:line — description
[MED]  file.ts:line — description
[LOW]  file.ts:line — description
Config-server-specific issues: [if any]
Missing tests: yes/no
```

Style issues are handled by eslint. Do not duplicate.
