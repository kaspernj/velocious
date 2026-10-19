export type TestTenantPoolConfiguration = import("../configuration-types.js").TestTenantPoolConfiguration;
export type TestTenantPoolLease = {
    /**
     * - Tenant database identifier the lease belongs to.
     */
    databaseIdentifier: string;
    /**
     * - The pool member's tenant descriptor.
     */
    tenant: ReturnType<typeof JSON.parse>;
    /**
     * - Internal pool member backing the lease.
     */
    member: TestTenantPoolMember;
};
export type TestTenantPoolMember = {
    /**
     * - Whether the member is currently held by a lease.
     */
    leased: boolean;
    /**
     * - Tenant descriptor resolved by the app's tenantDatabaseResolver.
     */
    tenant: ReturnType<typeof JSON.parse>;
};
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
    configuration: import("../configuration.js").default;
    databaseIdentifier: string;
    poolConfiguration: import("../configuration-types.js").TestTenantPoolConfiguration;
    /** @type {TestTenantPoolMember[]} */
    members: TestTenantPoolMember[];
    /** @type {Map<string, TestTenantPoolMember>} */
    membersByTenantKey: Map<string, TestTenantPoolMember>;
    /** @type {Promise<void> | undefined} */
    provisioningPromise: Promise<void> | undefined;
    /** @type {Promise<string | null> | undefined} */
    structureSqlPromise: Promise<string | null> | undefined;
    dropped: boolean;
    /**
     * Creates a pool for one tenant database identifier.
     * @param {object} args - Pool arguments.
     * @param {import("../configuration.js").default} args.configuration - Configuration owning the tenant resolver.
     * @param {string} args.databaseIdentifier - Tenant-only database identifier to pool.
     * @param {TestTenantPoolConfiguration} args.poolConfiguration - Pool size (via `tenants`) and optional provisioning overrides.
     */
    constructor({ configuration, databaseIdentifier, poolConfiguration }: {
        configuration: import("../configuration.js").default;
        databaseIdentifier: string;
        poolConfiguration: TestTenantPoolConfiguration;
    });
    /**
     * Number of pool members.
     * @returns {number} - Pool size.
     */
    size(): number;
    /**
     * Acquires one pool member as a lease. The first free member in configured order is
     * taken; when every member is leased the acquisition fails loudly instead of queueing.
     * @param {{tenant?: ReturnType<typeof JSON.parse>}} [args] - Optional explicit pool tenant to pin.
     * @returns {Promise<TestTenantPoolLease>} - Held lease; pass it to {@link release}.
     */
    acquire({ tenant }?: {
        tenant?: ReturnType<typeof JSON.parse>;
    }): Promise<TestTenantPoolLease>;
    /**
     * Resets a leased member (truncate + ledger baseline, or the configured `resetTenant`
     * override) and returns it to the free pool. Idempotent for an already-free member.
     * A failed reset is followed by a full re-provision so a corrupted member cannot be
     * handed to the next test; if re-provisioning also fails the member stays leased and
     * the aggregated error is thrown.
     * @param {TestTenantPoolLease} lease - Lease returned by {@link acquire}.
     * @returns {Promise<void>} - Resolves once the member is clean and free again.
     */
    release(lease: TestTenantPoolLease): Promise<void>;
    /**
     * Drops every pool member's tenant database through the provider's `dropDatabase`
     * hook (or the framework default) and closes the pool. Idempotent.
     * @returns {Promise<void>} - Resolves after all members were dropped.
     */
    teardown(): Promise<void>;
    /**
     * Provisions every member exactly once (concurrent acquisitions share one
     * provisioning pass).
     * @returns {Promise<void>} - Resolves when all members are provisioned.
     */
    ensureProvisioned(): Promise<void>;
    /**
     * Provisions one member: creates the physical tenant database, then loads or clones
     * the default database's structure and baselines the ledger.
     * @param {TestTenantPoolMember} member - Pool member to provision.
     * @returns {Promise<void>} - Resolves when the member's tenant database is ready.
     */
    provisionMember(member: TestTenantPoolMember): Promise<void>;
    /**
     * Creates the physical tenant database via the provider's `createDatabase` hook or
     * the framework default provisioning.
     * @param {TestTenantPoolMember} member - Pool member whose database must exist.
     * @returns {Promise<void>} - Resolves when the tenant database exists.
     */
    createTenantDatabaseForMember(member: TestTenantPoolMember): Promise<void>;
    /**
     * Loads the captured default-database structure into the current tenant connection
     * and baselines its ledger. Drivers without a structure-SQL generator fall back to
     * {@link SchemaCloner} over every default table.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections (must include `default` and the pool identifier).
     * @returns {Promise<void>} - Resolves when the tenant schema and ledger are baselined.
     */
    applyDefaultStructure(dbs: Record<string, import("../database/drivers/base.js").default>): Promise<void>;
    /**
     * Resets one member between tests: truncate every tenant table (the ledger table is
     * preserved by `truncateAllTables`) and re-baseline the ledger from the default
     * database, so the next test starts from the same schema state without a structure load.
     * @param {TestTenantPoolMember} member - Leased member to clean.
     * @returns {Promise<void>} - Resolves when the member is empty and ledger-current.
     */
    resetMember(member: TestTenantPoolMember): Promise<void>;
    /**
     * Baselines a tenant connection's ledger from the default database. Skips when the
     * default database has no ledger yet (nothing to baseline from).
     * @param {import("../database/drivers/base.js").default} tenantDb - Tenant connection whose ledger is refreshed.
     * @returns {Promise<void>} - Resolves when the ledger matches the default database.
     */
    baselineLedger(tenantDb: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Drops one member's tenant database through the provider's `dropDatabase` hook or
     * the framework default.
     * @param {TestTenantPoolMember} member - Pool member to drop.
     * @returns {Promise<void>} - Resolves when the tenant database is gone.
     */
    dropMember(member: TestTenantPoolMember): Promise<void>;
    /**
     * Captures the default database's structure SQL once per pool (the framework
     * generalization of the consuming apps' captured-structure fast path). Returns null
     * for drivers without a structure generator, which selects the SchemaCloner fallback.
     * @returns {Promise<string | null>} - Captured structure SQL or null.
     */
    capturedStructureSql(): Promise<string | null>;
    /**
     * Runs tenant connection.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections.
     * @returns {import("../database/drivers/base.js").default} - The pool identifier's connection.
     */
    tenantConnection(dbs: Record<string, import("../database/drivers/base.js").default>): import("../database/drivers/base.js").default;
    /**
     * Runs default connection.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections.
     * @returns {import("../database/drivers/base.js").default} - The default connection (ledger baseline source).
     */
    defaultConnection(dbs: Record<string, import("../database/drivers/base.js").default>): import("../database/drivers/base.js").default;
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
    withMemberConnection<T>(tenant: ReturnType<typeof JSON.parse>, callback: (db: import("../database/drivers/base.js").default) => Promise<T>): Promise<T>;
}
//# sourceMappingURL=test-tenant-database-pool.d.ts.map