# Tenant Databases

Velocious supports tenant-specific database identifiers for apps that keep global records in one database and project/account records in separate tenant databases.

A tenant database identifier is a logical slot, not one physical database. For example `projectTenant` can represent thousands of project databases. The physical database is resolved from the current tenant object at request/command time, so projects can be added or removed without changing Velocious configuration or redeploying the app.

Configure the tenant database as `tenantOnly: true`. Tenant-only identifiers are skipped by normal connection setup and `db:migrate` until a tenant context activates them through `tenantDatabaseResolver`.

Model classes that call `switchesTenantDatabase(...)` require a tenant database identifier by default. If a model query or write runs without a current tenant, or with a tenant object that does not resolve the model's tenant database, Velocious raises `TenantDatabaseScopeError` instead of falling back to the global database. Legacy apps can temporarily set `enforceTenantDatabaseScopes: false` on the configuration while migrating to explicit tenant scopes.

## Tenant object typing

The tenant is an app-defined value: Velocious stores and restores whatever object you pass and never inspects its fields. The types reflect the split between writing and reading it:

- **Writing** — `Current.setTenant(tenant)`, `Current.withTenant(tenant, callback)`, and `configuration.runWithTenant(tenant, callback)` accept any `object`, so a tenant modeled as an `interface`/class (for example `interface Tenant { slug: string }`) is assignable without a cast.
- **Reading** — `Current.tenant()` returns `Record<string, unknown> | undefined`, so consumers can read and narrow their own fields without casting `unknown`.
- **Resolver callback** — the `switchesTenantDatabase((args) => ...)` callback receives `args.tenant` typed `Record<string, unknown> | null | undefined`. It can be invoked outside a tenant scope (with a nullish tenant) before the fail-closed `TenantDatabaseScopeError` path runs, so resolvers must narrow rather than read a field directly:

```js
ProjectRecord.switchesTenantDatabase(({tenant}) => {
  const databaseIdentifiers = tenant?.databaseIdentifiers

  if (Array.isArray(databaseIdentifiers) && databaseIdentifiers.includes("auditTenant")) {
    return "auditTenant"
  }
})
```

```js
export default new Configuration({
  database: {
    production: {
      default: {
        // global database
      },
      projectTenant: {
        // base tenant connection details
        migrations: true,
        tenantOnly: true
      }
    }
  },
  tenantDatabaseResolver: ({databaseConfiguration, identifier, tenant}) => {
    if (identifier !== "projectTenant" || !tenant?.databaseName) return

    return {
      ...databaseConfiguration,
      database: tenant.databaseName
    }
  },
  tenantDatabaseProviders: {
    projectTenant: {
      listTenants: async ({configuration}) => {
        // Query the current global database state each time the command runs.
        // Adding/removing projects changes the next command run immediately.
        return await Project.all().select(["id", "databaseName"]).toArray()
      },
      listRestrictTenants: async ({configuration}) => {
        // Optional: return only existing/readable tenant databases for
        // cross-tenant dependent: "restrict" checks.
        return await Project.where({tenantState: "migrated"}).select(["id", "databaseName"]).toArray()
      },
      // Optional: override only if you need custom creation (grants, structure
      // loading, …). Omit it and the framework's driver-agnostic default runs
      // (see below), so most apps do not implement createDatabase/dropDatabase.
      createDatabase: async ({databaseConfiguration, tenant}) => {
        // App-specific database creation, grants, and structure loading.
      },
      checkTenant: async ({databaseConfiguration, tenant}) => {
        // Optional preflight checks before generic connection validation.
      },
      afterMigrateTenant: async ({configuration, databaseConfiguration, migrationsApplied, tenant}) => {
        // Optional app-owned schema or data work after generic migrations.
        // `migrationsApplied` is how many migrations actually ran for this tenant
        // (0 when it was already up to date) — skip expensive work on no-op runs.
        if (migrationsApplied === 0) return
      }
    }
  }
})
```

