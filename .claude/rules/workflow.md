---
paths:
  - "**"
---

# Workflow

## Validation Commands

```bash
# Required
npm test                # Unit tests (jest)
npm run test:e2e        # e2e tests (real HTTP stack)

# Recommended
npx tsc -p tsconfig.build.json --noEmit   # Type check
npm run lint             # eslint

# Run
npm run start:dev
```

## Agent Routing

| Task | Agent |
|------|-------|
| Add new feature | `feature-agent` |
| Fix a bug | `fix-agent` |
| Write tests | `test-agent` |
| Code review | `review-agent` |
| Write PR description | `pr-agent` |
| Apply review feedback | `feedback-agent` |

## Feature Development Flow

1. `git status` — check current state
2. Create branch off `develop`: `git checkout -b feat/<scope> origin/develop` (or use `new-branch`)
3. Implement with `feature-agent`
4. Verify with `npm test` and `npm run test:e2e`
5. Verify with `npx tsc -p tsconfig.build.json --noEmit`
6. Review diff with `review-agent`
7. Draft PR into `develop` with `pr-agent`

## Bug Fix Flow

1. Reproduce the bug
2. `git checkout -b fix/<scope> origin/develop`
3. Apply minimal fix with `fix-agent`
4. Add regression test
5. Verify with `npm test`

## Test Writing Flow

- Write jest-based tests with `test-agent`
- Unit test: mock the provider/service being consumed with `jest.fn()`, direct instantiation (no DI container needed for a single class)
- e2e test: boot the real `AppModule` via `@nestjs/testing` + `supertest`, mock `global.fetch` for Vault, override `CONFIG_DIR` for native files
- Isolate side effects: always restore `process.env`, spies, and temp dirs in `afterAll`/`afterEach`

## Branching Model

- `develop` is the integration branch. All `feat/`/`fix/`/`chore/`/`refactor/`/`test/`/`docs/`
  branches fork from `origin/develop` and PR back into `develop`.
- `main` is the stable/release branch. It only moves via a separate, manual `develop` → `main`
  release PR — day-to-day feature work never targets `main` directly.
- CI runs on push to both `develop` and `main`, and on every PR.

## Git Rules

- No direct commits to `main` or `develop`
- Do not commit or push without explicit request
- Always run `git status` before starting work
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`
- Do not add a `Co-Authored-By: Claude` (or similar AI attribution) trailer to commits or PRs in this repo — commits are authored by the person running Claude Code, full stop
