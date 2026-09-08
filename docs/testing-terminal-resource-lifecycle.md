# Testing terminal resource lifecycle

`@velocious/testing` `0.0.12` supports the `terminalResource` error contract for a
shared resource that makes the rest of a test run unsafe to continue. Use it with the
matching Velocious release so the package runner and the Velocious reporter agree on
the lifecycle.

When a shared resource owner throws an error carrying
`terminalResource: {scope: "run", name: "shared-resource"}`, Velocious reports the
originating failure without retrying it. Later selected tests are reported as
`testNotRun` rather than executing their callbacks. Entered suites still clean up once,
and the run exits unsuccessfully even when no ordinary test cases were executed.

For CLI output, result accounting, and reporter behavior, see
[Terminal resource reporting](terminal-resource-reporting.md).
