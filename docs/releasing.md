# Releasing Velocious

Velocious patch releases use `npm run release:patch`. This is a side-effectful maintainer command: it authenticates with npm, switches to and synchronizes `master`, bumps the patch version without creating a Git tag, builds the package, commits and pushes the version files directly to `master`, and publishes to npm.

## Before running the release

1. Obtain explicit release approval.
2. Confirm the intended feature/fix PR is merged and all required checks are green at its current head.
3. Start from a clean checkout whose `master` exactly matches `origin/master`.
4. Inspect the installed `release-patch` implementation before use when its dependency version changes; do not assume its side effects are unchanged.
5. In the same project Docker environment that will run the release, install the lockfile dependencies from scratch with `npm ci`. `release-patch` does not install dependencies, so a persistent container's existing `node_modules` is not fresh-install proof.
6. Verify npm authentication with the same temporary npm configuration that publication will use. Never place registry tokens in the repository or print them in logs.

Do not manually change the Velocious version before running the helper. `release-patch` updates both `package.json` and `package-lock.json` and creates the `chore: bump patch version` commit.

## Run the release

```sh
npm run release:patch
```

The helper pushes the version commit before it runs `npm publish`. If publication fails after the push, do not rerun the helper blindly: first reconcile the remote `master`, local version, and npm registry state so a second patch bump is not created accidentally.

## Verify the published release

A successful command exit is not sufficient. Read the exact version back from the public registry and verify that its immutable source identity matches the pushed release commit:

```sh
VERSION="$(npm view velocious version)"
npm view "velocious@$VERSION" version gitHead dist.integrity dist.shasum dist.tarball --json
git fetch origin
git show "origin/master:package.json"
```

Confirm all of the following:

- `origin/master` contains the reported version.
- Registry `gitHead` equals the exact `origin/master` release commit.
- Registry integrity, shasum, and tarball URL are present.
- The downloaded registry tarball contains the required `build/` output and executable CLI.
- A fresh temporary consumer can install `velocious@$VERSION` from npm and import its public entrypoint.
- The release checkout remains clean after lifecycle scripts finish.

Recent Velocious releases intentionally use the pushed default-branch version commit plus npm `gitHead` as their immutable identity; `release-patch` does not create a tag. Do not invent a release tag unless the repository's release convention is deliberately changed.
