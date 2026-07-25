# Releasing Velocious

Velocious patch releases use `npm run release:patch`. This is a side-effectful maintainer command: it authenticates with npm, switches to and synchronizes `master`, bumps the patch version without creating a Git tag, builds the package, commits and pushes the version files directly to `master`, and publishes to npm.

Package builds run through the `prepack` lifecycle. Bare `npm install` and `npm ci` commands do not run Velocious's project build; `npm pack`, `npm publish`, and Git dependency installs build the distributable before packaging it.

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

The helper's stages are npm authentication, checkout/fetch/merge of `master`, patch version bump and lifecycle/build, version-file commit, push to `origin/master`, and `npm publish`, in that order. It creates neither a Git tag nor a GitHub Release.

If any stage fails, do not rerun the helper. Record the last command that completed, then reconcile local `HEAD`, `origin/master`, the versions in `package.json` and `package-lock.json`, and `npm view velocious versions --json` before taking another side-effectful action. Recover according to the stage reached:

- **Before the version commit exists:** no release commit has been pushed or published. Inspect `git status` for version/build/lifecycle changes. Preserve them with `git stash push -u` if they are useful for diagnosis, then restore the clean pre-release commit before retrying the entire helper.
- **The release commit exists locally, but its push failed:** fetch `origin` and verify that the release version is absent from npm. If `origin/master` does not contain the commit, fix the push problem and push that exact existing commit; do not rerun the helper and create another bump. If abandoning it, first preserve the commit on a recovery branch and confirm it is neither remote nor published before resetting local `master` to `origin/master`.
- **The release commit was pushed, but publication failed:** verify that local `HEAD` and `origin/master` are the same release commit and that both version files contain its version. If npm does not contain that version, fix the publication problem and run `npm publish` from that exact clean commit. If npm already contains it, do not publish or run the helper again; proceed to verification.
- **Publication succeeded, but independent verification failed:** do not rerun either the helper or `npm publish`. Re-fetch `origin/master`, re-read the exact version's npm metadata, and re-download the artifact. Resolve whether the check was transient or whether the remote commit, registry `gitHead`, registry checksums, or downloaded contents disagree. Treat an identity or content mismatch as an incident requiring investigation, not as a reason to create another release.

At every boundary, use the exact stage reached rather than command exit alone: a timed-out push or publish may have succeeded remotely. Keep a recovery branch or stash before discarding local state, and never delete or rewrite a pushed release commit.

## Verify the published release

A successful command exit is not sufficient. Read the exact version back from the public registry and verify that its immutable source identity matches the pushed release commit:

```sh
VERSION="$(npm view velocious version)"
npm view "velocious@$VERSION" version gitHead dist.integrity dist.shasum dist.tarball --json
git fetch origin
git rev-parse origin/master
git show "origin/master:package.json"

ARTIFACT_DIR="$(mktemp -d)"
(
  cd "$ARTIFACT_DIR"
  TARBALL="$(npm pack --silent "velocious@$VERSION")"
  printf 'sha512-%s\n' "$(openssl dgst -sha512 -binary "$TARBALL" | openssl base64 -A)"
  sha1sum "$TARBALL"
)
```

Confirm all of the following:

- `origin/master` contains the reported version.
- Registry `gitHead` equals the exact commit ID at `origin/master`, not merely a local commit with the same files.
- The freshly downloaded tarball's computed `sha512-...` value equals registry `dist.integrity`, and its `sha1sum` equals registry `dist.shasum`.
- Registry tarball URL is present.
- The downloaded registry tarball contains the required `build/` output and executable CLI.
- A fresh temporary consumer can install `velocious@$VERSION` from npm and import its public entrypoint.
- The release checkout remains clean after lifecycle scripts finish.

Recent Velocious releases intentionally use the pushed default-branch version commit plus npm `gitHead` as their immutable identity; `release-patch` creates neither a Git tag nor a GitHub Release. Do not invent either unless the repository's release convention is deliberately changed.
