# Test Tenant Database Pools

Opt-in reusable pools of pre-provisioned tenant databases for the test harness
(`testTenantPools` in the application configuration). Consuming apps that provision
a tenant database per test pay a full structure load and teardown every example;
the pool provisions N tenant databases once per suite and resets each one between
tests with truncate + migration-ledger baseline instead.

Measured background (TensorBuzz, MariaDB 11.8): `CREATE`/`DROP DATABASE` is ~1 ms —
the expensive parts are the ~44-table structure load (~132 introspect+create
queries per provision), the ledger baseline, and the teardown purge. The pool
removes the per-test structure load and drop entirely.

## Configuration

`testTenantPools` maps a tenant database identifier to a pool definition. It is
consumed only by the test harness; ordinary runtime ignores it.

```js
new Configuration({
  // ...
  testTenantPools: {
    projectTenant: {
      tenants: [{slug: "test-pool-1"}, {slug: "test-pool-2"}]
    }
  }
})
```

- `tenants` — the pool members. Each entry is a tenant descriptor understood by
  the app's `tenantDatabaseResolver` (the resolver must map it to a distinct
  physical database). Pool size is the array length.
- `provisionTenant` — optional override replacing the framework provisioning
  (create + structure load + ledger baseline) for one member.
- `resetTenant` — optional override replacing the framework per-test reset
  (truncate + ledger baseline) for one member.

Existing per-test create/drop provisioning stays the default: without a
`testTenantPools` entry nothing changes, and `acquireTestTenant` is unavailable.

## Test-side API

Every test callback receives both helpers on `testArgs`:

```js
it("writes into a pooled tenant", async (testArgs) => {
  const lease = await testArgs.acquireTestTenant({databaseIdentifier: "projectTenant"})

  // Share a physical transaction with the leased tenant like any other tenant test.
  await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: lease.tenant})

  await Tenant.with(lease.tenant, async () => {
    await ProjectRow.create({value: "inside the pooled tenant"})
  })
  // The attempt ends: the transactional tenant rolls back, the pool member is
  // truncated + ledger-rebased, and the lease returns to the pool automatically.
})
```

- `acquireTestTenant({databaseIdentifier?, tenant?})` leases one pool member.
  `databaseIdentifier` may be omitted when exactly one pool is configured.
  `tenant` pins a specific member. Acquisition takes the first free member in
  configured order, so acquire/release cycles reuse members deterministically.
  When every member is leased the acquisition throws instead of queueing — a
  waiting test would deadlock the single-threaded runner. Raise the pool size
  when a suite genuinely needs more simultaneous tenants.
- Leases are released automatically at attempt end (after `afterEach` hooks and
  transactional-tenant rollbacks). A failed reset triggers a full re-provision of
  that member before it is freed, so a corrupted tenant database is never handed
  to the next test.
- Pool databases are dropped once at the end of the run (runner teardown and the
  signal/interrupt path), not per test.

## First-class tenant cleanup registration

Tests that still create their own tenant databases (DDL a test transaction cannot
roll back) no longer need a hand-rolled Map + `afterEach` drop layer:

```js
it("provisions its own tenant", async (testArgs) => {
  await provisionMyTenant(project)

  testArgs.registerTenantForCleanup({databaseIdentifier: "projectTenant", tenant: {slug: project.slug}})
})
```

`registerTenantForCleanup` drops the tenant's database at attempt end through the
provider's `dropDatabase` hook (or the framework default provisioning), after the
attempt's `afterEach` hooks and transactional-tenant rollbacks finished. The
identifier must be `tenantOnly`; drops run even when an earlier one failed and
failures are surfaced (single error or `AggregateError`), never swallowed.

## Provisioning and reset semantics

Default provisioning per member:

1. Create the physical tenant database via the provider's `createDatabase` hook
   or the framework default (`src/tenants/default-tenant-database-provisioning.js`).
2. Load the default database's captured `structureSql()` into the member in one
   pass via `StructureSqlLoader` (drivers without a structure generator fall back
   to `SchemaCloner.syncTable` per table).
3. Baseline the member's `schema_migrations` ledger from the default database
   (skipped when the default database has no ledger yet).

Default reset between tests: `truncateAllTables` on a dedicated pool checkout
(never a test-pinned connection a later rollback could undo — the ledger table is
preserved by truncation) plus a ledger re-baseline from the default database.

Apps whose tenant schema differs from the default database (subset tables,
FK-free tenant clones) override `provisionTenant`/`resetTenant`; TensorBuzz's
`tests/support/fast-tenant-schema.js` captured-structure path is exactly this
pattern, which the framework option generalizes.

## Consuming from an app test harness (TensorBuzz path)

Bump the `velocious` pin, then replace the per-test
`registerProjectTenantForCleanup` Map/`afterEach` bookkeeping in
`backend/src/config/testing.js` with `testArgs.registerTenantForCleanup`, and
migrate the heaviest `withMigratedProjectTenant` spec families to
`testArgs.acquireTestTenant` with a `provisionTenant` override that runs the
app's tenant schema service.

## Specs

- `spec/testing/test-tenant-database-pool-spec.js` — provisioning, isolation,
  exhaustion, pinning, teardown, reset-failure re-provisioning, concurrent
  acquisition safety.
- `spec/testing/test-runner-tenant-pool-spec.js` — runner lifecycle: lease reuse
  across attempts, committed-row truncation proof, exhaustion failure reporting,
  cleanup registration ordering and validation.
