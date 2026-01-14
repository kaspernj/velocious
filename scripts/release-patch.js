#!/usr/bin/env node
import {execSync} from "node:child_process"

const run = (command) => {
  execSync(command, {stdio: "inherit"})
}

try {
  execSync("npm whoami", {stdio: "ignore"})
} catch {
  run("npm login")
}

// Bump patch version without creating a git tag.
run("npm version patch --no-git-tag-version")

// Install dependencies.
run("npm install")

// Commit version bump and lockfile changes.
run("git add package.json package-lock.json")
run('git commit -m "chore: bump patch version"')

// Push to the current remote/branch.
run("git push")

// Publish to npm (requires correct auth).
run("npm publish")
