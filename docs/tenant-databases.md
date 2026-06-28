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
```

Tenant lifecycle commands run one tenant at a time by default. Add `--parallel` to process up to 20 tenants at once, or pass a positive integer to choose a different concurrency:

```sh
npx velocious db:tenants:migrate projectTenant --parallel
npx velocious db:tenants:migrate projectTenant --parallel 20
```

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

Because `listTenants` runs every time, tenant databases are dynamic:

- newly created tenants are included in the next `db:tenants:create/check/migrate` run;
- removed tenants disappear from the next provider result and are no longer migrated;
- the app can still serve any one tenant immediately by resolving its tenant object through `tenantDatabaseResolver`.

The same provider list is used when a non-tenant model destroys with `dependent: "restrict"` relationships pointing at tenant-switched child models. Velocious counts the relationship inside each tenant context and blocks the parent destroy if any tenant has dependent rows. This keeps application code from duplicating tenant scans just to avoid foreign-key failures at delete time.

If lifecycle commands need to include tenants whose databases are not readable yet, add `listRestrictTenants`. Dependent restrict checks use `listRestrictTenants` when present and otherwise fall back to `listTenants`.

If the targeted identifier is disabled with `VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS`, tenant lifecycle commands fail fast instead of silently skipping the tenant connection.
