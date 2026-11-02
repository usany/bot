---
name: auto-commit
description: Automatically stage and commit git changes after modifying files. Use when the user wants auto-commits or a commit-on-change workflow.
---

# Auto Commit

Automatically stage and commit git changes after every file change you make.
No scripts or watchers required — just run the git commands directly.

## When to use

- After modifying, creating, or deleting any files as part of a task.
- Whenever the user wants changes committed automatically as work progresses.

## How to commit

Stage everything (respecting `.gitignore`) and commit:

```bash
git add -A

# Nothing to commit? Skip the commit step.
if git diff --cached --quiet; then
  echo "nothing to commit"
else
  git commit -m "wip: <short description of what changed>"
fi
```

Prefer a short `wip:` message prefix describing the change, e.g.
`wip: add brand-colors skill mention to CLAUDE.md`.

## Recommended guardrails

- Only auto-commit **tracked** content; never force-add secrets. Respect
  `.gitignore` (`.env`, credentials).
- Prefer a short `wip:` message prefix for auto-commits so they are easy to
  squash or reset later.
- Prefer a work branch over `main` so history stays clean.
