Added first-class scheduled background job support to Velocious.

- `background-jobs-main` can now enqueue recurring jobs from configuration via `scheduledBackgroundJobs`
- supports Sidekiq Scheduler-style `every: ["1m", {first_in: "5s"}]` syntax
- scheduled jobs run through the normal Velocious background jobs queue instead of ad hoc app-server timers
