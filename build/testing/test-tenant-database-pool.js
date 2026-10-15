// @ts-check

import MigrationsLedger from "../database/migrations-ledger.js"
import SchemaCloner from "../database/tenants/schema-cloner.js"
import StructureSqlLoader from "../database/structure-sql-loader.js"
import {createTenantDatabase, dropTenantDatabase} from "../tenants/default-tenant-database-provisioning.js"
import TenantIterator from "../tenants/tenant-iterator.js"

/**
 * @typedef {import("../configuration-types.js").TestTenantPoolConfiguration} TestTenantPoolConfiguration
 */

/**
 * A leased pool member. Leases are handed out by {@link TestTenantDatabasePool#acquire}
 * and returned by {@link TestTenantDatabasePool#release}.
 * @typedef {object} TestTenantPoolLease
 * @property {string} databaseIdentifier - Tenant database identifier the lease belongs to.
 * @property {ReturnType<typeof JSON.parse>} tenant - The pool member's tenant descriptor.
 * @property {TestTenantPoolMember} member - Internal pool member backing the lease.
 */

/**
 * One pre-provisioned pool slot.
 * @typedef {object} TestTenantPoolMember
 * @property {boolean} leased - Whether the member is currently held by a lease.
 * @property {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor resolved by the app's tenantDatabaseResolver.
 */

/**
 * Key-stable JSON key for a tenant descriptor.
 * @param {ReturnType<typeof JSON.parse>} value - Value to key-stably stringify.
 * @returns {string} - Deterministic JSON with sorted object keys.
 */
