# Application process lifecycle

Velocious initializers can own resources for the lifetime of one application
process. `run()` starts the resource and the optional `teardown()` hook releases
it:

```js
import Initializer from "velocious/build/src/initializer.js"

export default class ApplicationResourceInitializer extends Initializer {
  async run() {
    const {instanceId, type} = this.getProcessContext()

    this.resource = await openApplicationResource({owner: `${type}:${instanceId}`})
  }

  async teardown() {
    await this.resource.close()
  }
}
```

Existing initializers only need `run()`: the base `teardown()` implementation is
a no-op, and `getType()` remains available. `getProcessContext()` returns a
frozen `{type, instanceId}` object. `type` is the generic process role;
`instanceId` is an opaque string that may be compared for equality but must not
be parsed. Every initializer in one lifecycle receives the same object.

## Configuration contract

`configuration.initialize({type})` starts a lifecycle once. Concurrent callers
receive the exact same promise object. Initializers run in discovery order and
an instance is retained only after its `run()` resolves.

`configuration.shutdown()` waits for an active startup, then invokes retained
initializers once in reverse order. Concurrent and repeated shutdown callers
receive the exact same promise. An `initialize()` call made during shutdown is
queued behind it; concurrent queued callers share one replacement startup. The
replacement receives a new `instanceId`.

If startup fails, the initializer that rejected is excluded and the successful
prefix is unwound in reverse order. Cleanup continues after failures. One
failure is rethrown unchanged. Multiple failures reject with an
`AggregateError` whose `errors` follow causal execution order and whose `cause`
is the first error. This ordering also applies when application teardown and
framework cleanup both fail.

The documented built-in process types are:

- `server`
- `worker-handler`
- `background-jobs-main`
- `background-jobs-worker`
- `background-jobs-pooled-runner`
- `background-jobs-forked-runner`
- `background-jobs-runner` for compatible direct one-shot execution

Applications may pass their own type strings when they call `initialize()`.

## Ownership and framework cleanup

Application lifecycle and framework connections are separate:

```js
await configuration.shutdown()
await configuration.disconnectBeacon()
await configuration.closeDatabaseConnections()
```

`closeDatabaseConnections()` remains framework-only. It invalidates and closes
framework database/background-job resources so they can be initialized again,
but it neither invokes initializer teardown nor begins a replacement application
lifecycle. A process that owns the full configuration lifetime calls
`shutdown()` before Beacon/database cleanup and attempts every close even when an
earlier one fails.

The standard HTTP server, HTTP worker handlers, background-jobs main and worker,
and owned runner shutdown paths perform that composition. Passing
`closeDatabaseConnectionsOnStop: false` to an embedded jobs main or worker keeps
application lifecycle and database ownership with the caller. The caller must
eventually invoke `configuration.shutdown()` and its chosen framework cleanup;
service stop does not unexpectedly tear down a shared configuration.

## Runner and release boundaries

A pooled runner owns one lifecycle across all jobs admitted to that child. It
does not tear initializers down between jobs or when framework connections rotate;
signal/disconnect/final child exit performs teardown once. A replacement pooled
child starts a new lifecycle and receives a new `instanceId`.

A forked runner performs lifecycle teardown after its durable terminal report is
acknowledged and before normal exit. SIGTERM, SIGINT, and parent disconnect share
the same bounded cleanup path. Cleanup failure remains visible without changing
the already acknowledged durable job outcome. Compatible direct one-shot runner
behavior keeps the `background-jobs-runner` type.

For release-scoped background-job generations, lifecycle teardown happens only
when that exact main or worker process finally exits after all accepted handoffs,
reports, acknowledgements, timeouts, and child runners settle. Activation and
retirement do not transfer initializers to another generation and do not run
teardown early. Deploy success and lock release remain independent of retired
generation drain completion.
