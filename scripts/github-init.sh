#!/usr/bin/env bash
set -euo pipefail

# GitHub init — tries gh CLI then falls back to SSH remote
# Usage: bash scripts/github-init.sh [repo-name]

REPO_NAME="${1:-glimmer-cli}"
GH_USER="${GH_USER:-schererstefan}"
REMOTE_SSH="git@github.com:${GH_USER}/${REPO_NAME}.git"

echo "→ Initializing git repo: ${REPO_NAME}"
if [ ! -d .git ]; then
  git init
  git branch -M main
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    echo "→ Creating GitHub repo via gh: ${GH_USER}/${REPO_NAME}"
    gh repo create "${GH_USER}/${REPO_NAME}" --public --source=. --remote=origin --push || {
      echo "→ gh create failed, falling back to SSH remote"
      git remote add origin "${REMOTE_SSH}"
    }
  else
    echo "→ gh not authenticated (expected — SSH is primary). Adding SSH remote:"
    echo "  ${REMOTE_SSH}"
    git remote add origin "${REMOTE_SSH}" 2>/dev/null || git remote set-url origin "${REMOTE_SSH}"
    echo "→ Next: git add . && git commit -m 'initial' && git push -u origin main"
  fi
else
  echo "→ origin already exists: $(git remote get-url origin)"
fi

echo "Done. Check: git remote -v && git status --short"
