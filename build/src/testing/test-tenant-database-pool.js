// @ts-check
import MigrationsLedger from "../database/migrations-ledger.js";
import SchemaCloner from "../database/tenants/schema-cloner.js";
import StructureSqlLoader from "../database/structure-sql-loader.js";
import { createTenantDatabase, dropTenantDatabase } from "../tenants/default-tenant-database-provisioning.js";
import TenantIterator from "../tenants/tenant-iterator.js";
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
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map((entry) => stableTenantKey(entry)).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableTenantKey(value[key])}`).join(",")}}`;
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
    constructor({ configuration, databaseIdentifier, poolConfiguration }) {
        if (!configuration)
            throw new Error("TestTenantDatabasePool requires a configuration");
        if (!databaseIdentifier)
            throw new Error("TestTenantDatabasePool requires a databaseIdentifier");
        if (!Array.isArray(poolConfiguration.tenants) || poolConfiguration.tenants.length === 0) {
            throw new Error(`Test tenant pool for ${databaseIdentifier} requires a non-empty tenants array`);
        }
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.poolConfiguration = poolConfiguration;
        /** @type {TestTenantPoolMember[]} */
        this.members = poolConfiguration.tenants.map((tenant) => ({ leased: false, tenant }));
        /** @type {Map<string, TestTenantPoolMember>} */
        this.membersByTenantKey = new Map();
        for (const member of this.members) {
            this.membersByTenantKey.set(stableTenantKey(member.tenant), member);
        }
        /** @type {Promise<void> | undefined} */
        this.provisioningPromise = undefined;
        /** @type {Promise<string | null> | undefined} */
        this.structureSqlPromise = undefined;
        this.dropped = false;
    }
    /**
     * Number of pool members.
     * @returns {number} - Pool size.
     */
    size() {
        return this.members.length;
    }
    /**
     * Acquires one pool member as a lease. The first free member in configured order is
     * taken; when every member is leased the acquisition fails loudly instead of queueing.
     * @param {{tenant?: ReturnType<typeof JSON.parse>}} [args] - Optional explicit pool tenant to pin.
     * @returns {Promise<TestTenantPoolLease>} - Held lease; pass it to {@link release}.
     */
    async acquire({ tenant } = {}) {
        if (this.dropped) {
            throw new Error(`Test tenant database pool for ${this.databaseIdentifier} was already torn down`);
        }
        await this.ensureProvisioned();
        /** @type {TestTenantPoolMember | undefined} */
        let member;
        if (tenant !== undefined) {
            member = this.membersByTenantKey.get(stableTenantKey(tenant));
            if (!member) {
                throw new Error(`Tenant ${TenantIterator.tenantLabel(tenant)} is not a member of the test tenant pool for ${this.databaseIdentifier}`);
            }
            if (member.leased) {
                throw new Error(`Test tenant pool member ${TenantIterator.tenantLabel(tenant)} for ${this.databaseIdentifier} is already leased`);
            }
        }
        else {
            member = this.members.find((candidate) => !candidate.leased);
            if (!member) {
                throw new Error(`Test tenant database pool exhausted for ${this.databaseIdentifier} (size ${this.members.length}, all leased). Release a lease before acquiring another tenant.`);
            }
        }
        member.leased = true;
        return { databaseIdentifier: this.databaseIdentifier, member, tenant: member.tenant };
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
            throw new Error(`Lease belongs to pool ${lease.databaseIdentifier}, not ${this.databaseIdentifier}`);
        }
        const member = lease.member;
        if (!member.leased)
            return;
        try {
            await this.resetMember(member);
        }
        catch (resetError) {
            try {
                await this.provisionMember(member);
            }
            catch (provisionError) {
                throw new AggregateError([resetError, provisionError], `Failed to reset and re-provision test tenant pool member ${TenantIterator.tenantLabel(member.tenant)} for ${this.databaseIdentifier}`, { cause: provisionError });
            }
        }
        member.leased = false;
    }
    /**
     * Drops every pool member's tenant database through the provider's `dropDatabase`
     * hook (or the framework default) and closes the pool. Idempotent.
     * @returns {Promise<void>} - Resolves after all members were dropped.
     */
    async teardown() {
        if (this.dropped)
            return;
        this.dropped = true;
        const errors = [];
        for (const member of this.members) {
            try {
                await this.dropMember(member);
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 0)
            throw new AggregateError(errors, `Failed to tear down the test tenant database pool for ${this.databaseIdentifier}`);
    }
    /**
     * Provisions every member exactly once (concurrent acquisitions share one
     * provisioning pass).
     * @returns {Promise<void>} - Resolves when all members are provisioned.
     */
    async ensureProvisioned() {
        this.provisioningPromise ??= (async () => {
            for (const member of this.members) {
                await this.provisionMember(member);
            }
        })();
        await this.provisioningPromise;
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
            });
            return;
        }
        await this.createTenantDatabaseForMember(member);
        // The tenantDatabaseResolver rewrites every identifier inside a tenant context
        // (including `default`), so the structure/ledger source must be read outside the
        // tenant scope while the member is reached through a dedicated pool checkout.
        await this.withMemberConnection(member.tenant, async (tenantDb) => {
            await this.configuration.ensureConnections({ databaseIdentifiers: ["default"], name: `Test tenant pool provision: ${this.databaseIdentifier}` }, async (dbs) => {
                await this.applyDefaultStructure({ ...dbs, [this.databaseIdentifier]: tenantDb });
            });
        });
    }
    /**
     * Creates the physical tenant database via the provider's `createDatabase` hook or
     * the framework default provisioning.
     * @param {TestTenantPoolMember} member - Pool member whose database must exist.
     * @returns {Promise<void>} - Resolves when the tenant database exists.
     */
    async createTenantDatabaseForMember(member) {
        const provider = this.configuration.getTenantDatabaseProviders()[this.databaseIdentifier];
        const createDatabase = provider && typeof provider.createDatabase === "function"
            ? provider.createDatabase.bind(provider)
            : createTenantDatabase;
        await this.configuration.runWithTenant(member.tenant, async () => {
            if (!this.configuration.isDatabaseIdentifierActive(this.databaseIdentifier)) {
                throw new Error(`Tenant database identifier ${this.databaseIdentifier} is inactive for tenant: ${TenantIterator.tenantLabel(member.tenant)}`);
            }
            await createDatabase({
                configuration: this.configuration,
                databaseConfiguration: this.configuration.resolveDatabaseConfiguration(this.databaseIdentifier),
                identifier: this.databaseIdentifier,
                tenant: member.tenant
            });
        });
    }
    /**
     * Loads the captured default-database structure into the current tenant connection
     * and baselines its ledger. Drivers without a structure-SQL generator fall back to
     * {@link SchemaCloner} over every default table.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections (must include `default` and the pool identifier).
     * @returns {Promise<void>} - Resolves when the tenant schema and ledger are baselined.
     */
    async applyDefaultStructure(dbs) {
        const tenantDb = this.tenantConnection(dbs);
        const defaultDb = this.defaultConnection(dbs);
        const structureSql = await this.capturedStructureSql();
        if (structureSql !== null) {
            await new StructureSqlLoader().load({ db: tenantDb, structureSql });
        }
        else {
            const cloner = new SchemaCloner({ sourceDb: defaultDb, targetDb: tenantDb });
            const tableNames = (await defaultDb.getTables())
                .map((table) => table.getName())
                .filter((tableName) => tableName !== MigrationsLedger.tableName());
            // syncTable (not syncTables) so the ledger is never reconciled against a
            // default database that has no ledger table yet; baselineLedger owns the
            // ledger step and skips when there is nothing to baseline from.
            for (const tableName of tableNames) {
                await cloner.syncTable(tableName);
            }
        }
        await this.baselineLedger(tenantDb);
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
            });
            return;
        }
        await this.withMemberConnection(member.tenant, async (tenantDb) => {
            await tenantDb.truncateAllTables();
            await this.baselineLedger(tenantDb);
        });
    }
    /**
     * Baselines a tenant connection's ledger from the default database. Skips when the
     * default database has no ledger yet (nothing to baseline from).
     * @param {import("../database/drivers/base.js").default} tenantDb - Tenant connection whose ledger is refreshed.
     * @returns {Promise<void>} - Resolves when the ledger matches the default database.
     */
    async baselineLedger(tenantDb) {
        await this.configuration.ensureConnections({ databaseIdentifiers: ["default"], name: `Test tenant pool ledger: ${this.databaseIdentifier}` }, async (dbs) => {
            const defaultDb = this.defaultConnection(dbs);
            if (!await MigrationsLedger.tableExists(defaultDb))
                return;
            await MigrationsLedger.baselineFromDatabase({ sourceDb: defaultDb, targetDb: tenantDb });
        });
    }
    /**
     * Drops one member's tenant database through the provider's `dropDatabase` hook or
     * the framework default.
     * @param {TestTenantPoolMember} member - Pool member to drop.
     * @returns {Promise<void>} - Resolves when the tenant database is gone.
     */
    async dropMember(member) {
        const provider = this.configuration.getTenantDatabaseProviders()[this.databaseIdentifier];
        const dropDatabase = provider && typeof provider.dropDatabase === "function"
            ? provider.dropDatabase.bind(provider)
            : dropTenantDatabase;
        await this.configuration.runWithTenant(member.tenant, async () => {
            if (!this.configuration.isDatabaseIdentifierActive(this.databaseIdentifier)) {
                throw new Error(`Tenant database identifier ${this.databaseIdentifier} is inactive for tenant: ${TenantIterator.tenantLabel(member.tenant)}`);
            }
            await dropDatabase({
                configuration: this.configuration,
                databaseConfiguration: this.configuration.resolveDatabaseConfiguration(this.databaseIdentifier),
                identifier: this.databaseIdentifier,
                tenant: member.tenant
            });
        });
    }
    /**
     * Captures the default database's structure SQL once per pool (the framework
     * generalization of the consuming apps' captured-structure fast path). Returns null
     * for drivers without a structure generator, which selects the SchemaCloner fallback.
     * @returns {Promise<string | null>} - Captured structure SQL or null.
     */
    capturedStructureSql() {
        this.structureSqlPromise ??= (async () => {
            return await this.configuration.ensureConnections({ databaseIdentifiers: ["default"], name: "Test tenant pool structure capture" }, async (dbs) => {
                return await dbs.default.structureSql();
            });
        })();
        return this.structureSqlPromise;
    }
    /**
     * Runs tenant connection.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections.
     * @returns {import("../database/drivers/base.js").default} - The pool identifier's connection.
     */
    tenantConnection(dbs) {
        const tenantDb = dbs[this.databaseIdentifier];
        if (!tenantDb)
            throw new Error(`Expected a ${this.databaseIdentifier} connection for the test tenant pool`);
        return tenantDb;
    }
    /**
     * Runs default connection.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Active connections.
     * @returns {import("../database/drivers/base.js").default} - The default connection (ledger baseline source).
     */
    defaultConnection(dbs) {
        const defaultDb = dbs.default;
        if (!defaultDb)
            throw new Error(`Expected a default connection for the test tenant pool on ${this.databaseIdentifier}`);
        return defaultDb;
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
        const pool = this.configuration.getDatabasePool(this.databaseIdentifier);
        const databaseConfiguration = this.configuration.resolveDatabaseConfiguration(this.databaseIdentifier, tenant);
        if (!databaseConfiguration.tenantOnly) {
            throw new Error(`Test tenant pool requires a tenantOnly database: ${this.databaseIdentifier}`);
        }
        const connection = await pool.checkoutForConfiguration(databaseConfiguration, { name: `Test tenant pool member: ${this.databaseIdentifier}` });
        try {
            return await callback(connection);
        }
        finally {
            await pool.checkin(connection);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC10ZW5hbnQtZGF0YWJhc2UtcG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3Rlc3QtdGVuYW50LWRhdGFiYXNlLXBvb2wuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZ0JBQWdCLE1BQU0sa0NBQWtDLENBQUE7QUFDL0QsT0FBTyxZQUFZLE1BQU0sc0NBQXNDLENBQUE7QUFDL0QsT0FBTyxrQkFBa0IsTUFBTSxxQ0FBcUMsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsb0JBQW9CLEVBQUUsa0JBQWtCLEVBQUMsTUFBTSxvREFBb0QsQ0FBQTtBQUMzRyxPQUFPLGNBQWMsTUFBTSwrQkFBK0IsQ0FBQTtBQUUxRDs7R0FFRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7O0dBSUc7QUFDSCxTQUFTLGVBQWUsQ0FBQyxLQUFLO0lBQzVCLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQTtJQUN2RixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFBO0lBRTlGLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7SUFFdEMsT0FBTyxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxlQUFlLENBQUMsS0FBSyxDQUFDLEdBQUcs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QUNoRyxDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMscUJBQXFCLEVBQUUsRUFBQyxJQUFJLEVBQUUsNEJBQTRCLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUU1SSxJQUFJLENBQUM7WUFDSCxPQUFPLE1BQU0sUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ25DLENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNoQyxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBNaWdyYXRpb25zTGVkZ2VyIGZyb20gXCIuLi9kYXRhYmFzZS9taWdyYXRpb25zLWxlZGdlci5qc1wiXG5pbXBvcnQgU2NoZW1hQ2xvbmVyIGZyb20gXCIuLi9kYXRhYmFzZS90ZW5hbnRzL3NjaGVtYS1jbG9uZXIuanNcIlxuaW1wb3J0IFN0cnVjdHVyZVNxbExvYWRlciBmcm9tIFwiLi4vZGF0YWJhc2Uvc3RydWN0dXJlLXNxbC1sb2FkZXIuanNcIlxuaW1wb3J0IHtjcmVhdGVUZW5hbnREYXRhYmFzZSwgZHJvcFRlbmFudERhdGFiYXNlfSBmcm9tIFwiLi4vdGVuYW50cy9kZWZhdWx0LXRlbmFudC1kYXRhYmFzZS1wcm92aXNpb25pbmcuanNcIlxuaW1wb3J0IFRlbmFudEl0ZXJhdG9yIGZyb20gXCIuLi90ZW5hbnRzL3RlbmFudC1pdGVyYXRvci5qc1wiXG5cbi8qKlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVzdFRlbmFudFBvb2xDb25maWd1cmF0aW9ufSBUZXN0VGVuYW50UG9vbENvbmZpZ3VyYXRpb25cbiAqL1xuXG4vKipcbiAqIEEgbGVhc2VkIHBvb2wgbWVtYmVyLiBMZWFzZXMgYXJlIGhhbmRlZCBvdXQgYnkge0BsaW5rIFRlc3RUZW5hbnREYXRhYmFzZVBvb2wjYWNxdWlyZX1cbiAqIGFuZCByZXR1cm5lZCBieSB7QGxpbmsgVGVzdFRlbmFudERhdGFiYXNlUG9vbCNyZWxlYXNlfS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RUZW5hbnRQb29sTGVhc2VcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciB0aGUgbGVhc2UgYmVsb25ncyB0by5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHRlbmFudCAtIFRoZSBwb29sIG1lbWJlcidzIHRlbmFudCBkZXNjcmlwdG9yLlxuICogQHByb3BlcnR5IHtUZXN0VGVuYW50UG9vbE1lbWJlcn0gbWVtYmVyIC0gSW50ZXJuYWwgcG9vbCBtZW1iZXIgYmFja2luZyB0aGUgbGVhc2UuXG4gKi9cblxuLyoqXG4gKiBPbmUgcHJlLXByb3Zpc2lvbmVkIHBvb2wgc2xvdC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RUZW5hbnRQb29sTWVtYmVyXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGxlYXNlZCAtIFdoZXRoZXIgdGhlIG1lbWJlciBpcyBjdXJyZW50bHkgaGVsZCBieSBhIGxlYXNlLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50IGRlc2NyaXB0b3IgcmVzb2x2ZWQgYnkgdGhlIGFwcCdzIHRlbmFudERhdGFiYXNlUmVzb2x2ZXIuXG4gKi9cblxuLyoqXG4gKiBLZXktc3RhYmxlIEpTT04ga2V5IGZvciBhIHRlbmFudCBkZXNjcmlwdG9yLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byBrZXktc3RhYmx5IHN0cmluZ2lmeS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGV0ZXJtaW5pc3RpYyBKU09OIHdpdGggc29ydGVkIG9iamVjdCBrZXlzLlxuICovXG5mdW5jdGlvbiBzdGFibGVUZW5hbnRLZXkodmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKSA/PyBcIm51bGxcIlxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBgWyR7dmFsdWUubWFwKChlbnRyeSkgPT4gc3RhYmxlVGVuYW50S2V5KGVudHJ5KSkuam9pbihcIixcIil9XWBcblxuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXModmFsdWUpLnNvcnQoKVxuXG4gIHJldHVybiBgeyR7a2V5cy5tYXAoKGtleSkgPT4gYCR7SlNPTi5zdHJpbmdpZnkoa2V5KX06JHtzdGFibGVUZW5hbnRLZXkodmFsdWVba2V5XSl9YCkuam9pbihcIixcIil9fWBcbn1cblxuLyoqXG4gKiBSZXVzYWJsZSBwb29sIG9mIHByZS1wcm92aXNpb25lZCB0ZXN0IHRlbmFudCBkYXRhYmFzZXMgKFNUQy0xMzUgXCJrZWVwIGEgY291cGxlIGZvclxuICogcmUtdXNlXCIpLiBJbnN0ZWFkIG9mIGNyZWF0ZSArIGZ1bGwgc3RydWN0dXJlIGxvYWQgKyBkcm9wIHBlciB0ZXN0LCB0aGUgcG9vbCBwcm92aXNpb25zXG4gKiBOIHRlbmFudCBkYXRhYmFzZXMgb25jZSBwZXIgc3VpdGUgYW5kIHJlc2V0cyBlYWNoIG9uZSBiZXR3ZWVuIHRlc3RzIHdpdGhcbiAqIHRydW5jYXRlICsgbWlncmF0aW9uLWxlZGdlciBiYXNlbGluZSDigJQgdGhlIGZyYW1ld29yayBnZW5lcmFsaXphdGlvbiBvZiB0aGVcbiAqIGNhcHR1cmVkLXN0cnVjdHVyZSBmYXN0IHBhdGggY29uc3VtaW5nIGFwcHMgaGFkIHRvIGhhbmQtcm9sbC5cbiAqXG4gKiBQcm92aXNpb25pbmcgcnVucyB0aGUgdGVuYW50IHByb3ZpZGVyJ3MgYGNyZWF0ZURhdGFiYXNlYCBob29rIChvciB0aGUgZnJhbWV3b3JrXG4gKiBkZWZhdWx0IHByb3Zpc2lvbmluZyksIHRoZW4gbG9hZHMgdGhlIGRlZmF1bHQgZGF0YWJhc2UncyBjYXB0dXJlZCBzdHJ1Y3R1cmUgU1FMIGluXG4gKiBvbmUgcGFzcyB2aWEge0BsaW5rIFN0cnVjdHVyZVNxbExvYWRlcn0gYW5kIGJhc2VsaW5lcyB0aGUgdGVuYW50J3NcbiAqIGBzY2hlbWFfbWlncmF0aW9uc2AgbGVkZ2VyIGZyb20gdGhlIGRlZmF1bHQgZGF0YWJhc2UuIEFwcHMgd2hvc2UgdGVuYW50IHNjaGVtYVxuICogZGlmZmVycyBmcm9tIHRoZSBkZWZhdWx0IGRhdGFiYXNlIChzdWJzZXQgdGFibGVzLCBGSy1mcmVlIGNsb25lcykgb3ZlcnJpZGVcbiAqIGBwcm92aXNpb25UZW5hbnRgL2ByZXNldFRlbmFudGAgaW4gdGhlIHBvb2wgY29uZmlndXJhdGlvbi5cbiAqXG4gKiBMZWFzZXMgYXJlIGRldGVybWluaXN0aWM6IGFjcXVpc2l0aW9uIHRha2VzIHRoZSBmaXJzdCBmcmVlIG1lbWJlciBpbiBjb25maWd1cmVkXG4gKiBvcmRlciwgc28gYSBzdWl0ZSB0aGF0IGFjcXVpcmVzIGFuZCByZWxlYXNlcyBvbmUgbGVhc2UgcGVyIHRlc3QgcmV1c2VzIHRoZSBzYW1lXG4gKiBtZW1iZXJzIGluIHRoZSBzYW1lIG9yZGVyLiBBY3F1aXNpdGlvbiBpcyBzeW5jaHJvbm91cyBhZnRlciBwcm92aXNpb25pbmcsIHNvXG4gKiBjb25jdXJyZW50IGFjcXVpcmVzIGNhbiBuZXZlciBkb3VibGUtbGVhc2Ugb25lIG1lbWJlcjsgZXhoYXVzdGlvbiB0aHJvd3MgaW5zdGVhZFxuICogb2YgcXVldWVpbmcsIGJlY2F1c2UgYSB0ZXN0IHRoYXQgaG9sZHMgYSBsZWFzZSB3aGlsZSB3YWl0aW5nIHdvdWxkIGRlYWRsb2NrIHRoZVxuICogc2luZ2xlLXRocmVhZGVkIHJ1bm5lci5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVzdFRlbmFudERhdGFiYXNlUG9vbCB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcG9vbCBmb3Igb25lIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBvb2wgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHRlbmFudCByZXNvbHZlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VJZGVudGlmaWVyIC0gVGVuYW50LW9ubHkgZGF0YWJhc2UgaWRlbnRpZmllciB0byBwb29sLlxuICAgKiBAcGFyYW0ge1Rlc3RUZW5hbnRQb29sQ29uZmlndXJhdGlvbn0gYXJncy5wb29sQ29uZmlndXJhdGlvbiAtIFBvb2wgc2l6ZSAodmlhIGB0ZW5hbnRzYCkgYW5kIG9wdGlvbmFsIHByb3Zpc2lvbmluZyBvdmVycmlkZXMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBwb29sQ29uZmlndXJhdGlvbn0pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIlRlc3RUZW5hbnREYXRhYmFzZVBvb2wgcmVxdWlyZXMgYSBjb25maWd1cmF0aW9uXCIpXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcIlRlc3RUZW5hbnREYXRhYmFzZVBvb2wgcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocG9vbENvbmZpZ3VyYXRpb24udGVuYW50cykgfHwgcG9vbENvbmZpZ3VyYXRpb24udGVuYW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVzdCB0ZW5hbnQgcG9vbCBmb3IgJHtkYXRhYmFzZUlkZW50aWZpZXJ9IHJlcXVpcmVzIGEgbm9uLWVtcHR5IHRlbmFudHMgYXJyYXlgKVxuICAgIH1cblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMucG9vbENvbmZpZ3VyYXRpb24gPSBwb29sQ29uZmlndXJhdGlvblxuICAgIC8qKiBAdHlwZSB7VGVzdFRlbmFudFBvb2xNZW1iZXJbXX0gKi9cbiAgICB0aGlzLm1lbWJlcnMgPSBwb29sQ29uZmlndXJhdGlvbi50ZW5hbnRzLm1hcCgodGVuYW50KSA9PiAoe2xlYXNlZDogZmFsc2UsIHRlbmFudH0pKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgVGVzdFRlbmFudFBvb2xNZW1iZXI+fSAqL1xuICAgIHRoaXMubWVtYmVyc0J5VGVuYW50S2V5ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IG1lbWJlciBvZiB0aGlzLm1lbWJlcnMpIHtcbiAgICAgIHRoaXMubWVtYmVyc0J5VGVuYW50S2V5LnNldChzdGFibGVUZW5hbnRLZXkobWVtYmVyLnRlbmFudCksIG1lbWJlcilcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5wcm92aXNpb25pbmdQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHN0cmluZyB8IG51bGw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RydWN0dXJlU3FsUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuZHJvcHBlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogTnVtYmVyIG9mIHBvb2wgbWVtYmVycy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBQb29sIHNpemUuXG4gICAqL1xuICBzaXplKCkge1xuICAgIHJldHVybiB0aGlzLm1lbWJlcnMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZXMgb25lIHBvb2wgbWVtYmVyIGFzIGEgbGVhc2UuIFRoZSBmaXJzdCBmcmVlIG1lbWJlciBpbiBjb25maWd1cmVkIG9yZGVyIGlzXG4gICAqIHRha2VuOyB3aGVuIGV2ZXJ5IG1lbWJlciBpcyBsZWFzZWQgdGhlIGFjcXVpc2l0aW9uIGZhaWxzIGxvdWRseSBpbnN0ZWFkIG9mIHF1ZXVlaW5nLlxuICAgKiBAcGFyYW0ge3t0ZW5hbnQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IFthcmdzXSAtIE9wdGlvbmFsIGV4cGxpY2l0IHBvb2wgdGVuYW50IHRvIHBpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VGVzdFRlbmFudFBvb2xMZWFzZT59IC0gSGVsZCBsZWFzZTsgcGFzcyBpdCB0byB7QGxpbmsgcmVsZWFzZX0uXG4gICAqL1xuICBhc3luYyBhY3F1aXJlKHt0ZW5hbnR9ID0ge30pIHtcbiAgICBpZiAodGhpcy5kcm9wcGVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlc3QgdGVuYW50IGRhdGFiYXNlIHBvb2wgZm9yICR7dGhpcy5kYXRhYmFzZUlkZW50aWZpZXJ9IHdhcyBhbHJlYWR5IHRvcm4gZG93bmApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQcm92aXNpb25lZCgpXG5cbiAgICAvKiogQHR5cGUge1Rlc3RUZW5hbnRQb29sTWVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBtZW1iZXJcblxuICAgIGlmICh0ZW5hbnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgbWVtYmVyID0gdGhpcy5tZW1iZXJzQnlUZW5hbnRLZXkuZ2V0KHN0YWJsZVRlbmFudEtleSh0ZW5hbnQpKVxuXG4gICAgICBpZiAoIW1lbWJlcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCAke1RlbmFudEl0ZXJhdG9yLnRlbmFudExhYmVsKHRlbmFudCl9IGlzIG5vdCBhIG1lbWJlciBvZiB0aGUgdGVzdCB0ZW5hbnQgcG9vbCBmb3IgJHt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgICAgfVxuICAgICAgaWYgKG1lbWJlci5sZWFzZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZXN0IHRlbmFudCBwb29sIG1lbWJlciAke1RlbmFudEl0ZXJhdG9yLnRlbmFudExhYmVsKHRlbmFudCl9IGZvciAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfSBpcyBhbHJlYWR5IGxlYXNlZGApXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG1lbWJlciA9IHRoaXMubWVtYmVycy5maW5kKChjYW5kaWRhdGUpID0+ICFjYW5kaWRhdGUubGVhc2VkKVxuXG4gICAgICBpZiAoIW1lbWJlcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlc3QgdGVuYW50IGRhdGFiYXNlIHBvb2wgZXhoYXVzdGVkIGZvciAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfSAoc2l6ZSAke3RoaXMubWVtYmVycy5sZW5ndGh9LCBhbGwgbGVhc2VkKS4gUmVsZWFzZSBhIGxlYXNlIGJlZm9yZSBhY3F1aXJpbmcgYW5vdGhlciB0ZW5hbnQuYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZW1iZXIubGVhc2VkID0gdHJ1ZVxuXG4gICAgcmV0dXJuIHtkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyLCBtZW1iZXIsIHRlbmFudDogbWVtYmVyLnRlbmFudH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldHMgYSBsZWFzZWQgbWVtYmVyICh0cnVuY2F0ZSArIGxlZGdlciBiYXNlbGluZSwgb3IgdGhlIGNvbmZpZ3VyZWQgYHJlc2V0VGVuYW50YFxuICAgKiBvdmVycmlkZSkgYW5kIHJldHVybnMgaXQgdG8gdGhlIGZyZWUgcG9vbC4gSWRlbXBvdGVudCBmb3IgYW4gYWxyZWFkeS1mcmVlIG1lbWJlci5cbiAgICogQSBmYWlsZWQgcmVzZXQgaXMgZm9sbG93ZWQgYnkgYSBmdWxsIHJlLXByb3Zpc2lvbiBzbyBhIGNvcnJ1cHRlZCBtZW1iZXIgY2Fubm90IGJlXG4gICAqIGhhbmRlZCB0byB0aGUgbmV4dCB0ZXN0OyBpZiByZS1wcm92aXNpb25pbmcgYWxzbyBmYWlscyB0aGUgbWVtYmVyIHN0YXlzIGxlYXNlZCBhbmRcbiAgICogdGhlIGFnZ3JlZ2F0ZWQgZXJyb3IgaXMgdGhyb3duLlxuICAgKiBAcGFyYW0ge1Rlc3RUZW5hbnRQb29sTGVhc2V9IGxlYXNlIC0gTGVhc2UgcmV0dXJuZWQgYnkge0BsaW5rIGFjcXVpcmV9LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHRoZSBtZW1iZXIgaXMgY2xlYW4gYW5kIGZyZWUgYWdhaW4uXG4gICAqL1xuICBhc3luYyByZWxlYXNlKGxlYXNlKSB7XG4gICAgaWYgKGxlYXNlLmRhdGFiYXNlSWRlbnRpZmllciAhPT0gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTGVhc2UgYmVsb25ncyB0byBwb29sICR7bGVhc2UuZGF0YWJhc2VJZGVudGlmaWVyfSwgbm90ICR7dGhpcy5kYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCBtZW1iZXIgPSBsZWFzZS5tZW1iZXJcblxuICAgIGlmICghbWVtYmVyLmxlYXNlZCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yZXNldE1lbWJlcihtZW1iZXIpXG4gICAgfSBjYXRjaCAocmVzZXRFcnJvcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm92aXNpb25NZW1iZXIobWVtYmVyKVxuICAgICAgfSBjYXRjaCAocHJvdmlzaW9uRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtyZXNldEVycm9yLCBwcm92aXNpb25FcnJvcl0sXG4gICAgICAgICAgYEZhaWxlZCB0byByZXNldCBhbmQgcmUtcHJvdmlzaW9uIHRlc3QgdGVuYW50IHBvb2wgbWVtYmVyICR7VGVuYW50SXRlcmF0b3IudGVuYW50TGFiZWwobWVtYmVyLnRlbmFudCl9IGZvciAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfWAsXG4gICAgICAgICAge2NhdXNlOiBwcm92aXNpb25FcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuICAgIH1cblxuICAgIG1lbWJlci5sZWFzZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIERyb3BzIGV2ZXJ5IHBvb2wgbWVtYmVyJ3MgdGVuYW50IGRhdGFiYXNlIHRocm91Z2ggdGhlIHByb3ZpZGVyJ3MgYGRyb3BEYXRhYmFzZWBcbiAgICogaG9vayAob3IgdGhlIGZyYW1ld29yayBkZWZhdWx0KSBhbmQgY2xvc2VzIHRoZSBwb29sLiBJZGVtcG90ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgbWVtYmVycyB3ZXJlIGRyb3BwZWQuXG4gICAqL1xuICBhc3luYyB0ZWFyZG93bigpIHtcbiAgICBpZiAodGhpcy5kcm9wcGVkKSByZXR1cm5cblxuICAgIHRoaXMuZHJvcHBlZCA9IHRydWVcblxuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IG1lbWJlciBvZiB0aGlzLm1lbWJlcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZHJvcE1lbWJlcihtZW1iZXIpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBgRmFpbGVkIHRvIHRlYXIgZG93biB0aGUgdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbCBmb3IgJHt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcn1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb3Zpc2lvbnMgZXZlcnkgbWVtYmVyIGV4YWN0bHkgb25jZSAoY29uY3VycmVudCBhY3F1aXNpdGlvbnMgc2hhcmUgb25lXG4gICAqIHByb3Zpc2lvbmluZyBwYXNzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbWVtYmVycyBhcmUgcHJvdmlzaW9uZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVQcm92aXNpb25lZCgpIHtcbiAgICB0aGlzLnByb3Zpc2lvbmluZ1Byb21pc2UgPz89IChhc3luYyAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IG1lbWJlciBvZiB0aGlzLm1lbWJlcnMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm92aXNpb25NZW1iZXIobWVtYmVyKVxuICAgICAgfVxuICAgIH0pKClcblxuICAgIGF3YWl0IHRoaXMucHJvdmlzaW9uaW5nUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFByb3Zpc2lvbnMgb25lIG1lbWJlcjogY3JlYXRlcyB0aGUgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlLCB0aGVuIGxvYWRzIG9yIGNsb25lc1xuICAgKiB0aGUgZGVmYXVsdCBkYXRhYmFzZSdzIHN0cnVjdHVyZSBhbmQgYmFzZWxpbmVzIHRoZSBsZWRnZXIuXG4gICAqIEBwYXJhbSB7VGVzdFRlbmFudFBvb2xNZW1iZXJ9IG1lbWJlciAtIFBvb2wgbWVtYmVyIHRvIHByb3Zpc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbWVtYmVyJ3MgdGVuYW50IGRhdGFiYXNlIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgcHJvdmlzaW9uTWVtYmVyKG1lbWJlcikge1xuICAgIGlmICh0eXBlb2YgdGhpcy5wb29sQ29uZmlndXJhdGlvbi5wcm92aXNpb25UZW5hbnQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXdhaXQgdGhpcy5wb29sQ29uZmlndXJhdGlvbi5wcm92aXNpb25UZW5hbnQoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIHRlbmFudDogbWVtYmVyLnRlbmFudFxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jcmVhdGVUZW5hbnREYXRhYmFzZUZvck1lbWJlcihtZW1iZXIpXG5cbiAgICAvLyBUaGUgdGVuYW50RGF0YWJhc2VSZXNvbHZlciByZXdyaXRlcyBldmVyeSBpZGVudGlmaWVyIGluc2lkZSBhIHRlbmFudCBjb250ZXh0XG4gICAgLy8gKGluY2x1ZGluZyBgZGVmYXVsdGApLCBzbyB0aGUgc3RydWN0dXJlL2xlZGdlciBzb3VyY2UgbXVzdCBiZSByZWFkIG91dHNpZGUgdGhlXG4gICAgLy8gdGVuYW50IHNjb3BlIHdoaWxlIHRoZSBtZW1iZXIgaXMgcmVhY2hlZCB0aHJvdWdoIGEgZGVkaWNhdGVkIHBvb2wgY2hlY2tvdXQuXG4gICAgYXdhaXQgdGhpcy53aXRoTWVtYmVyQ29ubmVjdGlvbihtZW1iZXIudGVuYW50LCBhc3luYyAodGVuYW50RGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW1wiZGVmYXVsdFwiXSwgbmFtZTogYFRlc3QgdGVuYW50IHBvb2wgcHJvdmlzaW9uOiAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfWB9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwbHlEZWZhdWx0U3RydWN0dXJlKHsuLi5kYnMsIFt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl06IHRlbmFudERifSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBwaHlzaWNhbCB0ZW5hbnQgZGF0YWJhc2UgdmlhIHRoZSBwcm92aWRlcidzIGBjcmVhdGVEYXRhYmFzZWAgaG9vayBvclxuICAgKiB0aGUgZnJhbWV3b3JrIGRlZmF1bHQgcHJvdmlzaW9uaW5nLlxuICAgKiBAcGFyYW0ge1Rlc3RUZW5hbnRQb29sTWVtYmVyfSBtZW1iZXIgLSBQb29sIG1lbWJlciB3aG9zZSBkYXRhYmFzZSBtdXN0IGV4aXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSB0ZW5hbnQgZGF0YWJhc2UgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGVuYW50RGF0YWJhc2VGb3JNZW1iZXIobWVtYmVyKSB7XG4gICAgY29uc3QgcHJvdmlkZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMoKVt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cbiAgICBjb25zdCBjcmVhdGVEYXRhYmFzZSA9IHByb3ZpZGVyICYmIHR5cGVvZiBwcm92aWRlci5jcmVhdGVEYXRhYmFzZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHByb3ZpZGVyLmNyZWF0ZURhdGFiYXNlLmJpbmQocHJvdmlkZXIpXG4gICAgICA6IGNyZWF0ZVRlbmFudERhdGFiYXNlXG5cbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudChtZW1iZXIudGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZSh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfSBpcyBpbmFjdGl2ZSBmb3IgdGVuYW50OiAke1RlbmFudEl0ZXJhdG9yLnRlbmFudExhYmVsKG1lbWJlci50ZW5hbnQpfWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGNyZWF0ZURhdGFiYXNlKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKSxcbiAgICAgICAgaWRlbnRpZmllcjogdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgIHRlbmFudDogbWVtYmVyLnRlbmFudFxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBjYXB0dXJlZCBkZWZhdWx0LWRhdGFiYXNlIHN0cnVjdHVyZSBpbnRvIHRoZSBjdXJyZW50IHRlbmFudCBjb25uZWN0aW9uXG4gICAqIGFuZCBiYXNlbGluZXMgaXRzIGxlZGdlci4gRHJpdmVycyB3aXRob3V0IGEgc3RydWN0dXJlLVNRTCBnZW5lcmF0b3IgZmFsbCBiYWNrIHRvXG4gICAqIHtAbGluayBTY2hlbWFDbG9uZXJ9IG92ZXIgZXZlcnkgZGVmYXVsdCB0YWJsZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGRicyAtIEFjdGl2ZSBjb25uZWN0aW9ucyAobXVzdCBpbmNsdWRlIGBkZWZhdWx0YCBhbmQgdGhlIHBvb2wgaWRlbnRpZmllcikuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHRlbmFudCBzY2hlbWEgYW5kIGxlZGdlciBhcmUgYmFzZWxpbmVkLlxuICAgKi9cbiAgYXN5bmMgYXBwbHlEZWZhdWx0U3RydWN0dXJlKGRicykge1xuICAgIGNvbnN0IHRlbmFudERiID0gdGhpcy50ZW5hbnRDb25uZWN0aW9uKGRicylcbiAgICBjb25zdCBkZWZhdWx0RGIgPSB0aGlzLmRlZmF1bHRDb25uZWN0aW9uKGRicylcbiAgICBjb25zdCBzdHJ1Y3R1cmVTcWwgPSBhd2FpdCB0aGlzLmNhcHR1cmVkU3RydWN0dXJlU3FsKClcblxuICAgIGlmIChzdHJ1Y3R1cmVTcWwgIT09IG51bGwpIHtcbiAgICAgIGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWxMb2FkZXIoKS5sb2FkKHtkYjogdGVuYW50RGIsIHN0cnVjdHVyZVNxbH0pXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGNsb25lciA9IG5ldyBTY2hlbWFDbG9uZXIoe3NvdXJjZURiOiBkZWZhdWx0RGIsIHRhcmdldERiOiB0ZW5hbnREYn0pXG4gICAgICBjb25zdCB0YWJsZU5hbWVzID0gKGF3YWl0IGRlZmF1bHREYi5nZXRUYWJsZXMoKSlcbiAgICAgICAgLm1hcCgodGFibGUpID0+IHRhYmxlLmdldE5hbWUoKSlcbiAgICAgICAgLmZpbHRlcigodGFibGVOYW1lKSA9PiB0YWJsZU5hbWUgIT09IE1pZ3JhdGlvbnNMZWRnZXIudGFibGVOYW1lKCkpXG5cbiAgICAgIC8vIHN5bmNUYWJsZSAobm90IHN5bmNUYWJsZXMpIHNvIHRoZSBsZWRnZXIgaXMgbmV2ZXIgcmVjb25jaWxlZCBhZ2FpbnN0IGFcbiAgICAgIC8vIGRlZmF1bHQgZGF0YWJhc2UgdGhhdCBoYXMgbm8gbGVkZ2VyIHRhYmxlIHlldDsgYmFzZWxpbmVMZWRnZXIgb3ducyB0aGVcbiAgICAgIC8vIGxlZGdlciBzdGVwIGFuZCBza2lwcyB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgdG8gYmFzZWxpbmUgZnJvbS5cbiAgICAgIGZvciAoY29uc3QgdGFibGVOYW1lIG9mIHRhYmxlTmFtZXMpIHtcbiAgICAgICAgYXdhaXQgY2xvbmVyLnN5bmNUYWJsZSh0YWJsZU5hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5iYXNlbGluZUxlZGdlcih0ZW5hbnREYilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldHMgb25lIG1lbWJlciBiZXR3ZWVuIHRlc3RzOiB0cnVuY2F0ZSBldmVyeSB0ZW5hbnQgdGFibGUgKHRoZSBsZWRnZXIgdGFibGUgaXNcbiAgICogcHJlc2VydmVkIGJ5IGB0cnVuY2F0ZUFsbFRhYmxlc2ApIGFuZCByZS1iYXNlbGluZSB0aGUgbGVkZ2VyIGZyb20gdGhlIGRlZmF1bHRcbiAgICogZGF0YWJhc2UsIHNvIHRoZSBuZXh0IHRlc3Qgc3RhcnRzIGZyb20gdGhlIHNhbWUgc2NoZW1hIHN0YXRlIHdpdGhvdXQgYSBzdHJ1Y3R1cmUgbG9hZC5cbiAgICogQHBhcmFtIHtUZXN0VGVuYW50UG9vbE1lbWJlcn0gbWVtYmVyIC0gTGVhc2VkIG1lbWJlciB0byBjbGVhbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbWVtYmVyIGlzIGVtcHR5IGFuZCBsZWRnZXItY3VycmVudC5cbiAgICovXG4gIGFzeW5jIHJlc2V0TWVtYmVyKG1lbWJlcikge1xuICAgIGlmICh0eXBlb2YgdGhpcy5wb29sQ29uZmlndXJhdGlvbi5yZXNldFRlbmFudCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCB0aGlzLnBvb2xDb25maWd1cmF0aW9uLnJlc2V0VGVuYW50KHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICB0ZW5hbnQ6IG1lbWJlci50ZW5hbnRcbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMud2l0aE1lbWJlckNvbm5lY3Rpb24obWVtYmVyLnRlbmFudCwgYXN5bmMgKHRlbmFudERiKSA9PiB7XG4gICAgICBhd2FpdCB0ZW5hbnREYi50cnVuY2F0ZUFsbFRhYmxlcygpXG4gICAgICBhd2FpdCB0aGlzLmJhc2VsaW5lTGVkZ2VyKHRlbmFudERiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQmFzZWxpbmVzIGEgdGVuYW50IGNvbm5lY3Rpb24ncyBsZWRnZXIgZnJvbSB0aGUgZGVmYXVsdCBkYXRhYmFzZS4gU2tpcHMgd2hlbiB0aGVcbiAgICogZGVmYXVsdCBkYXRhYmFzZSBoYXMgbm8gbGVkZ2VyIHlldCAobm90aGluZyB0byBiYXNlbGluZSBmcm9tKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gdGVuYW50RGIgLSBUZW5hbnQgY29ubmVjdGlvbiB3aG9zZSBsZWRnZXIgaXMgcmVmcmVzaGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBsZWRnZXIgbWF0Y2hlcyB0aGUgZGVmYXVsdCBkYXRhYmFzZS5cbiAgICovXG4gIGFzeW5jIGJhc2VsaW5lTGVkZ2VyKHRlbmFudERiKSB7XG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbXCJkZWZhdWx0XCJdLCBuYW1lOiBgVGVzdCB0ZW5hbnQgcG9vbCBsZWRnZXI6ICR7dGhpcy5kYXRhYmFzZUlkZW50aWZpZXJ9YH0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IGRlZmF1bHREYiA9IHRoaXMuZGVmYXVsdENvbm5lY3Rpb24oZGJzKVxuXG4gICAgICBpZiAoIWF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIudGFibGVFeGlzdHMoZGVmYXVsdERiKSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuYmFzZWxpbmVGcm9tRGF0YWJhc2Uoe3NvdXJjZURiOiBkZWZhdWx0RGIsIHRhcmdldERiOiB0ZW5hbnREYn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyBvbmUgbWVtYmVyJ3MgdGVuYW50IGRhdGFiYXNlIHRocm91Z2ggdGhlIHByb3ZpZGVyJ3MgYGRyb3BEYXRhYmFzZWAgaG9vayBvclxuICAgKiB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuXG4gICAqIEBwYXJhbSB7VGVzdFRlbmFudFBvb2xNZW1iZXJ9IG1lbWJlciAtIFBvb2wgbWVtYmVyIHRvIGRyb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHRlbmFudCBkYXRhYmFzZSBpcyBnb25lLlxuICAgKi9cbiAgYXN5bmMgZHJvcE1lbWJlcihtZW1iZXIpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycygpW3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyXVxuICAgIGNvbnN0IGRyb3BEYXRhYmFzZSA9IHByb3ZpZGVyICYmIHR5cGVvZiBwcm92aWRlci5kcm9wRGF0YWJhc2UgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBwcm92aWRlci5kcm9wRGF0YWJhc2UuYmluZChwcm92aWRlcilcbiAgICAgIDogZHJvcFRlbmFudERhdGFiYXNlXG5cbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudChtZW1iZXIudGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZSh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfSBpcyBpbmFjdGl2ZSBmb3IgdGVuYW50OiAke1RlbmFudEl0ZXJhdG9yLnRlbmFudExhYmVsKG1lbWJlci50ZW5hbnQpfWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGRyb3BEYXRhYmFzZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbih0aGlzLmRhdGFiYXNlSWRlbnRpZmllciksXG4gICAgICAgIGlkZW50aWZpZXI6IHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICB0ZW5hbnQ6IG1lbWJlci50ZW5hbnRcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyB0aGUgZGVmYXVsdCBkYXRhYmFzZSdzIHN0cnVjdHVyZSBTUUwgb25jZSBwZXIgcG9vbCAodGhlIGZyYW1ld29ya1xuICAgKiBnZW5lcmFsaXphdGlvbiBvZiB0aGUgY29uc3VtaW5nIGFwcHMnIGNhcHR1cmVkLXN0cnVjdHVyZSBmYXN0IHBhdGgpLiBSZXR1cm5zIG51bGxcbiAgICogZm9yIGRyaXZlcnMgd2l0aG91dCBhIHN0cnVjdHVyZSBnZW5lcmF0b3IsIHdoaWNoIHNlbGVjdHMgdGhlIFNjaGVtYUNsb25lciBmYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gQ2FwdHVyZWQgc3RydWN0dXJlIFNRTCBvciBudWxsLlxuICAgKi9cbiAgY2FwdHVyZWRTdHJ1Y3R1cmVTcWwoKSB7XG4gICAgdGhpcy5zdHJ1Y3R1cmVTcWxQcm9taXNlID8/PSAoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW1wiZGVmYXVsdFwiXSwgbmFtZTogXCJUZXN0IHRlbmFudCBwb29sIHN0cnVjdHVyZSBjYXB0dXJlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBkYnMuZGVmYXVsdC5zdHJ1Y3R1cmVTcWwoKVxuICAgICAgfSlcbiAgICB9KSgpXG5cbiAgICByZXR1cm4gdGhpcy5zdHJ1Y3R1cmVTcWxQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0ZW5hbnQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGRicyAtIEFjdGl2ZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBwb29sIGlkZW50aWZpZXIncyBjb25uZWN0aW9uLlxuICAgKi9cbiAgdGVuYW50Q29ubmVjdGlvbihkYnMpIHtcbiAgICBjb25zdCB0ZW5hbnREYiA9IGRic1t0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgIGlmICghdGVuYW50RGIpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYSAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfSBjb25uZWN0aW9uIGZvciB0aGUgdGVzdCB0ZW5hbnQgcG9vbGApXG5cbiAgICByZXR1cm4gdGVuYW50RGJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmF1bHQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGRicyAtIEFjdGl2ZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkZWZhdWx0IGNvbm5lY3Rpb24gKGxlZGdlciBiYXNlbGluZSBzb3VyY2UpLlxuICAgKi9cbiAgZGVmYXVsdENvbm5lY3Rpb24oZGJzKSB7XG4gICAgY29uc3QgZGVmYXVsdERiID0gZGJzLmRlZmF1bHRcblxuICAgIGlmICghZGVmYXVsdERiKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGEgZGVmYXVsdCBjb25uZWN0aW9uIGZvciB0aGUgdGVzdCB0ZW5hbnQgcG9vbCBvbiAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfWApXG5cbiAgICByZXR1cm4gZGVmYXVsdERiXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGEgZGVkaWNhdGVkIHBoeXNpY2FsIGNvbm5lY3Rpb24gZm9yIG9uZSBtZW1iZXIuIFRoZSByZXNldCBwYXRoIHRydW5jYXRlc1xuICAgKiBjb21taXR0ZWQgZGF0YSwgc28gaXQgbXVzdCBub3QgcmV1c2UgYSB0ZXN0LXBpbm5lZCBvciBhc3luYy1jb250ZXh0IGNvbm5lY3Rpb24gdGhhdFxuICAgKiBhIGxhdGVyIHJvbGxiYWNrIHdvdWxkIHVuZG8g4oCUIGl0IGNoZWNrcyBvdXQgdGhyb3VnaCB0aGUgcG9vbCBleGFjdGx5IGxpa2VcbiAgICogYHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudGAgZG9lcyBhbmQgcmVsZWFzZXMgdGhlIGNvbm5lY3Rpb24gYmFjayB0byB0aGUgcG9vbC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gUG9vbCBtZW1iZXIgdGVuYW50IGRlc2NyaXB0b3IuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gb24gdGhlIGRlZGljYXRlZCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoTWVtYmVyQ29ubmVjdGlvbih0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24odGhpcy5kYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLnRlbmFudE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVzdCB0ZW5hbnQgcG9vbCByZXF1aXJlcyBhIHRlbmFudE9ubHkgZGF0YWJhc2U6ICR7dGhpcy5kYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgcG9vbC5jaGVja291dEZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZTogYFRlc3QgdGVuYW50IHBvb2wgbWVtYmVyOiAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfWB9KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhjb25uZWN0aW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBwb29sLmNoZWNraW4oY29ubmVjdGlvbilcbiAgICB9XG4gIH1cbn1cbiJdfQ==