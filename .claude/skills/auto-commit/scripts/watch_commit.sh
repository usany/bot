#!/usr/bin/env bash
# Watch for changes to tracked files and auto-commit on every change.
# Usage: watch_commit.sh ["message-prefix"] [--push]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

prefix="${1:-wip}"
push=0
for arg in "$@"; do
  [[ "$arg" == "--push" ]] && push=1
done

echo "watching $(pwd) — Ctrl+C to stop"
if [[ "$push" == "1" ]]; then echo "push: enabled"; fi

last_state=""
while true; do
  # Snapshot of tracked working-tree state (cheap; no staging).
  state="$(git status --porcelain --untracked-files=no)"
  if [[ -n "$state" && "$state" != "$last_state" ]]; then
    if git diff --quiet -- . && git diff --cached --quiet; then
      # tracked tree clean but status non-empty can happen briefly; skip.
      last_state="$state"
      sleep 2
      continue
    fi
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    git add -A
    if git diff --cached --quiet; then
      last_state="$state"
      sleep 2
      continue
    fi
    git commit -m "$prefix: $ts" --quiet
    echo "committed $(git rev-parse --short HEAD) @ $ts"
    if [[ "$push" == "1" ]]; then
      git push --quiet
      echo "pushed"
    fi
  fi
  last_state="$state"
  sleep 2
done