Run tenant lifecycle commands by database identifier:

```sh
npx velocious db:tenants:create projectTenant
npx velocious db:tenants:check projectTenant
npx velocious db:tenants:migrate projectTenant
npx velocious db:tenants:drop projectTenant
```

`db:tenants:drop` drops every listed tenant's database through the provider's `dropDatabase` hook. Like the other lifecycle commands it honors `--parallel`.

`createDatabase`/`dropDatabase` are optional. When a provider omits them, `db:tenants:create`, `db:tenants:drop`, and `Tenant.drop` fall back to the framework default (`src/tenants/default-tenant-database-provisioning.js`): file-backed drivers (sqlite) create by ensuring the tenant connection and treat drop as a no-op, while server drivers (mysql, pgsql, …) connect to the maintenance database (`useDatabase`) and run the driver's own `createDatabaseSql`/`dropDatabaseSql` after validating the tenant database name. Define your own hook only when you need custom provisioning.

Tenant lifecycle commands run one tenant at a time by default. Add `--parallel` to process up to 20 tenants at once, or pass a positive integer to choose a different concurrency:

```sh
npx velocious db:tenants:migrate projectTenant --parallel
npx velocious db:tenants:migrate projectTenant --parallel 20
```

The lifecycle commands print the tenant count and parallelism when they start, report each completed tenant, and finish with a processed count. While work is still running, they also print a heartbeat every 30 seconds with completed and active tenant counts so long deploy steps remain visibly alive.

`afterMigrateTenant` runs inside the tenant command's active connection scope after generic migrations finish for that tenant. Hooks can read `configuration.getCurrentConnections()` or run model/database queries against both the default database and the active tenant database without opening another connection scope.

The hook receives `migrationsApplied`, the number of migrations actually applied to that tenant during this run (0 when the tenant was already up to date, because already-run migrations are skipped). Use it to make the hook proportional to pending work — for example, return early when `migrationsApplied === 0` so a no-op `db:tenants:migrate` (such as one run on every deploy) does not repeat expensive per-tenant schema reconciliation across every tenant.

Tenant migrations should explicitly target the tenant identifier:

```js
class CreateBuilds extends Migration {
  async change() {
    await this.createTable("builds", (table) => {
      table.string("name")
    })
  }
}

CreateBuilds.onDatabases(["projectTenant"])

export default CreateBuilds
```

Normal `db:migrate` continues to migrate non-tenant databases only. Use `db:tenants:migrate <identifier>` when you want to run migrations for every tenant returned by the provider.

## Runtime tenant façade

At runtime, the apartment-style `Tenant` façade is the single entry point for working with tenants. It composes the existing primitives (`Current.withTenant`/`runWithTenant`, the tenant database provider, and the connection pools), so it does not introduce any separate tenant bookkeeping:

```js
import Tenant from "velocious/build/src/tenants/tenant.js"

// Switch into a tenant's context (a "tenant" is whatever descriptor your
// tenantDatabaseResolver understands) and read the current one back.
await Tenant.with({slug: "alpha"}, async () => {
  Tenant.current() // => {slug: "alpha"}
})

// Run a callback within every tenant the provider lists, optionally filtered
// and a few at a time. Returns how many tenants the callback ran for.
await Tenant.each({
  identifier: "projectTenant",
  parallel: 8,
  filter: (tenant) => tenant.migrated,
  callback: async ({tenant}) => { /* runs inside this tenant's context */ }
})

// Drop one tenant's database through the provider's dropDatabase hook.
await Tenant.drop({identifier: "projectTenant", tenant: {slug: "alpha"}})
```

