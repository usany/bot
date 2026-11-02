#!/usr/bin/env bash
# One-shot auto-commit: stage everything (respecting .gitignore) and commit.
# Usage: auto_commit.sh ["message"]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

msg="${1:-}"
if [[ -z "$msg" ]]; then
  # Build a message from changed paths and a timestamp.
  changed="$(git status --porcelain | awk '{print $1}' | cut -c1-3 | sort -u | tr '\n' ',' | sed 's/,$//')"
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  msg="wip: auto-commit $ts${changed:+\n\nchanged: $changed}"
fi

git add -A

# Nothing to commit? Exit cleanly.
if git diff --cached --quiet; then
  echo "nothing to commit"
  exit 0
fi

git commit -m "$msg"
echo "committed: $(git rev-parse --short HEAD)"
