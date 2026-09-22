# Fix Bug

## Steps

1. **Reproduce** — Confirm the bug with `npm test`, `npm run test:e2e`, or direct execution.
2. **Trace** — Error message → stack trace → source file.
3. **Understand** — Read the code. Do not guess.
4. **Minimal fix** — Fix only the root cause. Do not touch unrelated code.
5. **Regression test** — Add a test that catches the same bug.
6. **Validate** — Full `npm test && npm run test:e2e` pass, `npx tsc -p tsconfig.build.json --noEmit` clean.
7. **Report** — Root cause, fix, before/after behavior difference.

## Notes

- Minimize the diff with `git diff`.
- Do not declare completion without a test.
