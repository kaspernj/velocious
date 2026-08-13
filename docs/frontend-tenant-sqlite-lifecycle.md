# Frontend tenant SQLite lifecycle

Frontend applications may keep a catalog database plus many physical per-user or per-project SQLite replicas without owning Velocious pool internals. Configure a finite resident limit (the default is 10):

```js
new Configuration({
  frontendTenantSqlite: {maxOpenHandles: 4},
  // ...
})
```

Capture identity once, then initialize each physical tenant database with the
frontend migration context and a stable application schema generation:

```js
const project = Tenant.handle({slug: projectSlug})

await project.initialize({
  databaseIdentifier: "projectTenant",
  migrations: await loadFrontendMigrations(),
  schemaGeneration: appSchemaGeneration
})
await project.flush({databaseIdentifier: "projectTenant"})
await project.close({databaseIdentifier: "projectTenant", flush: true})
await project.delete({databaseIdentifier: "projectTenant"})
```

`initialize` opens the captured database, applies that physical database's
`schema_migrations` ledger, and initializes its model metadata before returning
a ready snapshot. Use a generation such as an application build/schema manifest
identifier, and change it whenever the migration set or expected model schema
changes. Concurrent initialization for the same physical identity and generation
shares one promise and one ledger pass. Different physical tenants can migrate
concurrently. Their readiness, failures, retries, and metadata are independent.

React applications can bind this work to the selected handle's render lifecycle:

```js
const {error, loaded} = useDatabase({
  databaseIdentifier: "projectTenant",
  migrationsRequireContextCallback: loadFrontendMigrations,
  schemaGeneration: appSchemaGeneration,
  tenantHandle: project
})
```

Changing the handle, database identifier, migration loader, or generation makes
that render synchronously return `{error: null, loaded: false}`; it never exposes
the prior selection's readiness or error while waiting for the passive effect.
Completion from a stale effect cannot mark the newly selected database ready.
Surface `error` to the UI or an error boundary. The initialization itself remains
shared when another mounted caller still needs the same physical generation.
`loaded: true` means both the tenant database migrations/model metadata and the
normal configuration bootstrap (resource discovery, relationship validation,
and application initializers) have completed.

`open` remains available when only residency is needed and returns a frozen
diagnostic snapshot, never a connection. `inspect` returns one handle snapshot
including `ready` and `schemaGeneration`, and
`configuration.inspectFrontendTenantSqliteHandles()` returns bounded aggregate
diagnostics. All methods use the immutable physical configuration captured by
`Tenant.handle`; unresolved or inactive identities fail before storage changes.
The React helper also rejects a handle created by another `Configuration`.

When the limit is reached, Velocious closes the least-recently-used handle that is clean, idle, and unpinned. Dirty, pinned, and active-operation handles are never victims. If every candidate is protected, opening another handle rejects deterministically. SQL.js mutations remain dirty until `flush` completes; `close` therefore requires `{flush: true}` for a dirty handle. Node and Expo writes are already durable at the driver boundary.

Use `withPin` for a Ticket-App-style project-scoped `SyncClient` or other owner that must not be displaced while it has pending domain work:

```js
await project.withPin({databaseIdentifier: "projectTenant"}, async () => {
  await projectSyncClient.sync()
  await project.flush({databaseIdentifier: "projectTenant"})
})
```

Pins nest and always unwind when the callback throws. Handle database operations atomically validate readiness, capture the schema generation, and acquire their pin before leaving lifecycle serialization, so a generation replacement cannot overtake an admitted operation or admit stale work. Lifecycle calls for one configuration are deterministic, and duplicate opens share the existing resident database. A different schema generation is rejected while initialization is in flight; after it settles, initializing the new generation reruns readiness against the same physical ledger and rebuilds metadata for that generation.

Closing preserves storage but clears that resident identity's readiness and model-metadata snapshots. Reopening and initializing the same generation checks the durable ledger again without replaying applied migrations. Deleting first closes the live connection and then clears the physical backend: every SQL.js persistence location (OPFS, IndexedDB, and legacy localStorage), the Expo database, or the Node SQLite file and its WAL/SHM/journal sidecars. Deletion is idempotent. Configuration shutdown closes pool connections and clears lifecycle metadata.

Missing tenant identity, an inactive identifier, a non-tenant database, an empty
generation, or a mismatched configuration fails closed. There is no fallback to
the default/template database. A migration or eager model-metadata failure leaves
only that physical tenant unready and clears its in-flight promise so a later
call can retry. Mark optional models with
`Model.setEagerLoadRecordMetadata(false)`; absent eager tables are readiness
errors.

This API does not create migrations, construct tenant-specific sync clients,
detect application-level unsynced state, coordinate LRU state between processes,
or expose raw pools/drivers. Applications remain responsible for placing a
scoped pin around unsynced work.
