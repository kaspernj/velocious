# Callable deployment API

An authenticated, bounded deployment API that a narrowly configured consumer
can mount without putting deployment controllers in its own repository. The
framework owns authentication, validation, idempotency, persistence, and
readback; the configured **deployment integration** (e.g.
[Rampway](https://github.com/kaspernj/rampway)) owns execution through an
explicit adapter, so its normal lock, build/migration, release/current-link,
health, rollback, and cleanup semantics are reused rather than duplicated in
Velocious.

The API deliberately does **not** expose arbitrary commands, paths,
repositories, refs, environment variables, raw logs, Docker, host access, or a
generic shell. A request can only name an allowlisted project/stage pair, a
full immutable Git revision reachable from the configured approved release
branch, and an idempotency key.

## Mounting the API

Mount it in your routes file, the way the
[background-jobs dashboard API](background-jobs-dashboard.md) is mounted:

```js
import Routes from "velocious/build/src/routes/index.js"
import VelociousDeploymentApi from "velocious/build/src/deployment-api/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.mount(VelociousDeploymentApi, {
    at: "/velocious/deployments",
    accessTokens: [secrets.deploymentApiToken],
    adapter: rampwayDeploymentAdapter,
    projects: {
      "my-app": {
        stages: {
          production: {releaseBranch: "master"}
        }
      }
    }
  })
})
```

Mount options:

| Option | Required | Meaning |
| --- | --- | --- |
| `at` | yes | Mount path prefix. |
| `accessTokens` | yes | Accepted bearer tokens. At least one non-empty token is required — the API fails closed and mounting without one is a configuration error. |
| `adapter` | yes | The deployment integration adapter (see below). |
| `projects` | yes | Allowlist of projects and stages with their approved release branch. Identifiers must match `^[a-z0-9][a-z0-9_-]*$` and be at most 64 characters. |
| `databaseIdentifier` | no | Database the run store uses; defaults to `default`. |
| `staleRunTimeoutMs` | no | Ownership lease timeout in milliseconds; defaults to `60000`. An active run whose lease (heartbeat, or request time when it never started) is older than this counts as interrupted. |

Keep tokens in your application's configuration/secrets files. They are
compared in constant time, are only accepted through the
`Authorization: Bearer <token>` header — never through URLs — and are never
rendered in responses, logs, audit payloads, or persisted run state. Anything
the adapter reports back is recursively redacted against the configured tokens
before it is stored, including object keys. If redaction makes two keys equal,
the later keys receive deterministic `#2`, `#3`, … suffixes so no values are
lost.

## Adapter contract

The integration supplies one object:

```js
const rampwayDeploymentAdapter = {
  // Must verify that `revision` (a full 40-char SHA) is reachable from the
  // approved `releaseBranch`. Return false to reject the request.
  async validateRevision({configuration, project, releaseBranch, revision, stage}) { ... },

  // Runs the integration's normal deploy: lock, build/migrations, release,
  // current-link, health checks, rollback on failure, cleanup. The returned
  // report is JSON-sanitized and redacted before persistence. Throw to fail
  // the run; attach a plain-object `error.recovery` (e.g. `{restored: true,
  // activeRevision}`) to report restoration of the previous release.
  async deploy({configuration, project, releaseBranch, revision, runId, stage}) { ... },

  // Optional bounded live readback (active revision, current/previous
  // release) merged into run readback as `current`. It is awaited inline on
  // the read path, so it must return promptly.
  async readStatus({configuration, project, stage}) { ... }
}
```

The contract is validated at mount time, so a misconfigured integration fails
at boot rather than on the first request.

## Endpoints

All endpoints live under the mount prefix and require a valid bearer token
(`401 {"error": "unauthorized"}` otherwise).

### `POST {prefix}/runs`

```json
{"project": "my-app", "stage": "production", "revision": "<40-char-sha>", "idempotencyKey": "deploy-2026-08-03-1"}
```

- `202 {"run": {...}}` — run created; execution starts asynchronously.
- `200 {"replayed": true, "run": {...}}` — same idempotency key and payload: the original run is read back, never deployed twice.
- `404 {"error": "not_found"}` — project/stage is not allowlisted.
- `409 {"error": "idempotency_conflict", "runId"}` — idempotency key reused with a different payload.
- `409 {"error": "deployment_in_progress", "runId"}` — another run is active for this project/stage. Creation is fenced by an advisory lock per project/stage, so concurrent requests deterministically produce exactly one run. `runId` is omitted only when the conflict was detected while the other request was still creating its run; a same-key retry then replays the original run once it exists.
- `409 {"error": "deployment_reconciliation_required", "runId"}` — a previous running deployment lost its ownership lease, or its externally successful result could not be durably recorded. The project/stage stays blocked so a retry cannot launch a duplicate external activation; an operator must reconcile the run and live deployment state.
- `422 {"error": "invalid_params"}` — revision is not a full lowercase 40-hex SHA, or the idempotency key is missing/over-long.
- `422 {"error": "revision_not_reachable"}` — the adapter reports the revision is not reachable from the approved release branch.

### `GET {prefix}/runs/:id`

`200 {"run": {...}, "current": {...}}` — bounded run state: status
(`pending`/`running`/`succeeded`/`failed`/`interrupted`/`reconciliation_required`), requested revision, timestamps
(`requestedAtMs`/`startedAtMs`/`finishedAtMs`), the sanitized adapter `result`
(release id, active revision, previous release, health/public-edge outcomes as
reported by the integration), the sanitized `error` with its `recovery`
information when activation failed, and the adapter's live status as `current`
when the integration provides `readStatus`. Unknown ids return
`404 {"error": "not_found"}`.

## Persistence, audit, and failures

Run state and audit events are stored in the consuming app's database
(`velocious_deployment_runs` and `velocious_deployment_api_audit_events`,
created lazily by the framework store — no app-side migration needed). Every
row, lookup, reconciliation, and advisory lock is scoped by a stable hash of
the authenticated mount prefix. Mounts may therefore share one database
without reading or blocking one another, and the same idempotency key may be
used independently under each mount. Within a mount, the idempotency key has a
composite unique index and creation is serialized by two advisory locks taken
in a consistent order (first the project/stage deployment lock, then the
idempotency-key lock), so a retry after a crash reads the original run instead
of launching a duplicate and a key racing across different project/stage pairs
gets a deterministic `idempotency_conflict`. A lazy upgrade quarantines rows
created before mount ownership was persisted because they cannot be safely
attributed to any authenticated mount.

### Interruption recovery

Each run carries an ownership token and a heartbeat lease renewed while the
adapter deploys. If the process exits, the lease stops renewing. Once it is
older than `staleRunTimeoutMs` (and the run is not executing in the
reconciling process), the next request reconciles the orphan according to its
durable execution state:

- A stale `pending` run never began external activation. It becomes
  `interrupted`, records `run_interrupted`, and lets a new deployment proceed.
- A stale `running` run may already have changed the external deployment. It
  becomes `reconciliation_required`, records `run_reconciliation_required`,
  and continues blocking that project/stage so a new request cannot duplicate
  an activation whose outcome is unknown.

A run with a fresh lease owned by another worker is genuinely active and is
never reclaimed; it returns `deployment_in_progress` as usual. Terminal
success/failure writes are fenced by both the expected owner token and
`running` status, so a stale worker cannot overwrite either reconciled state.
The `pending` to `running` transition is likewise fenced by mount, id, this
process's owner token, and `pending` status; losing ownership stops execution
before the adapter is invoked.

### Audit and failure reporting

Every run records sanitized `run_requested`, `run_started`, and
`run_succeeded`/`run_failed` audit events, plus
`run_reconciliation_required` when manual reconciliation becomes necessary.
Audit persistence is deliberately not on the deployment's critical path: if
it fails, the failure is emitted on both `framework-error` and unified
`all-error` (`errorType: "framework-error"`, context
`deployment-api-audit`) and the deployment still executes — an audit outage
never strands a pending run. When
activation fails, the run is marked `failed` with a redacted error message
and the integration-reported `recovery` payload, so restoration of the
previous release is visible through readback. A failed deployment is an
expected operational outcome and is reported through run state; only
unexpected store/framework bugs are emitted on both framework failure
channels with the same payload.
If `adapter.deploy()` returns success but persisting `succeeded` throws, the
recording error is emitted with context `deployment-api-record-success`; the
controller never relabels that known external success as `failed`. It instead
fences the run as `reconciliation_required`. If that safety write also fails,
the still-`running` lease is reconciled to the same duplicate-blocking state
after expiry, and the safety-write error is emitted with context
`deployment-api-record-reconciliation-required`.
