# Tenant migration deploy preflight

Deploy tooling can ask whether any existing tenant database has pending migrations before changing application behavior:

```sh
npx velocious db:tenants:migrations:pending projectTenant
```

To inspect only one declared [migration execution phase](migration-execution-phases.md),
pass the same selector used by tenant migration execution:

```sh
npx velocious db:tenants:migrations:pending projectTenant --phase post-publication
```

With `--phase`, `migrationCount` and pending state include only applicable
migrations in that phase. Omitting it preserves the complete-catalog behavior.

The command loads the normal app-and-package migration manifest, keeps migrations whose `onDatabases(...)` declaration includes the requested tenant-only database identifier, and compares those versions with every tenant's existing `schema_migrations` ledger. It emits exactly one JSON object on standard output after a successful scan:

```json
{"hasPendingMigrations":true,"identifier":"projectTenant","migrationCount":12,"pendingTenantCount":1,"tenantCount":37}
```

The fields are intended for deploy consumers:

- `hasPendingMigrations` is true when at least one listed tenant is missing an applicable manifest version.
- `identifier` is the inspected logical tenant database identifier.
- `migrationCount` is the number of loaded migrations applicable to that identifier.
- `pendingTenantCount` is the number of existing tenants with at least one missing version.
- `tenantCount` is the number of tenants returned by the configured provider. An empty list succeeds with both counts at zero and `hasPendingMigrations: false`.

Pending migrations are reported as successful command output; deploy policy decides whether that state should block or sequence a rollout. Configuration, tenant listing, connection, and ledger errors still reject the command and produce the CLI's normal nonzero process status. In particular, a missing `schema_migrations` table is an error rather than being interpreted as an empty ledger.

This command is strictly observational. It does not create or prepare `schema_migrations`, run migration bodies, call `checkTenant` or `afterMigrateTenant`, create or clone tenant schemas, or otherwise mutate tenant state. Importing migration modules to read their declared target identifiers still runs normal JavaScript module initialization, so migration modules should keep top-level work declarative.

See [tenant databases](tenant-databases.md) for provider and resolver configuration and [database migrations](database-migrations.md) for migration targeting and ledger behavior.