`Tenant.with` switches the async-context tenant (via `Current`) and runs the callback inside `ensureConnections`, so the global database and the tenant's own database both have a checked-out connection for the callback's duration. Before the callback runs, it initializes registered tenant-switched model classes whose base and declared translation tables exist. Concurrent entries share each model's initialization promise, so synchronous query builders cannot observe partially initialized metadata; models for absent optional tables remain deferred. Entering a tenant therefore makes its existing models immediately queryable without the caller establishing connections or calling `ensureInitialized()` (apartment-style "switch" semantics). Already-open connections are reused, so nesting `Tenant.with` does not double-connect. `Tenant.with` is generic over its callback's return type, so a value returned from inside the tenant context is passed straight back to the caller with its type preserved (no cast needed). `Tenant.each` establishes each tenant's connections and model metadata the same way before running the callback. (The `db:tenants:*` CLI commands deliberately do **not** pre-establish the tenant connection per tenant, because `db:tenants:create` must run before the tenant database exists; that lifecycle path manages its own connections.) `Tenant.current` delegates to `Current`; `Tenant.each` is the runtime counterpart of the `db:tenants:*` per-tenant iteration and shares its iteration engine; `Tenant.drop` refuses to run for a tenant that does not resolve to an active tenant database, so an unresolved descriptor can never drop the base/template database. `each` and `drop` default to the current configuration but accept an explicit `configuration` for non-global use. Raw `configuration.runWithTenant(...)` only changes the tenant context; use the `Tenant` facade when the callback requires connections and initialized tenant models.

Provisioning a tenant database from the default/template database is mechanism the framework also provides: `SchemaCloner` clones table structure and baselines the `schema_migrations` ledger, and `DataCopier` copies a tenant's owned rows following a `TenantTablePlan`. Call these from your provider's `createDatabase`/migration hooks to materialize a new tenant. When an existing tenant table is missing an auto-increment column backed by a separate source unique index, the cloner adds the column and index in the same schema alteration so MySQL-compatible databases accept the definition.

### Moving rows between databases

`DataCopier.move(keyValue, {transformRow})` re-homes the selected row graph instead of retaining the source copy. It writes and verifies the target in one transaction before starting a separate source-delete transaction. A failed target write therefore leaves the source untouched; if the target committed but the source delete failed, retrying replaces the same target row IDs and attempts the source delete again. A retry after the source is already gone is a no-op and never deletes the target.

The optional `transformRow` callback receives a shallow clone plus its table name. Use it for target-only ownership fields when a row becomes tenant-owned during the move; it must preserve the configured id column. Source and target must resolve to different physical databases, even when they are checked out through different configured identifiers.

```js
import DataCopier from "velocious/build/src/database/tenants/data-copier.js"

const copier = new DataCopier({
  sourceDb: defaultDb,
  targetDb: projectTenantDb,
  tablePlan: [{keyColumn: "id", tableName: "webhook_deliveries"}]
})

await copier.move(webhookDeliveryId, {
  transformRow: ({row}) => ({...row, project_id: projectId})
})
```

The target commit and source delete cannot share one transaction across independent databases. Callers that need retry routing after the source disappears must persist that routing separately, such as in their job arguments or global locator table.

Because `listTenants` runs every time, tenant databases are dynamic:

- newly created tenants are included in the next `db:tenants:create/check/migrate` run;
- removed tenants disappear from the next provider result and are no longer migrated;
- the app can still serve any one tenant immediately by resolving its tenant object through `tenantDatabaseResolver`.

### Cross-tenant aggregation

`Tenant.aggregateAcross` runs one aggregate over the same table in many tenant databases and returns the combined result, so a scheduler or dashboard can ask "how much is reserved per docker server across every tenant?" without looping tenant-by-tenant in application code. Tenant databases may be co-located on the default server or spread across other servers, and they can be created or dropped at runtime; the helper resolves the live tenant list, groups tenants by the server they live on, and — per server — emits a **single cross-database `UNION ALL`** when the driver supports two-part `` `database`.`table` `` references (MySQL/MariaDB) or falls back to **one query per tenant** otherwise (PostgreSQL, SQLite, and MSSQL — which needs three-part `database.schema.table` naming). Results from every server are merged with each aggregate's own operation, so you always get one combined result set.

