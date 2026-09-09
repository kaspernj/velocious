// @ts-check
import Current from "../current.js";
import { dropTenantDatabase } from "./default-tenant-database-provisioning.js";
import TenantAggregator from "./tenant-aggregator.js";
import TenantHandle from "./tenant-handle.js";
import TenantIterator from "./tenant-iterator.js";
/**
 * Apartment-style runtime façade for multi-tenant apps. A "tenant" is whatever descriptor
 * object the app's `tenantDatabaseResolver` understands (an account, a project, …); this
 * class is the single discoverable home for switching into a tenant's context, reading the
 * current one, iterating every tenant of a database identifier, and dropping a tenant's
 * database. Switching delegates to {@link Current} (which owns the async-context tenant
 * state) and additionally runs the callback inside `ensureConnections`, initializing registered
 * tenant-switched models whose tables exist before the callback runs. Entering a tenant therefore
 * makes its database immediately queryable — the apartment-style "switch" semantics — without
 * the caller establishing connections or model metadata itself; iteration and drop drive the
 * app's tenant database provider hooks.
 */
export default class Tenant {
    /**
     * Captures an immutable tenant/database handle for explicit browser/native
     * ORM operations. Physical database configurations are resolved now and are
     * never recomputed from later ambient tenant changes.
     * @param {object} tenant - Ordinary or null-prototype JSON-compatible descriptor understood by the app's tenant database resolver.
     * @param {import("../configuration.js").default} [configuration] - Owning configuration.
     * @returns {TenantHandle} - Immutable captured handle.
     */
    static handle(tenant, configuration = Current.configuration()) {
        return new TenantHandle({ configuration, tenant });
    }
    /**
     * Runs `callback` with `tenant` as the current tenant, restoring the previous tenant after.
     * The callback runs inside `ensureConnections`, so every database identifier the tenant
     * activates (the global database plus the tenant's database) has a checked-out connection
     * available for the callback's duration. Registered tenant-switched models whose tables exist
     * are initialized before the callback runs, so switching into a tenant makes it queryable
     * without the caller wiring up connections or model metadata. Already-checked-out connections
     * and in-progress model initialization promises are reused. The callback receives the active
     * connections keyed by identifier, the same as `ensureConnections`.
     * @template T
     * @param {object} tenant Descriptor understood by the app's tenantDatabaseResolver.
     * @param {(connections: Record<string, import("../database/drivers/base.js").default>) => Promise<T>} callback - Operation to run with the tenant's active connections.
     * @returns {Promise<T>} - Callback result from within the tenant context.
     */
    static async with(tenant, callback) {
        const configuration = Current.configuration();
        return await Current.withTenant(tenant, async () => await configuration.ensureConnections(async (connections) => {
            await this._ensureCurrentTenantModelsInitialized(configuration);
            return await callback(connections);
        }));
    }
    /**
     * Initializes registered tenant-switched models whose tables exist in the
     * current tenant before runtime callbacks can build synchronous query scopes.
     * Models for absent optional tables remain deferred until they are used.
     * @param {import("../configuration.js").default} configuration - Current configuration.
     * @returns {Promise<void>} - Resolves when available tenant models are initialized.
     */
    static async _ensureCurrentTenantModelsInitialized(configuration) {
        for (const modelClass of Object.values(configuration.getModelClasses())) {
            if (modelClass.isInitialized() || !modelClass.hasTenantDatabaseIdentifierResolver())
                continue;
            const databaseIdentifier = modelClass.getTenantDatabaseIdentifier();
            if (!databaseIdentifier || !configuration.isDatabaseIdentifierActive(databaseIdentifier))
                continue;
            const connection = modelClass.connection();
            const table = await connection.getTableByName(modelClass.tableName(), { throwError: false });
            if (!table)
                continue;
            if (Object.keys(modelClass.getTranslationsMap()).length > 0) {
                const translationsTable = await connection.getTableByName(modelClass.getTranslationsTableName(), { throwError: false });
                if (!translationsTable)
                    continue;
            }
            await modelClass.ensureInitialized({ configuration });
        }
    }
    /**
     * The current tenant descriptor, or undefined when running outside any tenant context.
     * @returns {Record<string, unknown> | undefined} - Current async-context tenant descriptor, if any.
     */
    static current() {
        return Current.tenant();
    }
    /**
     * Lists the tenants for a database identifier through the provider and runs `callback`
     * within each tenant's context, optionally filtered and several at a time. Like
     * {@link Tenant.with}, the callback runs inside `ensureConnections` after available
     * tenant-switched models are initialized, so each tenant's database is queryable without the
     * caller wiring up connections or model metadata. Returns how many tenants the callback ran
     * for (after filtering).
     * @param {{identifier: string, callback: (args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>, parallel?: number, filter?: (tenant: ReturnType<typeof JSON.parse>) => boolean, configuration?: import("../configuration.js").default}} args - Tenant database identifier, per-tenant operation, filtering, and concurrency settings.
     * @returns {Promise<number>} - Number of processed tenants.
     */
    static async each({ identifier, callback, parallel = 1, filter, configuration = Current.configuration() }) {
        const provider = configuration.getTenantDatabaseProvider(identifier);
        const listedTenants = await configuration.ensureConnections({ name: `Tenant.each: ${identifier}` }, async () => {
            return await provider.listTenants({ configuration, identifier });
        });
        if (!Array.isArray(listedTenants)) {
            throw new Error(`Tenant database provider for ${identifier} must return an array from listTenants`);
        }
        const tenants = filter ? listedTenants.filter(filter) : listedTenants;
        const iterator = new TenantIterator({ configuration, identifier, parallelCount: parallel });
        // Run each tenant's callback inside ensureConnections so the iterator stays
        // connection-agnostic (the db:tenants:* CLI commands share TenantIterator and must run
        // their callbacks, such as create, before the tenant database exists) while runtime
        // iteration here gets the tenant's connections established the same way Tenant.with does.
        return await iterator.run(tenants, async (callbackArgs) => {
            await configuration.ensureConnections({ name: `Tenant.each: ${identifier}` }, async () => {
                await this._ensureCurrentTenantModelsInitialized(configuration);
                await callback(callbackArgs);
            });
        });
    }
    /**
     * Runs one aggregate query across many tenant databases and returns the merged result. The
     * tenants may be co-located on the default server or spread across other servers, and can be
     * created or dropped at runtime; the live tenant list is resolved (from `tenants` or the
     * provider's `listTenants`), grouped by server, aggregated with a single cross-database
     * `UNION ALL` where the driver supports it (MySQL/MSSQL) or one query per tenant otherwise
     * (PostgreSQL/SQLite), and merged with each aggregate's own operation. The caller writes only one
     * per-tenant subquery and declares the key columns and aggregates; see
     * {@link import("./tenant-aggregator.js").TenantAggregateOptions}.
     * @param {import("./tenant-aggregator.js").TenantAggregateOptions} options - Aggregate configuration.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - One merged row per distinct key-column combination.
     */
    static async aggregateAcross(options) {
        return await new TenantAggregator(options).run();
    }
    /**
     * Drops one tenant's database/schema through the provider's `dropDatabase` hook.
     * @param {{identifier: string, tenant: object, configuration?: import("../configuration.js").default}} args - Tenant descriptor and database identifier to drop.
     * @returns {Promise<void>}
     */
    static async drop({ identifier, tenant, configuration = Current.configuration() }) {
        const provider = configuration.getTenantDatabaseProvider(identifier);
        const dropDatabase = typeof provider.dropDatabase === "function"
            ? provider.dropDatabase.bind(provider)
            : dropTenantDatabase;
        await configuration.runWithTenant(tenant, async () => {
            // Guard against an unresolved tenant. resolveDatabaseConfiguration falls back to the
            // base (template/default) tenant database when the resolver returns nothing for this
            // descriptor, so without this check a provider that drops by databaseConfiguration.name
            // would drop the template database instead of rejecting the bad tenant.
            if (!configuration.isDatabaseIdentifierActive(identifier)) {
                throw new Error(`Tenant database identifier ${identifier} is inactive for tenant: ${TenantIterator.tenantLabel(tenant)}`);
            }
            await dropDatabase({
                configuration,
                databaseConfiguration: configuration.resolveDatabaseConfiguration(identifier),
                identifier,
                tenant
            });
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuYW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3RlbmFudHMvdGVuYW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE9BQU8sTUFBTSxlQUFlLENBQUE7QUFDbkMsT0FBTyxFQUFDLGtCQUFrQixFQUFDLE1BQU0sMkNBQTJDLENBQUE7QUFDNUUsT0FBTyxnQkFBZ0IsTUFBTSx3QkFBd0IsQ0FBQTtBQUNyRCxPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUM3QyxPQUFPLGNBQWMsTUFBTSxzQkFBc0IsQ0FBQTtBQUVqRDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sTUFBTTtJQUN6Qjs7Ozs7OztPQU9HO0lBQ0gsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLEVBQUU7UUFDM0QsT0FBTyxJQUFJLFlBQVksQ0FBQyxFQUFDLGFBQWEsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO0lBQ2xELENBQUM7SUFFRDs7Ozs7Ozs7Ozs7OztPQWFHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVE7UUFDaEMsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBRTdDLE9BQU8sTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sYUFBYSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxXQUFXLEVBQUUsRUFBRTtZQUM5RyxNQUFNLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxhQUFhLENBQUMsQ0FBQTtZQUUvRCxPQUFPLE1BQU0sUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDTCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLEtB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LGFBQWEsQ0FBQyw0QkFBNEIsQ0FBQyxVQUFVLENBQUM7Z0JBQzdFLFVBQVU7Z0JBQ1YsTUFBTTthQUNQLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBDdXJyZW50IGZyb20gXCIuLi9jdXJyZW50LmpzXCJcbmltcG9ydCB7ZHJvcFRlbmFudERhdGFiYXNlfSBmcm9tIFwiLi9kZWZhdWx0LXRlbmFudC1kYXRhYmFzZS1wcm92aXNpb25pbmcuanNcIlxuaW1wb3J0IFRlbmFudEFnZ3JlZ2F0b3IgZnJvbSBcIi4vdGVuYW50LWFnZ3JlZ2F0b3IuanNcIlxuaW1wb3J0IFRlbmFudEhhbmRsZSBmcm9tIFwiLi90ZW5hbnQtaGFuZGxlLmpzXCJcbmltcG9ydCBUZW5hbnRJdGVyYXRvciBmcm9tIFwiLi90ZW5hbnQtaXRlcmF0b3IuanNcIlxuXG4vKipcbiAqIEFwYXJ0bWVudC1zdHlsZSBydW50aW1lIGZhw6dhZGUgZm9yIG11bHRpLXRlbmFudCBhcHBzLiBBIFwidGVuYW50XCIgaXMgd2hhdGV2ZXIgZGVzY3JpcHRvclxuICogb2JqZWN0IHRoZSBhcHAncyBgdGVuYW50RGF0YWJhc2VSZXNvbHZlcmAgdW5kZXJzdGFuZHMgKGFuIGFjY291bnQsIGEgcHJvamVjdCwg4oCmKTsgdGhpc1xuICogY2xhc3MgaXMgdGhlIHNpbmdsZSBkaXNjb3ZlcmFibGUgaG9tZSBmb3Igc3dpdGNoaW5nIGludG8gYSB0ZW5hbnQncyBjb250ZXh0LCByZWFkaW5nIHRoZVxuICogY3VycmVudCBvbmUsIGl0ZXJhdGluZyBldmVyeSB0ZW5hbnQgb2YgYSBkYXRhYmFzZSBpZGVudGlmaWVyLCBhbmQgZHJvcHBpbmcgYSB0ZW5hbnQnc1xuICogZGF0YWJhc2UuIFN3aXRjaGluZyBkZWxlZ2F0ZXMgdG8ge0BsaW5rIEN1cnJlbnR9ICh3aGljaCBvd25zIHRoZSBhc3luYy1jb250ZXh0IHRlbmFudFxuICogc3RhdGUpIGFuZCBhZGRpdGlvbmFsbHkgcnVucyB0aGUgY2FsbGJhY2sgaW5zaWRlIGBlbnN1cmVDb25uZWN0aW9uc2AsIGluaXRpYWxpemluZyByZWdpc3RlcmVkXG4gKiB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHdob3NlIHRhYmxlcyBleGlzdCBiZWZvcmUgdGhlIGNhbGxiYWNrIHJ1bnMuIEVudGVyaW5nIGEgdGVuYW50IHRoZXJlZm9yZVxuICogbWFrZXMgaXRzIGRhdGFiYXNlIGltbWVkaWF0ZWx5IHF1ZXJ5YWJsZSDigJQgdGhlIGFwYXJ0bWVudC1zdHlsZSBcInN3aXRjaFwiIHNlbWFudGljcyDigJQgd2l0aG91dFxuICogdGhlIGNhbGxlciBlc3RhYmxpc2hpbmcgY29ubmVjdGlvbnMgb3IgbW9kZWwgbWV0YWRhdGEgaXRzZWxmOyBpdGVyYXRpb24gYW5kIGRyb3AgZHJpdmUgdGhlXG4gKiBhcHAncyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgaG9va3MuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlbmFudCB7XG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhbiBpbW11dGFibGUgdGVuYW50L2RhdGFiYXNlIGhhbmRsZSBmb3IgZXhwbGljaXQgYnJvd3Nlci9uYXRpdmVcbiAgICogT1JNIG9wZXJhdGlvbnMuIFBoeXNpY2FsIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25zIGFyZSByZXNvbHZlZCBub3cgYW5kIGFyZVxuICAgKiBuZXZlciByZWNvbXB1dGVkIGZyb20gbGF0ZXIgYW1iaWVudCB0ZW5hbnQgY2hhbmdlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IHRlbmFudCAtIE9yZGluYXJ5IG9yIG51bGwtcHJvdG90eXBlIEpTT04tY29tcGF0aWJsZSBkZXNjcmlwdG9yIHVuZGVyc3Rvb2QgYnkgdGhlIGFwcCdzIHRlbmFudCBkYXRhYmFzZSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7VGVuYW50SGFuZGxlfSAtIEltbXV0YWJsZSBjYXB0dXJlZCBoYW5kbGUuXG4gICAqL1xuICBzdGF0aWMgaGFuZGxlKHRlbmFudCwgY29uZmlndXJhdGlvbiA9IEN1cnJlbnQuY29uZmlndXJhdGlvbigpKSB7XG4gICAgcmV0dXJuIG5ldyBUZW5hbnRIYW5kbGUoe2NvbmZpZ3VyYXRpb24sIHRlbmFudH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBgY2FsbGJhY2tgIHdpdGggYHRlbmFudGAgYXMgdGhlIGN1cnJlbnQgdGVuYW50LCByZXN0b3JpbmcgdGhlIHByZXZpb3VzIHRlbmFudCBhZnRlci5cbiAgICogVGhlIGNhbGxiYWNrIHJ1bnMgaW5zaWRlIGBlbnN1cmVDb25uZWN0aW9uc2AsIHNvIGV2ZXJ5IGRhdGFiYXNlIGlkZW50aWZpZXIgdGhlIHRlbmFudFxuICAgKiBhY3RpdmF0ZXMgKHRoZSBnbG9iYWwgZGF0YWJhc2UgcGx1cyB0aGUgdGVuYW50J3MgZGF0YWJhc2UpIGhhcyBhIGNoZWNrZWQtb3V0IGNvbm5lY3Rpb25cbiAgICogYXZhaWxhYmxlIGZvciB0aGUgY2FsbGJhY2sncyBkdXJhdGlvbi4gUmVnaXN0ZXJlZCB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHdob3NlIHRhYmxlcyBleGlzdFxuICAgKiBhcmUgaW5pdGlhbGl6ZWQgYmVmb3JlIHRoZSBjYWxsYmFjayBydW5zLCBzbyBzd2l0Y2hpbmcgaW50byBhIHRlbmFudCBtYWtlcyBpdCBxdWVyeWFibGVcbiAgICogd2l0aG91dCB0aGUgY2FsbGVyIHdpcmluZyB1cCBjb25uZWN0aW9ucyBvciBtb2RlbCBtZXRhZGF0YS4gQWxyZWFkeS1jaGVja2VkLW91dCBjb25uZWN0aW9uc1xuICAgKiBhbmQgaW4tcHJvZ3Jlc3MgbW9kZWwgaW5pdGlhbGl6YXRpb24gcHJvbWlzZXMgYXJlIHJldXNlZC4gVGhlIGNhbGxiYWNrIHJlY2VpdmVzIHRoZSBhY3RpdmVcbiAgICogY29ubmVjdGlvbnMga2V5ZWQgYnkgaWRlbnRpZmllciwgdGhlIHNhbWUgYXMgYGVuc3VyZUNvbm5lY3Rpb25zYC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtvYmplY3R9IHRlbmFudCBEZXNjcmlwdG9yIHVuZGVyc3Rvb2QgYnkgdGhlIGFwcCdzIHRlbmFudERhdGFiYXNlUmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb25zOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIHRvIHJ1biB3aXRoIHRoZSB0ZW5hbnQncyBhY3RpdmUgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdCBmcm9tIHdpdGhpbiB0aGUgdGVuYW50IGNvbnRleHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IEN1cnJlbnQuY29uZmlndXJhdGlvbigpXG5cbiAgICByZXR1cm4gYXdhaXQgQ3VycmVudC53aXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyhhc3luYyAoY29ubmVjdGlvbnMpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUN1cnJlbnRUZW5hbnRNb2RlbHNJbml0aWFsaXplZChjb25maWd1cmF0aW9uKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbnMpXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZXMgcmVnaXN0ZXJlZCB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIHdob3NlIHRhYmxlcyBleGlzdCBpbiB0aGVcbiAgICogY3VycmVudCB0ZW5hbnQgYmVmb3JlIHJ1bnRpbWUgY2FsbGJhY2tzIGNhbiBidWlsZCBzeW5jaHJvbm91cyBxdWVyeSBzY29wZXMuXG4gICAqIE1vZGVscyBmb3IgYWJzZW50IG9wdGlvbmFsIHRhYmxlcyByZW1haW4gZGVmZXJyZWQgdW50aWwgdGhleSBhcmUgdXNlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXZhaWxhYmxlIHRlbmFudCBtb2RlbHMgYXJlIGluaXRpYWxpemVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIF9lbnN1cmVDdXJyZW50VGVuYW50TW9kZWxzSW5pdGlhbGl6ZWQoY29uZmlndXJhdGlvbikge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBPYmplY3QudmFsdWVzKGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKCkpKSB7XG4gICAgICBpZiAobW9kZWxDbGFzcy5pc0luaXRpYWxpemVkKCkgfHwgIW1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkgY29udGludWVcblxuICAgICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIoKVxuXG4gICAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllciB8fCAhY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShkYXRhYmFzZUlkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gbW9kZWxDbGFzcy5jb25uZWN0aW9uKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgY29ubmVjdGlvbi5nZXRUYWJsZUJ5TmFtZShtb2RlbENsYXNzLnRhYmxlTmFtZSgpLCB7dGhyb3dFcnJvcjogZmFsc2V9KVxuXG4gICAgICBpZiAoIXRhYmxlKSBjb250aW51ZVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMobW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbnNNYXAoKSkubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCB0cmFuc2xhdGlvbnNUYWJsZSA9IGF3YWl0IGNvbm5lY3Rpb24uZ2V0VGFibGVCeU5hbWUobW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSwge3Rocm93RXJyb3I6IGZhbHNlfSlcblxuICAgICAgICBpZiAoIXRyYW5zbGF0aW9uc1RhYmxlKSBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtb2RlbENsYXNzLmVuc3VyZUluaXRpYWxpemVkKHtjb25maWd1cmF0aW9ufSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhlIGN1cnJlbnQgdGVuYW50IGRlc2NyaXB0b3IsIG9yIHVuZGVmaW5lZCB3aGVuIHJ1bm5pbmcgb3V0c2lkZSBhbnkgdGVuYW50IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFzeW5jLWNvbnRleHQgdGVuYW50IGRlc2NyaXB0b3IsIGlmIGFueS5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiBDdXJyZW50LnRlbmFudCgpXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgdGhlIHRlbmFudHMgZm9yIGEgZGF0YWJhc2UgaWRlbnRpZmllciB0aHJvdWdoIHRoZSBwcm92aWRlciBhbmQgcnVucyBgY2FsbGJhY2tgXG4gICAqIHdpdGhpbiBlYWNoIHRlbmFudCdzIGNvbnRleHQsIG9wdGlvbmFsbHkgZmlsdGVyZWQgYW5kIHNldmVyYWwgYXQgYSB0aW1lLiBMaWtlXG4gICAqIHtAbGluayBUZW5hbnQud2l0aH0sIHRoZSBjYWxsYmFjayBydW5zIGluc2lkZSBgZW5zdXJlQ29ubmVjdGlvbnNgIGFmdGVyIGF2YWlsYWJsZVxuICAgKiB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIGFyZSBpbml0aWFsaXplZCwgc28gZWFjaCB0ZW5hbnQncyBkYXRhYmFzZSBpcyBxdWVyeWFibGUgd2l0aG91dCB0aGVcbiAgICogY2FsbGVyIHdpcmluZyB1cCBjb25uZWN0aW9ucyBvciBtb2RlbCBtZXRhZGF0YS4gUmV0dXJucyBob3cgbWFueSB0ZW5hbnRzIHRoZSBjYWxsYmFjayByYW5cbiAgICogZm9yIChhZnRlciBmaWx0ZXJpbmcpLlxuICAgKiBAcGFyYW0ge3tpZGVudGlmaWVyOiBzdHJpbmcsIGNhbGxiYWNrOiAoYXJnczoge2RhdGFiYXNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCB0ZW5hbnQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUHJvbWlzZTx2b2lkPiwgcGFyYWxsZWw/OiBudW1iZXIsIGZpbHRlcj86ICh0ZW5hbnQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBib29sZWFuLCBjb25maWd1cmF0aW9uPzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLCBwZXItdGVuYW50IG9wZXJhdGlvbiwgZmlsdGVyaW5nLCBhbmQgY29uY3VycmVuY3kgc2V0dGluZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIHByb2Nlc3NlZCB0ZW5hbnRzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGVhY2goe2lkZW50aWZpZXIsIGNhbGxiYWNrLCBwYXJhbGxlbCA9IDEsIGZpbHRlciwgY29uZmlndXJhdGlvbiA9IEN1cnJlbnQuY29uZmlndXJhdGlvbigpfSkge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gY29uZmlndXJhdGlvbi5nZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVyKGlkZW50aWZpZXIpXG4gICAgY29uc3QgbGlzdGVkVGVuYW50cyA9IGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGBUZW5hbnQuZWFjaDogJHtpZGVudGlmaWVyfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvdmlkZXIubGlzdFRlbmFudHMoe2NvbmZpZ3VyYXRpb24sIGlkZW50aWZpZXJ9KVxuICAgIH0pXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobGlzdGVkVGVuYW50cykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGZvciAke2lkZW50aWZpZXJ9IG11c3QgcmV0dXJuIGFuIGFycmF5IGZyb20gbGlzdFRlbmFudHNgKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudHMgPSBmaWx0ZXIgPyBsaXN0ZWRUZW5hbnRzLmZpbHRlcihmaWx0ZXIpIDogbGlzdGVkVGVuYW50c1xuICAgIGNvbnN0IGl0ZXJhdG9yID0gbmV3IFRlbmFudEl0ZXJhdG9yKHtjb25maWd1cmF0aW9uLCBpZGVudGlmaWVyLCBwYXJhbGxlbENvdW50OiBwYXJhbGxlbH0pXG5cbiAgICAvLyBSdW4gZWFjaCB0ZW5hbnQncyBjYWxsYmFjayBpbnNpZGUgZW5zdXJlQ29ubmVjdGlvbnMgc28gdGhlIGl0ZXJhdG9yIHN0YXlzXG4gICAgLy8gY29ubmVjdGlvbi1hZ25vc3RpYyAodGhlIGRiOnRlbmFudHM6KiBDTEkgY29tbWFuZHMgc2hhcmUgVGVuYW50SXRlcmF0b3IgYW5kIG11c3QgcnVuXG4gICAgLy8gdGhlaXIgY2FsbGJhY2tzLCBzdWNoIGFzIGNyZWF0ZSwgYmVmb3JlIHRoZSB0ZW5hbnQgZGF0YWJhc2UgZXhpc3RzKSB3aGlsZSBydW50aW1lXG4gICAgLy8gaXRlcmF0aW9uIGhlcmUgZ2V0cyB0aGUgdGVuYW50J3MgY29ubmVjdGlvbnMgZXN0YWJsaXNoZWQgdGhlIHNhbWUgd2F5IFRlbmFudC53aXRoIGRvZXMuXG4gICAgcmV0dXJuIGF3YWl0IGl0ZXJhdG9yLnJ1bih0ZW5hbnRzLCBhc3luYyAoY2FsbGJhY2tBcmdzKSA9PiB7XG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgVGVuYW50LmVhY2g6ICR7aWRlbnRpZmllcn1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDdXJyZW50VGVuYW50TW9kZWxzSW5pdGlhbGl6ZWQoY29uZmlndXJhdGlvbilcbiAgICAgICAgYXdhaXQgY2FsbGJhY2soY2FsbGJhY2tBcmdzKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGFnZ3JlZ2F0ZSBxdWVyeSBhY3Jvc3MgbWFueSB0ZW5hbnQgZGF0YWJhc2VzIGFuZCByZXR1cm5zIHRoZSBtZXJnZWQgcmVzdWx0LiBUaGVcbiAgICogdGVuYW50cyBtYXkgYmUgY28tbG9jYXRlZCBvbiB0aGUgZGVmYXVsdCBzZXJ2ZXIgb3Igc3ByZWFkIGFjcm9zcyBvdGhlciBzZXJ2ZXJzLCBhbmQgY2FuIGJlXG4gICAqIGNyZWF0ZWQgb3IgZHJvcHBlZCBhdCBydW50aW1lOyB0aGUgbGl2ZSB0ZW5hbnQgbGlzdCBpcyByZXNvbHZlZCAoZnJvbSBgdGVuYW50c2Agb3IgdGhlXG4gICAqIHByb3ZpZGVyJ3MgYGxpc3RUZW5hbnRzYCksIGdyb3VwZWQgYnkgc2VydmVyLCBhZ2dyZWdhdGVkIHdpdGggYSBzaW5nbGUgY3Jvc3MtZGF0YWJhc2VcbiAgICogYFVOSU9OIEFMTGAgd2hlcmUgdGhlIGRyaXZlciBzdXBwb3J0cyBpdCAoTXlTUUwvTVNTUUwpIG9yIG9uZSBxdWVyeSBwZXIgdGVuYW50IG90aGVyd2lzZVxuICAgKiAoUG9zdGdyZVNRTC9TUUxpdGUpLCBhbmQgbWVyZ2VkIHdpdGggZWFjaCBhZ2dyZWdhdGUncyBvd24gb3BlcmF0aW9uLiBUaGUgY2FsbGVyIHdyaXRlcyBvbmx5IG9uZVxuICAgKiBwZXItdGVuYW50IHN1YnF1ZXJ5IGFuZCBkZWNsYXJlcyB0aGUga2V5IGNvbHVtbnMgYW5kIGFnZ3JlZ2F0ZXM7IHNlZVxuICAgKiB7QGxpbmsgaW1wb3J0KFwiLi90ZW5hbnQtYWdncmVnYXRvci5qc1wiKS5UZW5hbnRBZ2dyZWdhdGVPcHRpb25zfS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3RlbmFudC1hZ2dyZWdhdG9yLmpzXCIpLlRlbmFudEFnZ3JlZ2F0ZU9wdGlvbnN9IG9wdGlvbnMgLSBBZ2dyZWdhdGUgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gT25lIG1lcmdlZCByb3cgcGVyIGRpc3RpbmN0IGtleS1jb2x1bW4gY29tYmluYXRpb24uXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgYWdncmVnYXRlQWNyb3NzKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgbmV3IFRlbmFudEFnZ3JlZ2F0b3Iob3B0aW9ucykucnVuKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyBvbmUgdGVuYW50J3MgZGF0YWJhc2Uvc2NoZW1hIHRocm91Z2ggdGhlIHByb3ZpZGVyJ3MgYGRyb3BEYXRhYmFzZWAgaG9vay5cbiAgICogQHBhcmFtIHt7aWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdCwgY29uZmlndXJhdGlvbj86IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19IGFyZ3MgLSBUZW5hbnQgZGVzY3JpcHRvciBhbmQgZGF0YWJhc2UgaWRlbnRpZmllciB0byBkcm9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyBkcm9wKHtpZGVudGlmaWVyLCB0ZW5hbnQsIGNvbmZpZ3VyYXRpb24gPSBDdXJyZW50LmNvbmZpZ3VyYXRpb24oKX0pIHtcbiAgICBjb25zdCBwcm92aWRlciA9IGNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcihpZGVudGlmaWVyKVxuICAgIGNvbnN0IGRyb3BEYXRhYmFzZSA9IHR5cGVvZiBwcm92aWRlci5kcm9wRGF0YWJhc2UgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBwcm92aWRlci5kcm9wRGF0YWJhc2UuYmluZChwcm92aWRlcilcbiAgICAgIDogZHJvcFRlbmFudERhdGFiYXNlXG5cbiAgICBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHdWFyZCBhZ2FpbnN0IGFuIHVucmVzb2x2ZWQgdGVuYW50LiByZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uIGZhbGxzIGJhY2sgdG8gdGhlXG4gICAgICAvLyBiYXNlICh0ZW1wbGF0ZS9kZWZhdWx0KSB0ZW5hbnQgZGF0YWJhc2Ugd2hlbiB0aGUgcmVzb2x2ZXIgcmV0dXJucyBub3RoaW5nIGZvciB0aGlzXG4gICAgICAvLyBkZXNjcmlwdG9yLCBzbyB3aXRob3V0IHRoaXMgY2hlY2sgYSBwcm92aWRlciB0aGF0IGRyb3BzIGJ5IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5uYW1lXG4gICAgICAvLyB3b3VsZCBkcm9wIHRoZSB0ZW1wbGF0ZSBkYXRhYmFzZSBpbnN0ZWFkIG9mIHJlamVjdGluZyB0aGUgYmFkIHRlbmFudC5cbiAgICAgIGlmICghY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7aWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgZm9yIHRlbmFudDogJHtUZW5hbnRJdGVyYXRvci50ZW5hbnRMYWJlbCh0ZW5hbnQpfWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGRyb3BEYXRhYmFzZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbjogY29uZmlndXJhdGlvbi5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGlkZW50aWZpZXIpLFxuICAgICAgICBpZGVudGlmaWVyLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxufVxuIl19