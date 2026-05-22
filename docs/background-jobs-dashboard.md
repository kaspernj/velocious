# Background jobs dashboard

A dashboard for inspecting Velocious [background jobs](../README.md#background-jobs) —
what's queued, running, completed, failed, orphaned and scheduled — similar in
spirit to `sidekiq-web`.

The feature is split in two:

| Piece | Where it lives | What it is |
| --- | --- | --- |
| **Jobs API** | `velocious` core (this repo) | A mountable read-only REST/JSON API you add to your routes file the way `Sidekiq::Web` is mounted in Rails. |
| **Dashboard UI** | Its own repo + npm package (`velocious-jobs`, an Expo app) | A multi-connection UI for iOS / Android / web. Talks only to the Jobs API, so it can point at any backend that has mounted it. |

This document covers the **Jobs API** that ships in core, plus the overall
design so the UI app can be built against a stable contract.

## Mounting the API

Mount it in your routes file, like Sidekiq::Web:

```js
import Routes from "velocious/build/src/routes/index.js"
import VelociousBackgroundJobsApi from "velocious/build/src/background-jobs/web/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.mount(VelociousBackgroundJobsApi, {
    at: "/velocious/jobs",
    authorize: async ({request, ability}) => {
      // Reuse your app's session/ability for the embedded/same-origin dashboard.
      return Boolean(ability?.can("manage", "BackgroundJobs"))
    },
    accessTokens: [process.env.VELOCIOUS_JOBS_TOKEN], // for the standalone app (cross-origin/native)
    allowedOrigins: ["https://jobs.example.com"],     // CORS allow-list for the browser UI
    redactArgs: false                                 // omit job args from responses when true
  })
})

export default {routes}
```

`route.mount(mountable, {at, ...})` records the mount; the configuration applies
it when the routes are set, registering a route-resolver hook so the controller
can ship inside the `velocious` package (the same mechanism the `sql.js` asset
route uses).

## Endpoints

All paths are relative to the mount prefix (`at`). Responses are JSON.

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Connection check. Returns `{ok: true}`. The UI uses this to validate a connection. |
| `GET /api/stats` | Counts per status (`queued`, `handed_off`, `completed`, `failed`, `orphaned`) and `total`. |
| `GET /api/jobs` | Paginated job list. Query: `status`, `jobName`, `page`, `perPage` (max 100), `sort`. |
| `GET /api/jobs/:id` | A single job with args, error, attempts and timestamps. `404` when missing. |
| `GET /api/schedule` | The configured recurring/`scheduledBackgroundJobs` entries. |

`sort` accepts a sortable key, optionally prefixed with `-` for descending:
`createdAtMs` (default, descending), `scheduledAtMs`, `completedAtMs`,
`failedAtMs`, `handedOffAtMs`, `attempts`. Unknown keys fall back to
`createdAtMs`.

Example list response:

```json
{
  "jobs": [
    {
      "id": "…",
      "jobName": "FailingJob",
      "status": "failed",
      "attempts": 1,
      "maxRetries": 0,
      "forked": false,
      "args": ["b"],
      "argsRedacted": false,
      "workerId": "worker-1",
      "lastError": "Error: boom\n  at …",
      "scheduledAtMs": 1700000000000,
      "createdAtMs": 1700000000000,
      "handedOffAtMs": null,
      "completedAtMs": null,
      "failedAtMs": 1700000000123,
      "orphanedAtMs": null
    }
  ],
  "pagination": {"page": 1, "perPage": 25, "total": 1, "totalPages": 1}
}
```

Velocious jobs don't have Sidekiq-style named queues; they have a `job_name`
(the job class) and a `status`. The dashboard groups and filters by those.

## Authorization

Every request is authorized before any job data is read, in this order:

1. **Bearer token** — if `accessTokens` is set and the request carries a matching
   `Authorization: Bearer <token>` (constant-time compared), it's allowed. Use
   this for the standalone app, which connects cross-origin/native and can't rely
   on cookie sessions.
2. **`authorize` callback** — called with `{request, ability, token, configuration}`.
   Return `true` to allow. Use this for the embedded/same-origin dashboard to
   reuse your app's session and ability.
3. **Loopback fallback** — if neither `accessTokens` nor `authorize` is configured,
   access is allowed only from loopback addresses (`127.0.0.1`, `::1`). This keeps
   a freshly mounted dashboard reachable on the same host during development
   without silently exposing jobs to the network. **Configure auth before
   exposing the API.**

### CORS

When `allowedOrigins` is set and the request `Origin` matches (or the list
contains `"*"`), the API adds `Access-Control-Allow-Origin`/`-Headers`/`-Methods`
to responses so a browser dashboard can read it cross-origin. Cross-origin
browser requests that carry an `Authorization` header trigger a preflight
`OPTIONS`; that is handled by Velocious's standard `cors` configuration, so
configure `cors` on the host app for cross-origin browser access. Native apps
and same-origin/embedded use don't need this.

## The UI app (separate repo)

The dashboard UI is a separate Expo app + npm package + GitHub repo
(`velocious-jobs`), modeled on the existing Velocious-backed Expo apps. It:

- runs on iOS, Android and web from one codebase;
- lets you register multiple "connections" (name + base URL + token) and switch
  between backends — the multi-app overview;
- can also be served by a host backend through the mount (`serveUi`, planned) so
  the same UI works embedded (single same-origin app) or standalone;
- talks only to the Jobs API above, polling `GET /api/stats` and the active list
  on an interval.

## Roadmap

This is delivered in phases against the stable API contract above.

- **Phase 1 (done):** mountable read-only API — `health`, `stats`, `jobs`,
  `jobs/:id`, `schedule`; authorize-hook + token auth; CORS headers.
- **Phase 2:** management actions — `retry` (re-queue failed/orphaned), `delete`,
  `kill` (stop a handed-off job) and manual enqueue, routed through the
  background-jobs main process to avoid racing the dispatcher.
- **Phase 3+:** the standalone Expo UI app (connections, overview, list, detail),
  serving the prebuilt web bundle via the mount, and EAS native builds.
