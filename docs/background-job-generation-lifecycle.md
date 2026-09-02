# Background-job generation lifecycle

A candidate generation starts fenced from dispatch. Activation establishes scheduler/dispatch ownership, marks the generation active, credits ready workers, and acknowledges immediately. Queue draining/dispatch continues asynchronously; activation must never wait for the queue to become empty.

Retirement synchronously fences new dispatch, then lets workers finish in-flight work. Deployments never kill active jobs merely to complete rollout.

Explicit main shutdown supersedes retirement cleanup. Once shutdown begins, an in-progress retirement must not reacquire generation-recovery timers or overwrite the stopped lifecycle state.

Lifecycle control emits structured start/completion/failure stages. Request bounds must accommodate startup reconciliation, but larger timeouts are not a substitute for non-blocking activation semantics.

Git consumers are supported through checked-in generated runtime artifacts. Immutable Git SHA/content digest proves code identity; package version remains compatibility metadata.
