# Terminal resource reporting

The shared `@velocious/testing` runner owns the structural `terminalResource: {scope: "run", name: string}` error contract, traversal and cleanup. Velocious supplies framework attempts and translates the runner's events/results. No database quarantine marker or error-message matching is used for resource failures.

When the original error or one of its causes/aggregate members carries the contract, the originating attempt is reported once with `willRetry: false`. Subsequent selected cases receive `testNotRun` and a reason referencing the origin. They do not receive ordinary test-failure events and do not increment passed/failed counts. The CLI shows the not-run count and returns nonzero using overall run status, including terminal `beforeAll` failures. Declared skips remain distinct.

All entered suite cleanup remains owned by the shared runner's idempotent cleanup promise. Artifact/cleanup errors remain secondary members and retain their stacks/causes. Ordinary console reporting prints causal stacks; structured errors retain the same attribution. Declaration discovery excludes the actual resolved shared-package directory, including same-home development links, so output identifies the originating consumer spec.

Selection failure remains separate from terminal setup failure. `testRunner.hasNoMatches()` reflects the shared runner's selection result, even though an empty selection also makes the run unsuccessful. Unmatched filters print `No tests matched the provided filters` and finalize the profile with status `no-tests`. Selected cases blocked by terminal setup retain status `failed`, zero executed/ordinary failed cases, and their separate not-run count; they are never described as unmatched filters.

This adapter requires the shared runner's terminal-resource extension. Install the reviewed shared-runner release before adopting the matching Velocious release; context-schema compatibility alone does not imply this lifecycle support. No package-specific recovery or browser replacement is performed. Full original CI-shard validation belongs to CI; focused lifecycle regressions and CLI fixtures cover local semantics.
