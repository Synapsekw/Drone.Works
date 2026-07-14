#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
NOTE_ID="$(date '+%Y-%m-%d-%H%M')"
BRANCH="$(git -C "$ROOT" branch --show-current)"
HEAD="$(git -C "$ROOT" rev-parse --short HEAD)"
GIT_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-dir)"
COMMON_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"

section() {
  printf '\n## %s\n' "$1"
}

section "Wrap-up identity"
printf 'note-id: %s\n' "$NOTE_ID"
printf 'timestamp: %s\n' "$(date '+%Y-%m-%d %H:%M %Z')"
printf 'root: %s\n' "$ROOT"
printf 'checkout: %s\n' "$([[ "$GIT_DIR" == "$COMMON_DIR" ]] && printf 'primary' || printf 'linked-worktree')"
printf 'branch: %s\n' "${BRANCH:-detached}"
printf 'head: %s\n' "$HEAD"

section "Upstream"
if UPSTREAM="$(git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
  COUNTS="$(git -C "$ROOT" rev-list --left-right --count "$UPSTREAM...HEAD")"
  printf 'upstream: %s\n' "$UPSTREAM"
  printf 'behind: %s\n' "$(printf '%s\n' "$COUNTS" | awk '{print $1}')"
  printf 'ahead: %s\n' "$(printf '%s\n' "$COUNTS" | awk '{print $2}')"
else
  printf 'upstream: none\n'
fi

section "Working tree excluding Obsidian state"
PROJECT_STATUS="$(git -C "$ROOT" status --short -- . ':(exclude).obsidian')"
if [[ -n "$PROJECT_STATUS" ]]; then
  printf '%s\n' "$PROJECT_STATUS"
else
  printf 'clean\n'
fi

section "Obsidian state"
OBSIDIAN_STATUS="$(git -C "$ROOT" status --short -- .obsidian)"
if [[ -n "$OBSIDIAN_STATUS" ]]; then
  printf '%s\n' "$OBSIDIAN_STATUS"
else
  printf 'clean\n'
fi

section "North-star Now"
awk '
  /^## Now$/ { capture = 1; next }
  capture && /^## / { exit }
  capture { print }
' "$ROOT/vault/00-north-star.md"

section "Draft sessions"
FOUND_DRAFT=0
while IFS= read -r draft; do
  FOUND_DRAFT=1
  printf '\n### %s\n' "${draft#"$ROOT/"}"
  sed -n '1,160p' "$draft"
done < <(find "$ROOT/vault/sessions" -maxdepth 1 -type f -name '_draft-*.md' -print | sort)
if [[ "$FOUND_DRAFT" -eq 0 ]]; then
  printf 'none\n'
fi

section "Latest sessions"
find "$ROOT/vault/sessions" -maxdepth 1 -type f -name '*.md' ! -name '_draft-*.md' -print \
  | sort -r \
  | sed -n '1,3p' \
  | while IFS= read -r note; do
      printf '\n### %s\n' "${note#"$ROOT/"}"
      sed -n '1,160p' "$note"
    done

section "Privacy reminder"
printf '%s\n' 'Do not copy secrets, raw fixture values, private coordinates, identifiers, keychain material, or customer data into the vault.'
