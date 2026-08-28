# Rampway integration

[`rampway@0.4.0`](https://www.npmjs.com/package/rampway/v/0.4.0) exports an
authenticated durable deployment control plane for Velocious applications from
`rampway/velocious`. Rampway owns deployment execution, authentication,
idempotency, run and audit persistence, reconciliation, and its detached Node
worker. Velocious supplies only its existing route mounting, request and
database scopes, and framework error events.

This integration does not add a `Configuration.rampway` setting or restore the
former Velocious-owned deployment controllers and stores.

For background jobs, the ownership boundary extends beyond API mounting:
Velocious owns the jobs-main/worker protocol and handoff durability, Rollbridge
owns release-scoped generation processes and their asynchronous supervision, and
Rampway owns activation, the deploy lock, release-retention metadata, and cleanup
pins. A successful deployment must return after candidate activation and health,
without waiting for retired jobs generations or HTTP/WebSocket connections.
See [release-generation draining](background-jobs.md#release-generation-draining).

Velocious now provides the opt-in generation identity, fenced main/worker/report
protocol, candidate/active/retiring/retired lifecycle, retired-main recovery,
and acknowledged release-local Unix lifecycle commands. This is the framework
half of the contract, not a claim that current production orchestration is
already end-to-end compliant. Rollbridge must consume those commands in its
quiet/activation hooks, allocate a distinct jobs-main endpoint per release,
retain old mains and workers under durable supervision across later deploys and
runtime-owner recovery, and pin their releases. Rampway must order retirement
before activation and return deploy success/release its lock after healthy
candidate activation without waiting for any retired generation. TensorBuzz (or
another application integration) must pass one identical generation id,
endpoint, and release-local socket to the complete main/worker pool. Until those
downstream pieces land, do not describe the production stack as fully compliant.

## Install and mount

Install Rampway in the consuming application. Rampway 0.4.0 declares Velocious
`^1.0.574` as an optional peer dependency and requires Node 22 or newer, but the
mounted integration requires Velocious 1.0.577 or newer. Velocious 1.0.574
through 1.0.576 attempted an app-local controller import before honoring a
route hook's package-supplied `controllerClass`. A same-named app controller
could therefore shadow Rampway's authenticated controller. Velocious 1.0.577
makes `controllerClass` authoritative and closes that path.

```sh
npm install rampway@^0.4.0 velocious@^1.0.577
```

Mount the package export in the application's backend routes file. Tokens must
come from the application's backend-only secrets mechanism; there is no
environment-variable fallback.

```js
import {fileURLToPath} from "node:url"

import RampwayDeploymentApi from "rampway/velocious"
import Routes from "velocious/build/src/routes/index.js"
import deploymentSecrets from "./secrets/deployments.js"

const rampwayConfigPath = fileURLToPath(new URL("../../rampway.config.mjs", import.meta.url))
const workerBootstrapPath = fileURLToPath(new URL("./rampway-deployment-worker.js", import.meta.url))
const routes = new Routes()

routes.draw((route) => {
  route.mount(RampwayDeploymentApi, {
    accessTokens: deploymentSecrets.rampwayAccessTokens,
    at: "/rampway/deployments",
    databaseIdentifier: "default",
    projects: {
      "my-app": {
        stages: {
          production: {
            configPath: rampwayConfigPath,
            releaseBranch: "main"
          }
        }
      }
    },
    workerBootstrapPath
  })
})

export default {routes}
```

`accessTokens`, `at`, `projects`, and `workerBootstrapPath` are required.
`databaseIdentifier` defaults to `default`. `staleRunTimeoutMs` is optional and
defaults to 60 seconds. Rampway validates non-empty tokens, identifiers,
absolute config paths, Git-safe release branches, and the worker bootstrap's
real file path while mounting, so invalid backend configuration fails during
application startup.

Treat the mount prefix as reserved for Rampway. Route-resolver hooks are checked
before ordinary application routes, and changing `at` changes the stable hash
Rampway uses to scope durable records. Keep it stable across releases.

## Worker bootstrap

Each admitted run starts Rampway's package-owned detached worker. The configured
bootstrap module must be an absolute backend file that reconstructs the same
Velocious application configuration in the worker process:

```js
import {fileURLToPath} from "node:url"

import configurationResolver from "velocious/build/src/configuration-resolver.js"

const applicationDirectory = fileURLToPath(new URL("../../", import.meta.url))

export default async function createRampwayDeploymentWorkerContext() {
  return {
    configuration: await configurationResolver({directory: applicationDirectory})
  }
}
```

The reconstructed configuration must load the same routes, mount prefix,
database, backend secrets, and project/stage allowlist. Rampway passes only the
canonical bootstrap path and bounded mount/run identifiers to the detached
process; it does not pass bearer tokens or deployment targets as command
arguments.

## Persistence and targets

Rampway creates and upgrades `rampway_deployment_runs` and
`rampway_deployment_api_audit_events` through Velocious's database abstraction
on first authenticated run-store access. It serializes setup with an advisory
lock. The selected database account therefore needs the DDL privileges required
to create those tables and apply Rampway's schema upgrades. Do not add duplicate
application migrations or edit the dummy schema snapshot for these
package-owned tables.

Callers can select only an allowlisted project/stage pair, a lowercase full Git
commit SHA reachable from that target's approved release branch, and a bounded
idempotency key. Removing a target can make its historical runs unavailable
through the API, and can prevent a detached worker from reconstructing an
already-admitted run. Change allowlists only after accounting for active and
historical runs.

## Security and rollback

Keep tokens and deployment configuration backend-only. Send tokens only in the
`Authorization: Bearer ...` header, use overlapping tokens during rotation, and
restart every web worker when rotating or revoking them. Do not put credentials
in URLs, idempotency keys, Rampway configuration repositories, or command
arguments.

Unmounting the API stops new HTTP admission but does not delete durable runs or
audits, and an already-admitted detached run continues under Rampway's owner
lease. Preserve the tables during rollback. Remounting the same version at the
same prefix restores the same durable scope; reverting to a different prefix
addresses a different scope and does not expose the previous history.

Rampway's complete endpoint, recovery, redaction, and token-rotation contract is
published with the package in `docs/velocious-deployment-api.md`.