function stableTenantKey(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map((entry) => stableTenantKey(entry)).join(",")}]`

  const keys = Object.keys(value).sort()

  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableTenantKey(value[key])}`).join(",")}}`
}

/**
 * Reusable pool of pre-provisioned test tenant databases (STC-135 "keep a couple for
 * re-use"). Instead of create + full structure load + drop per test, the pool provisions
 * N tenant databases once per suite and resets each one between tests with
 * truncate + migration-ledger baseline — the framework generalization of the
 * captured-structure fast path consuming apps had to hand-roll.
 *
 * Provisioning runs the tenant provider's `createDatabase` hook (or the framework
 * default provisioning), then loads the default database's captured structure SQL in
 * one pass via {@link StructureSqlLoader} and baselines the tenant's
 * `schema_migrations` ledger from the default database. Apps whose tenant schema
 * differs from the default database (subset tables, FK-free clones) override
 * `provisionTenant`/`resetTenant` in the pool configuration.
 *
 * Leases are deterministic: acquisition takes the first free member in configured
 * order, so a suite that acquires and releases one lease per test reuses the same
 * members in the same order. Acquisition is synchronous after provisioning, so
 * concurrent acquires can never double-lease one member; exhaustion throws instead
 * of queueing, because a test that holds a lease while waiting would deadlock the
 * single-threaded runner.
 */
export default class TestTenantDatabasePool {
  /**
   * Creates a pool for one tenant database identifier.
   * @param {object} args - Pool arguments.
   * @param {import("../configuration.js").default} args.configuration - Configuration owning the tenant resolver.
   * @param {string} args.databaseIdentifier - Tenant-only database identifier to pool.
   * @param {TestTenantPoolConfiguration} args.poolConfiguration - Pool size (via `tenants`) and optional provisioning overrides.
   */
  constructor({configuration, databaseIdentifier, poolConfiguration}) {
    if (!configuration) throw new Error("TestTenantDatabasePool requires a configuration")
    if (!databaseIdentifier) throw new Error("TestTenantDatabasePool requires a databaseIdentifier")
    if (!Array.isArray(poolConfiguration.tenants) || poolConfiguration.tenants.length === 0) {
      throw new Error(`Test tenant pool for ${databaseIdentifier} requires a non-empty tenants array`)
    }

    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.poolConfiguration = poolConfiguration
    /** @type {TestTenantPoolMember[]} */
    this.members = poolConfiguration.tenants.map((tenant) => ({leased: false, tenant}))
    /** @type {Map<string, TestTenantPoolMember>} */
    this.membersByTenantKey = new Map()

    for (const member of this.members) {
      this.membersByTenantKey.set(stableTenantKey(member.tenant), member)
    }

    /** @type {Promise<void> | undefined} */
    this.provisioningPromise = undefined
    /** @type {Promise<string | null> | undefined} */
    this.structureSqlPromise = undefined
    this.dropped = false
  }

  /**
   * Number of pool members.
   * @returns {number} - Pool size.
   */
  size() {
    return this.members.length
  }

  /**
   * Acquires one pool member as a lease. The first free member in configured order is
   * taken; when every member is leased the acquisition fails loudly instead of queueing.
   * @param {{tenant?: ReturnType<typeof JSON.parse>}} [args] - Optional explicit pool tenant to pin.
   * @returns {Promise<TestTenantPoolLease>} - Held lease; pass it to {@link release}.
   */
  async acquire({tenant} = {}) {
    if (this.dropped) {
      throw new Error(`Test tenant database pool for ${this.databaseIdentifier} was already torn down`)
    }

    await this.ensureProvisioned()

    /** @type {TestTenantPoolMember | undefined} */
    let member

    if (tenant !== undefined) {
      member = this.membersByTenantKey.get(stableTenantKey(tenant))

      if (!member) {
        throw new Error(`Tenant ${TenantIterator.tenantLabel(tenant)} is not a member of the test tenant pool for ${this.databaseIdentifier}`)
      }
      if (member.leased) {
        throw new Error(`Test tenant pool member ${TenantIterator.tenantLabel(tenant)} for ${this.databaseIdentifier} is already leased`)
      }
    } else {
      member = this.members.find((candidate) => !candidate.leased)

      if (!member) {
        throw new Error(`Test tenant database pool exhausted for ${this.databaseIdentifier} (size ${this.members.length}, all leased). Release a lease before acquiring another tenant.`)
      }
    }

    member.leased = true

    return {databaseIdentifier: this.databaseIdentifier, member, tenant: member.tenant}
  }

  /**
   * Resets a leased member (truncate + ledger baseline, or the configured `resetTenant`
   * override) and returns it to the free pool. Idempotent for an already-free member.
   * A failed reset is followed by a full re-provision so a corrupted member cannot be
   * handed to the next test; if re-provisioning also fails the member stays leased and
   * the aggregated error is thrown.
   * @param {TestTenantPoolLease} lease - Lease returned by {@link acquire}.
   * @returns {Promise<void>} - Resolves once the member is clean and free again.
   */
  async release(lease) {
    if (lease.databaseIdentifier !== this.databaseIdentifier) {
      throw new Error(`Lease belongs to pool ${lease.databaseIdentifier}, not ${this.databaseIdentifier}`)
    }

    const member = lease.member

    if (!member.leased) return

    try {
      await this.resetMember(member)
    } catch (resetError) {
      try {
        await this.provisionMember(member)
      } catch (provisionError) {
        throw new AggregateError(
          [resetError, provisionError],
          `Failed to reset and re-provision test tenant pool member ${TenantIterator.tenantLabel(member.tenant)} for ${this.databaseIdentifier}`,
          {cause: provisionError}
        )
      }
    }

    member.leased = false
  }

  /**
   * Drops every pool member's tenant database through the provider's `dropDatabase`
   * hook (or the framework default) and closes the pool. Idempotent.
   * @returns {Promise<void>} - Resolves after all members were dropped.
   */
  async teardown() {
    if (this.dropped) return

    this.dropped = true

    const errors = []

    for (const member of this.members) {
      try {
        await this.dropMember(member)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length === 1) throw errors[0]
    if (errors.length > 0) throw new AggregateError(errors, `Failed to tear down the test tenant database pool for ${this.databaseIdentifier}`)
  }

  /**
   * Provisions every member exactly once (concurrent acquisitions share one
   * provisioning pass).
   * @returns {Promise<void>} - Resolves when all members are provisioned.
   */
  async ensureProvisioned() {
    this.provisioningPromise ??= (async () => {
      for (const member of this.members) {
        await this.provisionMember(member)
      }
    })()

    await this.provisioningPromise
  }

  /**
   * Provisions one member: creates the physical tenant database, then loads or clones
   * the default database's structure and baselines the ledger.
   * @param {TestTenantPoolMember} member - Pool member to provision.
   * @returns {Promise<void>} - Resolves when the member's tenant database is ready.
   */
  async provisionMember(member) {
    if (typeof this.poolConfiguration.provisionTenant === "function") {
      await this.poolConfiguration.provisionTenant({
        configuration: this.configuration,
        databaseIdentifier: this.databaseIdentifier,
        tenant: member.tenant
      })

      return
    }

    await this.createTenantDatabaseForMember(member)

    // The tenantDatabaseResolver rewrites every identifier inside a tenant context
    // (including `default`), so the structure/ledger source must be read outside the
    // tenant scope while the member is reached through a dedicated pool checkout.
    await this.withMemberConnection(member.tenant, async (tenantDb) => {
      await this.configuration.ensureConnections({databaseIdentifiers: ["default"], name: `Test tenant pool provision: ${this.databaseIdentifier}`}, async (dbs) => {
        await this.applyDefaultStructure({...dbs, [this.databaseIdentifier]: tenantDb})
      })
    })
  }

  /**
   * Creates the physical tenant database via the provider's `createDatabase` hook or
   * the framework default provisioning.
   * @param {TestTenantPoolMember} member - Pool member whose database must exist.
   * @returns {Promise<void>} - Resolves when the tenant database exists.
   */
  async createTenantDatabaseForMember(member) {
    const provider = this.configuration.getTenantDatabaseProviders()[this.databaseIdentifier]
    const createDatabase = provider && typeof provider.createDatabase === "function"
      ? provider.createDatabase.bind(provider)
      : createTenantDatabase

    await this.configuration.runWithTenant(member.tenant, async () => {
      if (!this.configuration.isDatabaseIdentifierActive(this.databaseIdentifier)) {
        throw new Error(`Tenant database identifier ${this.databaseIdentifier} is inactive for tenant: ${TenantIterator.tenantLabel(member.tenant)}`)
      }

      await createDatabase({
        configuration: this.configuration,
        databaseConfiguration: this.configuration.resolveDatabaseConfiguration(this.databaseIdentifier),
        identifier: this.databaseIdentifier,
        tenant: member.tenant
      })
    })
  }

  /**
   * Loads the captured default-database structure into the current tenant connection
   * and baselines its ledger. Drivers without a structure-SQL generator fall back to
   * {@link SchemaCloner} over every default table.
   * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections (must include `default` and the pool identifier).
   * @returns {Promise<void>} - Resolves when the tenant schema and ledger are baselined.
   */
  async applyDefaultStructure(dbs) {
    const tenantDb = this.tenantConnection(dbs)
    const defaultDb = this.defaultConnection(dbs)
    const structureSql = await this.capturedStructureSql()

    if (structureSql !== null) {
      await new StructureSqlLoader().load({db: tenantDb, structureSql})
    } else {
      const cloner = new SchemaCloner({sourceDb: defaultDb, targetDb: tenantDb})
      const tableNames = (await defaultDb.getTables())
        .map((table) => table.getName())
        .filter((tableName) => tableName !== MigrationsLedger.tableName())

      // syncTable (not syncTables) so the ledger is never reconciled against a
      // default database that has no ledger table yet; baselineLedger owns the
      // ledger step and skips when there is nothing to baseline from.
      for (const tableName of tableNames) {
        await cloner.syncTable(tableName)
      }
    }

    await this.baselineLedger(tenantDb)
  }

  /**
   * Resets one member between tests: truncate every tenant table (the ledger table is
   * preserved by `truncateAllTables`) and re-baseline the ledger from the default
   * database, so the next test starts from the same schema state without a structure load.
   * @param {TestTenantPoolMember} member - Leased member to clean.
   * @returns {Promise<void>} - Resolves when the member is empty and ledger-current.
   */
  async resetMember(member) {
    if (typeof this.poolConfiguration.resetTenant === "function") {
      await this.poolConfiguration.resetTenant({
        configuration: this.configuration,
        databaseIdentifier: this.databaseIdentifier,
        tenant: member.tenant
      })

      return
    }

    await this.withMemberConnection(member.tenant, async (tenantDb) => {
      await tenantDb.truncateAllTables()
      await this.baselineLedger(tenantDb)
    })
  }

  /**
   * Baselines a tenant connection's ledger from the default database. Skips when the
   * default database has no ledger yet (nothing to baseline from).
   * @param {import("../database/drivers/base.js").default} tenantDb - Tenant connection whose ledger is refreshed.
   * @returns {Promise<void>} - Resolves when the ledger matches the default database.
   */
  async baselineLedger(tenantDb) {
    await this.configuration.ensureConnections({databaseIdentifiers: ["default"], name: `Test tenant pool ledger: ${this.databaseIdentifier}`}, async (dbs) => {
      const defaultDb = this.defaultConnection(dbs)

      if (!await MigrationsLedger.tableExists(defaultDb)) return

      await MigrationsLedger.baselineFromDatabase({sourceDb: defaultDb, targetDb: tenantDb})
    })
  }

  /**
   * Drops one member's tenant database through the provider's `dropDatabase` hook or
   * the framework default.
   * @param {TestTenantPoolMember} member - Pool member to drop.
   * @returns {Promise<void>} - Resolves when the tenant database is gone.
   */
  async dropMember(member) {
    const provider = this.configuration.getTenantDatabaseProviders()[this.databaseIdentifier]
    const dropDatabase = provider && typeof provider.dropDatabase === "function"
      ? provider.dropDatabase.bind(provider)
      : dropTenantDatabase

    await this.configuration.runWithTenant(member.tenant, async () => {
      if (!this.configuration.isDatabaseIdentifierActive(this.databaseIdentifier)) {
        throw new Error(`Tenant database identifier ${this.databaseIdentifier} is inactive for tenant: ${TenantIterator.tenantLabel(member.tenant)}`)
      }

      await dropDatabase({
        configuration: this.configuration,
        databaseConfiguration: this.configuration.resolveDatabaseConfiguration(this.databaseIdentifier),
        identifier: this.databaseIdentifier,
        tenant: member.tenant
      })
    })
  }

  /**
   * Captures the default database's structure SQL once per pool (the framework
   * generalization of the consuming apps' captured-structure fast path). Returns null
   * for drivers without a structure generator, which selects the SchemaCloner fallback.
   * @returns {Promise<string | null>} - Captured structure SQL or null.
   */
  capturedStructureSql() {
    this.structureSqlPromise ??= (async () => {
      return await this.configuration.ensureConnections({databaseIdentifiers: ["default"], name: "Test tenant pool structure capture"}, async (dbs) => {
        return await dbs.default.structureSql()
      })
    })()

    return this.structureSqlPromise
  }

  /**
   * Runs tenant connection.
   * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections.
   * @returns {import("../database/drivers/base.js").default} - The pool identifier's connection.
   */
  tenantConnection(dbs) {
    const tenantDb = dbs[this.databaseIdentifier]

    if (!tenantDb) throw new Error(`Expected a ${this.databaseIdentifier} connection for the test tenant pool`)

    return tenantDb
  }

  /**
   * Runs default connection.
   * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections.
   * @returns {import("../database/drivers/base.js").default} - The default connection (ledger baseline source).
   */
  defaultConnection(dbs) {
    const defaultDb = dbs.default

    if (!defaultDb) throw new Error(`Expected a default connection for the test tenant pool on ${this.databaseIdentifier}`)

    return defaultDb
  }

  /**
   * Runs with a dedicated physical connection for one member. The reset path truncates
   * committed data, so it must not reuse a test-pinned or async-context connection that
   * a later rollback would undo — it checks out through the pool exactly like
   * `registerTransactionalTenant` does and releases the connection back to the pool.
   * @param {ReturnType<typeof JSON.parse>} tenant - Pool member tenant descriptor.
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Operation on the dedicated connection.
   * @returns {Promise<T>} - Callback result.
   */
  async withMemberConnection(tenant, callback) {
    const pool = this.configuration.getDatabasePool(this.databaseIdentifier)
    const databaseConfiguration = this.configuration.resolveDatabaseConfiguration(this.databaseIdentifier, tenant)

    if (!databaseConfiguration.tenantOnly) {
      throw new Error(`Test tenant pool requires a tenantOnly database: ${this.databaseIdentifier}`)
    }

    const connection = await pool.checkoutForConfiguration(databaseConfiguration, {name: `Test tenant pool member: ${this.databaseIdentifier}`})

    try {
      return await callback(connection)
    } finally {
      await pool.checkin(connection)
    }
  }
}
