# Command-line interface

## Process exit behavior

A Velocious CLI invocation exits with status `0` after its commands complete successfully.

When command execution rejects, the Node CLI sets a nonzero process exit status and still runs the entrypoint's configuration database cleanup step. If cleanup succeeds, the same command error is rethrown with its original identity and stack. If cleanup also rejects, Velocious throws an `AggregateError` whose errors contain the command failure first and cleanup failure second, with the command failure as `cause`. A cleanup-only rejection is propagated and also sets a nonzero exit status.

This ordering provides a failure-status backstop for applications that install an `uncaughtException` listener to report and consume top-level errors: deployment scripts and other callers still observe a failed CLI process. Application handlers should not reset `process.exitCode`.
