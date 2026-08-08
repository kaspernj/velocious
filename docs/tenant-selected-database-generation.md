# Tenant-selected database generation

Schema-dependent commands can select one tenant-only logical database explicitly. The selector is the configured database identifier. Define `tenantDatabaseProviders[identifier].resolveGenerationTenant` to resolve its one descriptor without enumerating lifecycle tenants:

```js
tenantDatabaseProviders: {
  projectTenant: {
    listTenants: async () => await allLifecycleTenants(),
    resolveGenerationTenant: async () => await selectedBuildTenant()
  }
}
```

The command forms are:

```sh
npx velocious generate:base-models --tenant projectTenant
npx velocious g:base-models --tenant projectTenant
npx velocious db:schema:dump --tenant projectTenant
npx velocious db:schema:load --tenant projectTenant
```

Selection is fail-closed. The identifier must exist, be enabled, have `tenantOnly: true`, and resolve one valid descriptor. Missing, inactive/stale, and empty resolutions fail before the selected physical schema is read or written. Commands never choose the configured template/default database as a fallback and never iterate through tenant databases. For compatibility, a provider without `resolveGenerationTenant` falls back to `listTenants` only when it returns exactly one descriptor; multiple results fail as ambiguous instead of scanning their schemas. Providers with more than one lifecycle tenant should define the targeted hook.

The resolved descriptor is copied and frozen by `TenantHandle`, and the logical identifier plus resolved physical database configuration remain pinned for the entire command. Base-model generation includes only models whose configured or `switchesTenantDatabase(...)` identifier resolves to the selection. Tenant-only models are therefore generated, and tenant-switched models are introspected from the tenant schema rather than their ordinary control-schema fallback. No-selector generation retains its existing behavior and ignores inactive tenant-only identifiers.

The default require-context initializer registers inactive tenant-only models without eagerly loading their table metadata. Selected base-model generation then initializes those models inside the resolved tenant scope with the captured tenant connection, so startup never tries to read tenant-only metadata through an ordinary/default connection.

Selected structure commands use the logical name `db/structure-<identifier>.sql`; for example, `projectTenant` reads or writes `db/structure-projectTenant.sql`. Dump and load touch only the captured selected connection. Loading executes the structure file as-is through `StructureSqlLoader`; it does not scan, drop, reset, or provision other tenant databases.

Unknown flags and positionals are rejected for all three commands instead of being ignored. `generate:base-models` additionally accepts the existing `--allow-missing-tables` flag.

## Reusable API

The CLI behavior is backed by the public `DatabaseGenerationContext` contract:

```js
import DatabaseGenerationContext from "velocious/build/src/database/generation-context.js"

const context = await DatabaseGenerationContext.resolve({
  configuration,
  databaseIdentifier: "projectTenant"
})

await context.run({name: "Inspect selected schema", callback: async (db) => {
  const table = await db.getTableByNameOrFail("project_headers")
  // Read or write only through this pinned selected connection.
}})
```

`databaseIdentifier()`, `tenant()`, and `databaseConfiguration()` expose the captured logical identity, immutable descriptor, and captured physical configuration. `run(...)` combines the captured tenant scope with a pool-owned captured-operation checkout; it does not install global selection state.
