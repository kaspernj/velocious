# Tenant Databases

Velocious supports tenant-specific database identifiers for apps that keep global records in one database and project/account records in separate tenant databases.

Configure the tenant database as `tenantOnly: true`. Tenant-only identifiers are skipped by normal connection setup and `db:migrate` until a tenant context activates them through `tenantDatabaseResolver`.

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
        // Return tenant objects that tenantDatabaseResolver can resolve.
        return await Project.all().select(["id", "databaseName"]).toArray()
      },
      createDatabase: async ({databaseConfiguration, tenant}) => {
        // App-specific database creation, grants, and structure loading.
      },
      checkTenant: async ({databaseConfiguration, tenant}) => {
        // Optional preflight checks before generic connection validation.
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
