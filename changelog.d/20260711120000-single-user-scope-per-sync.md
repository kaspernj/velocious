Resolve the user scope once per sync. `subscribeUserScope()` now declares **one** scope — empty conditions and a **null `resourceType`**, the all-types scope — instead of one scope per pullable resource type. A sync is therefore a single `/changes` request and a single `velocious-sync` channel subscription however many resource types the server serves it.

This removes an authorization amplification: the server re-runs the app's `authorizeChanges` (and `scopeChangesQuery`) on every changes request and every subscribe, so with a scope per type, each user-scope resource type an app added multiplied that work on every sign-in. For an app resolving membership against an external database, that scaled per-sign-in load with the number of synced types and could exhaust its connection pool under concurrent sign-ins.

`SerializedSyncScope.resourceType` and the changes-request `scope.resourceType` are now `string | null`; `null` means "every type this resource authorizes for the caller", and apps identify the user scope by it. A blank resource type still fails loudly. Scope rows persist the all-types scope with an empty `resource_type` (the column is non-null) and normalize it back to `null` on read. The client applies each pulled row by the resource type on its own envelope, so one scope serves them all.

Also covered by spec: a background pull (the catch-up pull a realtime resume schedules and nobody awaits) reports a transient server failure through the sync client's error reporter rather than escaping as an unhandled rejection.

See `docs/sync-client.md`.
