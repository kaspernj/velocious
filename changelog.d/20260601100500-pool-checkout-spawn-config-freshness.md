## Fixed

- `AsyncTrackedMultiConnection.checkout()` now resolves the tenant-aware database configuration fresh at spawn time for the immediate (non-queued) spawn path, instead of reusing a configuration captured before `reapIdleConnections()` was awaited. The stale capture could bind a freshly spawned connection to the wrong database/tenant, breaking per-request isolation (observed as test-suite table truncation appearing not to take effect against multi-database backends). The queued-checkout path still binds to the waiting caller's captured configuration.
