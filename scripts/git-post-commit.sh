#!/bin/sh
# Push the current branch after a successful commit (used by .husky/post-commit).
# Skips quietly when no origin remote is configured (e.g. local-only clone).

git remote get-url origin >/dev/null 2>&1 || exit 0

branch=$(git branch --show-current)
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  git push
else
  git push -u origin "$branch"
fi
