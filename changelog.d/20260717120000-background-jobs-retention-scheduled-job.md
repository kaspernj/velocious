# Changelog

- Run background-job retention pruning as an ordinary scheduled job (`PruneTerminalBackgroundJobsJob`) registered on the normal background-jobs scheduler when `backgroundJobs.retention` is enabled, instead of a hidden `setInterval` in the main process. The prune now runs as a real queued job — visible in the job tables, dispatched to a worker, and bounded by a `maxConcurrency: 1` reservation so runs cannot pile up.
