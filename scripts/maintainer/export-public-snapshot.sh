#!/usr/bin/env bash
set -euo pipefail

remote_url="${1:-${PUBLIC_REMOTE_URL:-}}"
branch="${2:-${PUBLIC_BRANCH:-main}}"
commit_message="${PUBLIC_COMMIT_MESSAGE:-Initial public snapshot}"

if [ -z "$remote_url" ]; then
  echo "Usage: $0 <public-remote-url> [branch]" >&2
  echo "Or set PUBLIC_REMOTE_URL and optionally PUBLIC_BRANCH." >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

git -C "$repo_root" archive --worktree-attributes --format=tar HEAD | tar -x -C "$tmp_dir"

git -C "$tmp_dir" init -b "$branch" >/dev/null
git -C "$tmp_dir" add -A

if git -C "$tmp_dir" ls-files | grep -E '(^|/)(codex|\.codex|\.agent|agent)(/|$)' >/dev/null; then
  echo "Public snapshot contains blocked agent/codex paths." >&2
  git -C "$tmp_dir" ls-files | grep -E '(^|/)(codex|\.codex|\.agent|agent)(/|$)' >&2
  exit 1
fi

git -C "$tmp_dir" commit -m "$commit_message" >/dev/null
git -C "$tmp_dir" remote add public "$remote_url"
git -C "$tmp_dir" push --force public "$branch"

echo "Pushed public snapshot to $remote_url ($branch)."
