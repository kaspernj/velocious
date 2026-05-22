Added a mountable read-only HTTP API for a background-jobs dashboard (sidekiq-web style).

- `route.mount(VelociousBackgroundJobsApi, {at: "/velocious/jobs", ...})` mounts a read-only jobs API in the routes file, the way `Sidekiq::Web` is mounted in Rails
- exposes `GET /api/stats`, `/api/jobs` (filter by `status`/`jobName`, paginated, sortable), `/api/jobs/:id`, `/api/schedule` and `/api/health`
- access is gated by a bearer token (`accessTokens`) and/or an `authorize({request, ability, token})` callback, falling back to loopback-only when neither is configured
- adds a generic `route.mount(mountable, {at})` helper to the routes DSL backed by route-resolver hooks
- the dashboard UI ships separately as its own Expo app/package; management actions (retry/delete/kill/enqueue) are planned (see docs/background-jobs-dashboard.md)
