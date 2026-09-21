# Write PR

## Steps

1. `git fetch origin main` — update local tracking branch.
2. `git log origin/main..HEAD --oneline` — list commits.
3. `git diff origin/main...HEAD --stat` — changed file stats.
4. `git diff origin/main...HEAD` — full diff.
5. Propose 3 PR title candidates and ask the user to pick one.
6. Wait for the user to select a title.
7. Write the PR body to `/tmp/pr_body.md`, filling in `.github/PULL_REQUEST_TEMPLATE.md`'s sections.
8. Run `gh pr create` with `--body-file /tmp/pr_body.md`.

## PR Title Format

- No type prefix (`feat:`, `chore:`, etc.).
- Concise, present-tense description of what this PR does.
- Max 50 characters.

Example candidates:
```
1. Initial Vault-backed config server implementation
2. Validate service/profile params, harden Vault error handling
3. Add config merge logic and e2e coverage
```

## PR Body Format

Fill in `.github/PULL_REQUEST_TEMPLATE.md`'s sections:

- **💡 Background & Overview**: the problem and context
- **📃 What Was Done**: the work done in this PR
- **🙋‍♂️ Review Notes**: things you were unsure about, intent, what to ask reviewers to focus on
- **✅ PR Checklist**: check only items you have actually verified
- **🎸 Other**: anything else worth noting

## Creating the PR

Write body to a temp file, then create the PR:

```bash
cat > /tmp/pr_body.md << 'BODY'
## 💡 Background & Overview

...

Resolves: #{issue-number}

## 📃 What Was Done

...

## 🙋‍♂️ Review Notes

...

## ✅ PR Checklist

- [ ] Were any docs that need to change due to this work updated?
- [ ] Has anything that needs to be shared with teammates after this work been shared?
- [ ] Does the code you wrote actually work? (`npm test`, `npm run test:e2e`)
- [ ] Is the target merge branch correct?
- [ ] Does this PR contain anything unrelated to its stated purpose?

## 🎸 Other
BODY

gh pr create --title "<selected title>" --body-file /tmp/pr_body.md --assignee @me
```

## Rules

- Do not include anything not in the diff.
- Only check items you have actually verified.
- Always propose 3 title candidates and wait for user selection before creating the PR.
- Branch must be pushed before running `gh pr create`.
- Always use `--body-file` (never inline heredoc) to avoid hook parse errors.
