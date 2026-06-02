## Fixed

- The test runner now applies the per-test timeout (`defaultTimeoutSeconds`, default 60) to the entire test lifecycle — dummy/server startup, database connection acquisition, `beforeEach`/`afterEach` hooks and the test body — instead of only the test body. A hang in any non-body phase (for example a connection checkout that never resolves, or a `beforeEach` waiting on a lock) previously stalled the whole run indefinitely until CI killed the build, rather than failing the single offending test and moving on.
