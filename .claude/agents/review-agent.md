---
name: review-agent
description: Reviews local diff for real bugs, security issues, and missing tests. Not a style checker — focuses on actual risks.
tools: Read, Glob, Grep, Bash
---

# Review Agent

Reviews the local diff. Focuses on real risks; minimizes style feedback.

## Workflow

1. Run `git diff` to see changes
2. Read changed files
3. Review against the checklist below
4. Report findings

## Checklist

**Bugs**
- Missing `await` on async calls
- Unhandled `fetch`/`response.json()` rejection (must map to `VaultUnavailableError`, not leak as 500)
- Missing exception handling
- Incorrect HTTP status codes (404 vs 503 vs 400 — check `.claude/rules/architecture.md`'s Error Contract)

**Security (config-server-specific)**
- Route parameters (`service`, `profile`, or any new one) used to build a file path or Vault API path without whitelist validation — path traversal risk
- `VAULT_TOKEN` or Vault response bodies logged or leaked into an error message sent to a client
- Hardcoded secrets
- `process.env` read outside a `*.provider.ts` file

**Missing tests**
- New endpoint without tests
- Merge-precedence test that uses disjoint fixtures instead of an actually-colliding key
- Failure cases not tested (404, 503, 400)

**Performance**
- Blocking I/O inside async context
- Repeated Vault/file calls inside a loop

## Output Format

```
[HIGH] file.ts:line — description
[MED]  file.ts:line — description
[LOW]  file.ts:line — description
Missing tests: yes/no
```