```js
import Tenant from "velocious/build/src/tenants/tenant.js"

const reservedByServer = await Tenant.aggregateAcross({
  identifier: "projectTenant",
  // Optional: pass explicit `tenants: [...]` descriptors, or omit to aggregate every tenant the
  // provider's listTenants returns. `filter` narrows either source.
  filter: (tenant) => tenant.tenantState === "migrated",
  keyColumns: ["docker_server_id"],
  // "SUM" is shorthand for {op: "SUM", column: "reserved"}; use {op: "COUNT", column: "*"} for COUNT(*).
  aggregates: {reserved: "SUM", buildCount: {op: "COUNT", column: "*"}},
  // One per-tenant subquery. `table(name)` returns the correctly-qualified table for the current
  // execution path (a `database`.`table` identifier inside a cross-database UNION, or the plain
  // table name when the tenant runs on its own connection). `quote(value)` / `quote.list(values)`
  // quote values for the active connection.
  subquery: ({quote, table}) => `
    SELECT docker_server_id AS docker_server_id, COALESCE(estimated_cpu_usage, 0) AS reserved
    FROM ${table("builds")}
    WHERE status IN (${quote.list(["assigned", "running"])})
  `
})
// => [{docker_server_id: "server-1", reserved: 650, buildCount: 3}, ...] merged across every tenant.
```

The subquery must select every `keyColumns` entry plus every aggregate source column. Supported operations are `SUM`, `COUNT`, `MAX`, and `MIN` — each is associative, so per-server results merge correctly whether they came from one `UNION ALL` or several per-tenant queries. A `NULL` aggregate value (an empty tenant's `SUM`/`MAX`/`MIN`) is treated as "no contribution" while merging; a key contributed to by no tenant comes back `NULL`. Exact integer aggregates that exceed JavaScript's safe-integer range throw rather than silently rounding. Omit `keyColumns` for a single grand-total row. Whether a driver can span databases in one statement is exposed by `connection.supportsCrossDatabaseReferences()`.

The same provider list is used when a non-tenant model destroys with `dependent: "restrict"` relationships pointing at tenant-switched child models. Velocious counts the relationship inside each tenant context and blocks the parent destroy if any tenant has dependent rows. This keeps application code from duplicating tenant scans just to avoid foreign-key failures at delete time.

If lifecycle commands need to include tenants whose databases are not readable yet, add `listRestrictTenants`. Dependent restrict checks use `listRestrictTenants` when present and otherwise fall back to `listTenants`.

If the targeted identifier is disabled with `VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS`, tenant lifecycle commands fail fast instead of silently skipping the tenant connection.

## Reading a model in a specific tenant or the default database

Some models can live in more than one database — a per-tenant row in a project's tenant database, or a shared row in the default database (for example a model the tenant table-plan marks `allowDefaultDatabase`). A plain `Model.findBy(...)` resolves its database from the ambient `Current.tenant()`, so code running inside one tenant cannot see a row that lives in another tenant or the default database, and it cannot rely on whichever tenant happens to be active.

`Model.usingTenant(tenant)` returns a scope whose eager finders run against an explicit tenant (and therefore its database), ensuring that tenant's connections for the duration of each query:

```js
// Look in a specific project tenant first, then fall back to the default database —
// two databases at most, never a scan across every tenant.
const inTenant = await GithubWebhook.usingTenant(projectTenant).findBy({id})
const webhook = inTenant || await GithubWebhook.usingTenant(defaultTenant).findBy({id})
```

`usingTenant(tenant)` supports `find`, `findBy`, and `findByOrFail`. The `tenant` argument is any descriptor accepted by `configuration.runWithTenant(...)`; pass a descriptor whose `databaseIdentifiers` is empty to target the default database. First-time initialization for a tenant-switched model happens inside the requested tenant, so a model whose table only exists in the tenant database initializes from the correct schema.
