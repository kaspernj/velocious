Add a documented background-jobs adapter lifecycle and a platform-neutral,
non-durable `backgroundJobs.mode: "inline"`, while preserving the existing Node
SQL/TCP/pooled defaults and durable queue behavior. Node producers retain lazy
configuration discovery and main-process wake-ups; non-Node bundles use the
explicit platform job entry, and adapter readiness/close is generation-safe.
