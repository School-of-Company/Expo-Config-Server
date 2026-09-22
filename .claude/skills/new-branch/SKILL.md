# New Branch

## When to Use

Before starting any new work. Always branch off `origin/main`.
Never commit directly to `main`.

## Inputs

- Branch type: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`
- Scope: short kebab-case description of the work (e.g. `vault-provider`, `path-validation`)

## Steps

1. Fetch latest main:
   ```bash
   git fetch origin main
   ```

2. Create and switch to branch:
   ```bash
   git checkout -b <type>/<scope> origin/main
   ```

3. Push and set upstream:
   ```bash
   git push -u origin <type>/<scope>
   ```

## Branch Naming

| Type | When |
|------|------|
| `feat/<scope>` | New feature |
| `fix/<scope>` | Bug fix |
| `chore/<scope>` | Tooling, config, dependency |
| `refactor/<scope>` | Code restructure without behavior change |
| `test/<scope>` | Tests only |
| `docs/<scope>` | Documentation only |

## Rules

- Always branch from `origin/main`, not local `main`.
- Scope must be specific enough to identify the work (not `update` or `changes`).
- Do not reuse old branches for new work.
