---
name: auto-commit
description: Automatically stage and commit git changes when files change (watch-based auto-commit), with optional push. Use when the user wants auto-commits, a git watch/commit watcher, or a commit-on-change workflow.
---

# Auto Commit

Automatically commit git changes as files change. Two flavors: an on-demand
commit-all helper, and a background file watcher that commits on every change.

## When to use

- User asks to "auto commit", "commit whenever files change", or "watch and
  commit".
- A background watcher that snapshots work-in-progress at each save.

## On-demand: commit everything staged or new

For a one-shot "commit what changed now", use the helper script:

```bash
./scripts/auto_commit.sh "message"
```

If `<message>` is omitted, the script builds one from the changed paths and
the current time. Stage with `git add -A`, commit only if there is something
to commit, and skip the commit step if the tree is clean.

## Watch mode: commit on every change

Watch the repo and commit whenever tracked files change. Uses `git` polling
(no extra dependencies) or `inotifywait` when available.

```bash
./scripts/watch_commit.sh          # commit message auto-generated each time
./scripts/watch_commit.sh "wip"    # fixed message prefix + timestamp
```

- Polls every 2 seconds for changed tracked files.
- Commits on the current branch only; does **not** auto-push.
- Ctrl+C stops the watcher.

### Optional auto-push

To also push after each commit, pass `--push`:

```bash
./scripts/watch_commit.sh --push
```

## Recommended guardrails

- Only auto-commit **tracked** content; never force-add secrets. Respect
  `.gitignore` (`.env`, credentials).
- Prefer a short `wip:` message prefix for auto-commits so they are easy to
  squash or reset later.
- Run the watcher only on a scratch/work branch, not directly on `main`, to
  keep history clean.
- The watcher is local; it does not survive reboot. Wrap it in a service or a
  `hooks/` post-save trigger if persistence is needed.

## Files

- `scripts/auto_commit.sh` — one-shot stage-and-commit.
- `scripts/watch_commit.sh` — background watcher with optional `--push`.
