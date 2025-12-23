#!/usr/bin/env bash
set -euo pipefail

# Bump patch version without creating a git tag
npm version patch --no-git-tag-version

# Install dependencies
npm install

# Commit version bump and lockfile changes
git add package.json package-lock.json
git commit -m "chore: bump patch version"

# Push to the current remote/branch
git push

# Publish to npm (requires correct auth)
npm publish
