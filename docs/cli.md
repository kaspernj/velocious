# Command-line interface

## Process exit behavior

A Velocious CLI invocation exits with status `0` after its commands complete successfully.

When command execution rejects, the Node CLI sets a nonzero process exit status and still runs the entrypoint's configuration database cleanup step. If cleanup succeeds, the same command error is rethrown with its original identity and stack. If cleanup also rejects, Velocious throws an `AggregateError` whose errors contain the command failure first and cleanup failure second, with the command failure as `cause`. A cleanup-only rejection is propagated and also sets a nonzero exit status.

This ordering provides a failure-status backstop for applications that install an `uncaughtException` listener to report and consume top-level errors: deployment scripts and other callers still observe a failed CLI process. Application handlers should not reset `process.exitCode`.

## Release-generation background jobs

Release supervisors activate and retire an opt-in background-jobs generation
through its release-local Unix control socket:

```sh
npx velocious background-jobs:activate --generation release-20260828.1 --socket /srv/app/releases/20260828.1/run/background-jobs.sock --timeout-ms 10000
npx velocious background-jobs:retire --generation release-20260828.1 --socket /srv/app/releases/20260828.1/run/background-jobs.sock --timeout-ms 10000
```

Each command opens the socket once, sends one generation-fenced request, waits
for its one acknowledgement, and exits. It performs no polling, retry, PID
lookup, or remote network control. Missing, malformed, conflicting, rejected, or
unacknowledged requests exit nonzero with the original server stack. Repeating
an already completed activation or retirement while that generation socket is
still available is idempotent.

The request deadline defaults to 10000ms. `--timeout-ms` accepts an integer from
1 through 60000 so supervisors can allow a full minute for an acknowledged
activation or retirement while keeping the one-shot request bounded. A timeout
destroys the connection and exits nonzero; it never polls or retries the request.

Start release-local processes with matching identity and endpoint values:

```sh
npx velocious background-jobs-main --generation release-20260828.1 --initial-generation-state candidate --lifecycle-socket /srv/app/releases/20260828.1/run/background-jobs.sock
npx velocious background-jobs-worker --generation release-20260828.1
```

When only the generation id is configured, `candidate` is a derived default and
does not conflict with an explicit `--initial-generation-state active` or
`retired` recovery start. Multiple actual config/environment/CLI values must
still agree.

See [release-generation draining](background-jobs.md#release-generation-draining)
for the state machine, socket security, and supervisor obligations.
