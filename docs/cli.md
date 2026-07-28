# Command-line interface

## Process exit behavior

A Velocious CLI invocation exits with status `0` after its commands complete successfully.

When command execution rejects, the Node CLI sets a nonzero process exit status before rethrowing the original error. Configuration database cleanup still runs in the entrypoint's `finally` block, and the rethrown value retains its original error identity and stack.

This ordering provides a failure-status backstop for applications that install an `uncaughtException` listener to report and consume top-level errors: deployment scripts and other callers still observe a failed CLI process. Application handlers should not reset `process.exitCode`.
