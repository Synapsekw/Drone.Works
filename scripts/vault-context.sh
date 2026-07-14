#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

section() {
  printf '\n## %s\n' "$1"
}

section "Repository"
printf 'root: %s\n' "$ROOT"
printf 'timestamp: %s\n' "$(date '+%Y-%m-%d-%H%M %Z')"
printf 'branch: %s\n' "$(git -C "$ROOT" branch --show-current)"
printf 'head: %s\n' "$(git -C "$ROOT" rev-parse --short HEAD)"

section "Working tree"
git -C "$ROOT" status --short

section "Recent commits"
git -C "$ROOT" log --oneline --decorate -8

section "North-star Now"
awk '
  /^## Now$/ { capture = 1; next }
  capture && /^## / { exit }
  capture { print }
' "$ROOT/vault/00-north-star.md"

section "Latest sessions"
find "$ROOT/vault/sessions" -maxdepth 1 -type f -name '*.md' -print \
  | sort -r \
  | sed -n '1,3p' \
  | while IFS= read -r note; do
      printf '\n### %s\n' "${note#"$ROOT/"}"
      sed -n '1,120p' "$note"
    done
