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
  git commit -m "<prefix>: <short description of what changed>"
fi
```

## Choosing a prefix

Use a conventional-commit-style prefix that matches the change, and a short
imperative description. Pick from:

- `feat:` a new feature or capability.
- `fix:` a bug fix.
- `docs:` documentation-only changes (`CLAUDE.md`, skills, READMEs, comments).
- `style:` formatting/whitespace with no logic change.
- `refactor:` code restructuring with no behavior change.
- `chore:` tooling, config, or housekeeping changes.
- `wip:` unfinished/in-progress work that is not yet a coherent unit.

Examples:

- `docs: add brand-colors skill mention to CLAUDE.md`
- `feat: add user authentication`
- `fix: correct broken link in footer`
- `chore: update dependencies`

## Recommended guardrails

- Only auto-commit **tracked** content; never force-add secrets. Respect
  `.gitignore` (`.env`, credentials).
- Prefer a short `wip:` message prefix for auto-commits so they are easy to
  squash or reset later.
- Prefer a work branch over `main` so history stays clean.
