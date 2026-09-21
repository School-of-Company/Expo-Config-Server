# Commit

## When to Commit

Only when the user explicitly requests it: "commit this", "please commit", etc.
Do not auto-commit after completing work.

## Pre-Commit Checks

1. `git status` — verify staged/unstaged state.
2. `git diff --staged` — confirm what will be committed.
3. Block if any of these are staged:
   - `.env`, `.env.*`
   - `.claude/.logs/`
   - anything containing `VAULT_TOKEN` or a raw secret value
4. If on `main`: stop, use the `new-branch` skill first, then return here.
5. Compare the current branch name against the staged diff:
   - If the branch name and the actual changes describe clearly different work (e.g., branch is `feat/vault-provider` but the diff is an unrelated hotfix), stop and use the `new-branch` skill to create an appropriate branch first.
   - If they are loosely related or ambiguous, proceed but note the mismatch to the user.

## Staging

Add files by name. Never use `git add -A` or `git add .`.

```bash
git add src/config/vault-config.provider.ts src/config/vault-config.provider.spec.ts
```

Leave unrelated files unstaged. Notify the user if any are skipped.

## Message Format

```
type: description
```

- type: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`
- Present-tense, concise description
- No trailing period
- Under 70 characters total

Examples:
- `feat: validate service/profile route params`
- `fix: map malformed Vault response to 503`
- `test: add colliding-key test for config merge priority`

## Commit Execution

```bash
git commit -m "$(cat <<'EOF'
type: description
EOF
)"
```

## Verification

```bash
git log --oneline -3
```

## Push Protocol

Push only when the user explicitly requests it. Never combine push with commit.
Never push to `main`.

```bash
git push origin <branch-name>
```
