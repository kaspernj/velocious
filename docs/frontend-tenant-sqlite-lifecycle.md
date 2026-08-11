# Frontend tenant SQLite lifecycle

Frontend applications may keep a catalog database plus many physical per-user or per-project SQLite replicas without owning Velocious pool internals. Configure a finite resident limit (the default is 10):

```js
new Configuration({
  frontendTenantSqlite: {maxOpenHandles: 4},
  // ...
})
```

Capture identity once, then use the handle lifecycle:

```js
const project = Tenant.handle({slug: projectSlug})

await project.open({databaseIdentifier: "projectTenant"})
await project.flush({databaseIdentifier: "projectTenant"})
await project.close({databaseIdentifier: "projectTenant", flush: true})
await project.delete({databaseIdentifier: "projectTenant"})
```

`open` returns a frozen diagnostic snapshot, never a connection. `inspect` returns one handle snapshot and `configuration.inspectFrontendTenantSqliteHandles()` returns bounded aggregate diagnostics. All methods use the immutable physical configuration captured by `Tenant.handle`; unresolved or inactive identities fail before storage changes.

When the limit is reached, Velocious closes the least-recently-used handle that is clean, idle, and unpinned. Dirty, pinned, and active-operation handles are never victims. If every candidate is protected, opening another handle rejects deterministically. SQL.js mutations remain dirty until `flush` completes; `close` therefore requires `{flush: true}` for a dirty handle. Node and Expo writes are already durable at the driver boundary.

Use `withPin` for a Ticket-App-style project-scoped `SyncClient` or other owner that must not be displaced while it has pending domain work:

```js
await project.withPin({databaseIdentifier: "projectTenant"}, async () => {
  await projectSyncClient.sync()
  await project.flush({databaseIdentifier: "projectTenant"})
})
```

Pins nest and always unwind when the callback throws. Handle database operations participate in pin ownership once the resident lifecycle is open. Lifecycle calls for one configuration are deterministic, and duplicate opens share the existing resident database.

Closing preserves storage. Deleting first closes the live connection and then clears the physical backend: every SQL.js persistence location (OPFS, IndexedDB, and legacy localStorage), the Expo database, or the Node SQLite file and its WAL/SHM/journal sidecars. Deletion is idempotent. Configuration shutdown closes pool connections and clears lifecycle metadata.

This API does not create migrations, construct tenant-specific sync clients, detect application-level unsynced state, coordinate LRU state between processes, or expose raw pools/drivers. Applications remain responsible for placing a scoped pin around unsynced work.
