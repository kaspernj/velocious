# Background-job generation lifecycle

A candidate generation starts fenced from dispatch. Activation establishes scheduler/dispatch ownership, marks the generation active, credits ready workers, and acknowledges immediately. Queue draining/dispatch continues asynchronously; activation must never wait for the queue to become empty. If recovery retires a candidate while activation is still reconciling durable queue state, the retirement fence wins: activation cannot publish ownership or return the generation to `active` afterward, and the activation request rejects instead of acknowledging a retiring or retired state.

Retirement synchronously fences new dispatch, then lets workers finish in-flight work. Deployments never kill active jobs merely to complete rollout.

Explicit main shutdown supersedes retirement cleanup. Once shutdown begins, an in-progress retirement must not reacquire generation-recovery timers or overwrite the stopped lifecycle state.

Lifecycle control emits structured start/completion/failure stages. Startup reconciliation reads only queue-derived keys and rebuilds only active or stale concurrency counters, avoiding a job-table count query for every historical key. The built-in SQL store also repairs the secondary indexes missed by older add-column upgrades once through its internal migration ledger; SQLite repair DDL remains idempotent when separate generation processes race on a stale schema snapshot. Request bounds must still accommodate real startup work, but larger timeouts are not a substitute for bounded reconciliation or non-blocking activation semantics.

Git consumers are supported through checked-in generated runtime artifacts. Immutable Git SHA/content digest proves code identity; package version remains compatibility metadata.
