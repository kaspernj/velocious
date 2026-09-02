// @ts-check
import Current from "../current.js";
/**
 * @typedef {"SUM" | "COUNT" | "MAX" | "MIN"} AggregateOperation
 */
/**
 * @typedef {AggregateOperation | {op: AggregateOperation, column: string}} AggregateSpec
 */
/**
 * @typedef {object} SubqueryContext
 * @property {(tableName: string) => string} table - Quotes a table for this tenant. In a cross-database `UNION ALL` it returns a `database`.`table` qualified identifier; when each tenant runs on its own connection it returns the plain quoted table name. Use it for every table the subquery reads so the same subquery works on both execution paths.
 * @property {((value: ReturnType<typeof JSON.parse>) => string) & {list: (values: Array<ReturnType<typeof JSON.parse>>) => string}} quote - Quotes a value for the active connection. `quote.list(values)` quotes and comma-joins an array for `IN (...)` clauses.
 * @property {object} tenant - The tenant descriptor this subquery is being built for.
 * @property {import("../database/drivers/base.js").default} connection - The driver the query will run on.
 */
/**
 * @typedef {object} TenantAggregateOptions
 * @property {string} identifier - Database identifier whose tenants are aggregated (for example `"projectTenant"`).
 * @property {object[]} [tenants] - Explicit tenant descriptors to aggregate. Defaults to every tenant the identifier's provider `listTenants` returns.
 * @property {(tenant: ReturnType<typeof JSON.parse>) => boolean} [filter] - Optional filter applied to the resolved tenant list.
 * @property {string[]} [keyColumns] - Columns the aggregate is grouped by (for example `["docker_server_id"]`). Empty means a single grand-total row.
 * @property {Record<string, AggregateSpec>} aggregates - Output column name to aggregate. `"SUM"` is shorthand for `{op: "SUM", column: <output name>}`; use `{op: "COUNT", column: "*"}` for `COUNT(*)`.
 * @property {AbortSignal} [signal] - Signal passed to each aggregate database query.
 * @property {(context: SubqueryContext) => string} subquery - Builds one tenant's inner `SELECT`, which must select every `keyColumns` entry plus every aggregate source column.
 * @property {import("../configuration.js").default} [configuration] - Configuration to run against. Defaults to the current configuration.
 */
/**
 * @typedef {{tenant: object, database: string | undefined, serverKey: string}} ResolvedTenant
 */
const AGGREGATE_OPERATIONS = new Set(["SUM", "COUNT", "MAX", "MIN"]);
const DERIVED_TABLE_ALIAS = "velocious_tenant_aggregate";
/**
 * Runs one aggregate query across many tenant databases and merges the result. Tenant databases may
 * be co-located on the default server or spread across other servers, and they can appear or
 * disappear at runtime; this resolves the live tenant list, groups tenants by the server they live
 * on, and — per server — emits a single cross-database `UNION ALL` when the driver supports qualified
 * cross-database references (MySQL/MSSQL) or falls back to one query per tenant otherwise
 * (PostgreSQL/SQLite). Results from every server are merged with the aggregate's own operation, so
 * callers get one combined result set regardless of how the tenants are distributed. Reached through
 * `Tenant.aggregateAcross`.
 */
export default class TenantAggregator {
    /**
     * Prepares an aggregate run, normalizing the aggregate specs up front.
     * @param {TenantAggregateOptions} options - Aggregate configuration.
     */
    constructor(options) {
        this.options = options;
        this.configuration = options.configuration ?? Current.configuration();
        this.keyColumns = options.keyColumns ?? [];
        this.aggregates = this._normalizeAggregates(options.aggregates);
    }
    /**
     * Resolves the tenant list, runs the aggregate per server, and merges everything.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - One merged row per distinct key-column combination.
     */
    async run() {
        const resolvedTenants = await this._resolveTenants();
        if (resolvedTenants.length === 0)
            return [];
        /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const rows = [];
        for (const group of this._groupByServer(resolvedTenants)) {
            const groupRows = await this._runForServer(group);
            rows.push(...groupRows);
        }
        return this._mergeRows(rows);
    }
    /**
     * Resolves the tenant list (explicit or from the provider), then maps each to its server and
     * database via the tenant database resolver.
     * @returns {Promise<ResolvedTenant[]>} - Tenants to aggregate, each resolved to its server + database.
     */
    async _resolveTenants() {
        const tenants = this.options.tenants ?? await this._listProviderTenants();
        const filtered = this.options.filter ? tenants.filter(this.options.filter) : tenants;
        return filtered.map((tenant) => {
            const databaseConfiguration = this.configuration.resolveDatabaseConfiguration(this.options.identifier, tenant);
            // The server key groups tenants that share a connection endpoint so co-located tenants can be
            // UNION-ed on one connection. It only needs to be exact for the cross-database `UNION ALL`
            // path, which is MySQL-only, where host/port/username/type fully identify the server. Every
            // other driver takes the fan-out path (one connection per tenant), so a coarse key there just
            // groups tenants that are then queried individually anyway — it can never route a query to the
            // wrong server.
            return {
                database: databaseConfiguration.database,
                serverKey: JSON.stringify([
                    databaseConfiguration.type ?? null,
                    databaseConfiguration.host ?? null,
                    databaseConfiguration.port ?? null,
                    databaseConfiguration.username ?? null
                ]),
                tenant
            };
        });
    }
    /**
     * Lists every tenant for the identifier through its provider's `listTenants` hook.
     * @returns {Promise<object[]>} - Every tenant the provider lists for the identifier.
     */
    async _listProviderTenants() {
        const provider = this.configuration.getTenantDatabaseProvider(this.options.identifier);
        const listedTenants = await this.configuration.ensureConnections({ name: `Tenant.aggregateAcross: ${this.options.identifier}` }, async () => await provider.listTenants({ configuration: this.configuration, identifier: this.options.identifier }));
        if (!Array.isArray(listedTenants)) {
            throw new Error(`Tenant database provider for ${this.options.identifier} must return an array from listTenants`);
        }
        return listedTenants;
    }
    /**
     * Groups tenants by the server they live on so co-located tenants can share one query.
     * @param {ResolvedTenant[]} resolvedTenants - Tenants resolved to their server.
     * @returns {ResolvedTenant[][]} - Tenants grouped by the server they live on.
     */
    _groupByServer(resolvedTenants) {
        /** @type {Map<string, ResolvedTenant[]>} */
        const groups = new Map();
        for (const resolvedTenant of resolvedTenants) {
            const group = groups.get(resolvedTenant.serverKey);
            if (group) {
                group.push(resolvedTenant);
            }
            else {
                groups.set(resolvedTenant.serverKey, [resolvedTenant]);
            }
        }
        return Array.from(groups.values());
    }
    /**
     * Runs the aggregate for one server's tenants, using a single cross-database `UNION ALL` when the
     * driver supports it or one query per tenant otherwise. The driver capability is probed in its own
     * connection scope that is released before the fan-out runs, so a `max: 1` tenant pool is never
     * asked for a second connection while the first is still held (which would deadlock).
     * @param {ResolvedTenant[]} group - Tenants sharing one server.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Rows produced for this server.
     */
    async _runForServer(group) {
        const [firstTenant] = group;
        const supportsCrossDatabaseReferences = await this._withTenant(firstTenant.tenant, async (connections) => connections[this.options.identifier].supportsCrossDatabaseReferences());
        if (supportsCrossDatabaseReferences) {
            return await this._withTenant(firstTenant.tenant, async (connections) => {
                const connection = connections[this.options.identifier];
                return await connection.query(this.buildAggregateSql({ connection, entries: group, qualified: true }), { signal: this.options.signal });
            });
        }
        /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const rows = [];
        for (const resolvedTenant of group) {
            const tenantRows = await this._withTenant(resolvedTenant.tenant, async (connections) => {
                const connection = connections[this.options.identifier];
                return await connection.query(this.buildAggregateSql({ connection, entries: [resolvedTenant], qualified: false }), { signal: this.options.signal });
            });
            rows.push(...tenantRows);
        }
        return rows;
    }
    /**
     * Runs `callback` inside a tenant's context with its connections established, mirroring
     * `Tenant.with` without importing it (which would create an import cycle).
     * @template T
     * @param {object} tenant - Tenant descriptor to switch into.
     * @param {(connections: Record<string, import("../database/drivers/base.js").default>) => Promise<T>} callback - Operation to run with the tenant's active connections.
     * @returns {Promise<T>} - Callback result from within the tenant context.
     */
    async _withTenant(tenant, callback) {
        return await this.configuration.runWithTenant(tenant, async () => await this.configuration.ensureConnections(callback));
    }
    /**
     * Builds the aggregate SQL: an outer `GROUP BY` over a `UNION ALL` of each entry's subquery.
     * @param {{connection: import("../database/drivers/base.js").default, entries: ResolvedTenant[], qualified: boolean}} args - Connection, tenants, and whether to qualify tables with their database name.
     * @returns {string} - Executable aggregate SQL.
     */
    buildAggregateSql({ connection, entries, qualified }) {
        const options = connection.options();
        const quote = this._buildQuote(connection);
        const subqueries = entries.map((entry) => {
            if (qualified && !entry.database) {
                throw new Error(`Cannot build a cross-database query for a tenant without a resolved database name (identifier: ${this.options.identifier}).`);
            }
            const table = (/** @type {string} */ tableName) => qualified
                ? `${options.quoteDatabaseName(/** @type {string} */ (entry.database))}.${options.quoteTableName(tableName)}`
                : options.quoteTableName(tableName);
            return this.options.subquery({ connection, quote, table, tenant: entry.tenant });
        });
        const selectParts = this.keyColumns.map((keyColumn) => options.quoteColumnName(keyColumn));
        for (const [name, spec] of Object.entries(this.aggregates)) {
            const aggregateArgument = spec.column === "*" ? "*" : options.quoteColumnName(spec.column);
            selectParts.push(`${spec.op}(${aggregateArgument}) AS ${options.quoteColumnName(name)}`);
        }
        const unionSql = subqueries.map((subquery) => `SELECT * FROM (${subquery}) ${options.quoteTableName(`${DERIVED_TABLE_ALIAS}_source`)}`).join("\nUNION ALL\n");
        const groupBySql = this.keyColumns.length > 0
            ? `\nGROUP BY ${this.keyColumns.map((keyColumn) => options.quoteColumnName(keyColumn)).join(", ")}`
            : "";
        return `SELECT ${selectParts.join(", ")}\nFROM (\n${unionSql}\n) ${options.quoteTableName(DERIVED_TABLE_ALIAS)}${groupBySql}`;
    }
    /**
     * Merges rows from every server by combining each aggregate with its own operation. A `NULL`
     * aggregate value (an empty tenant's `SUM`/`MAX`/`MIN` returns `NULL` on the fan-out path) is
     * treated as "no contribution" and skipped, not coerced to `0` — otherwise an empty tenant would
     * drag a `MAX` of negatives or a `MIN` of positives to `0`. A key whose every tenant contributed
     * `NULL` stays `NULL`, matching SQL aggregate semantics over no rows.
     * @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} rows - Rows collected from all servers/tenants.
     * @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} - One merged row per distinct key-column combination.
     */
    _mergeRows(rows) {
        /** @type {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} */
        const merged = new Map();
        for (const row of rows) {
            const mapKey = JSON.stringify(this.keyColumns.map((keyColumn) => row[keyColumn]));
            let accumulator = merged.get(mapKey);
            if (!accumulator) {
                accumulator = {};
                for (const keyColumn of this.keyColumns) {
                    accumulator[keyColumn] = row[keyColumn];
                }
                for (const name of Object.keys(this.aggregates)) {
                    accumulator[name] = null;
                }
                merged.set(mapKey, accumulator);
            }
            for (const [name, spec] of Object.entries(this.aggregates)) {
                const rawValue = row[name];
                if (rawValue === null || rawValue === undefined)
                    continue;
                const value = this._toExactNumber(rawValue);
                accumulator[name] = accumulator[name] === null ? value : this._combine(spec.op, accumulator[name], value);
            }
        }
        return Array.from(merged.values());
    }
    /**
     * Combines two non-null per-server aggregate values with the aggregate's own operation.
     * @param {AggregateOperation} op - Aggregate operation.
     * @param {number} current - Accumulated value.
     * @param {number} value - Incoming per-server value.
     * @returns {number} - Combined value.
     */
    _combine(op, current, value) {
        if (op === "MAX")
            return Math.max(current, value);
        if (op === "MIN")
            return Math.min(current, value);
        return current + value;
    }
    /**
     * Converts a driver-returned aggregate value to a number, failing loudly rather than silently
     * losing precision. Drivers return exact integer aggregates (MySQL `SUM`/`COUNT`, PostgreSQL
     * `bigint`) as strings; an integer beyond `Number.MAX_SAFE_INTEGER` cannot be represented exactly
     * as a JS number, so cross-server merging would corrupt the result — throw instead. (Fractional
     * `DECIMAL`/`NUMERIC` values are still subject to normal floating-point representation.)
     * @param {ReturnType<typeof JSON.parse>} rawValue - Value returned by the driver for an aggregate column.
     * @returns {number} - The value as a number.
     */
    _toExactNumber(rawValue) {
        const value = Number(rawValue);
        if (typeof rawValue === "string" && /^-?\d+$/.test(rawValue.trim()) && !Number.isSafeInteger(value)) {
            throw new Error(`Aggregate value ${rawValue} exceeds the safe-integer range and cannot be merged without losing precision.`);
        }
        return value;
    }
    /**
     * Builds the value quoter passed to subqueries, with a `.list` helper for `IN (...)` clauses.
     * @param {import("../database/drivers/base.js").default} connection - Driver whose quoting is used.
     * @returns {((value: ReturnType<typeof JSON.parse>) => string) & {list: (values: Array<ReturnType<typeof JSON.parse>>) => string}} - Value quoter with a `.list` helper.
     */
    _buildQuote(connection) {
        return Object.assign((/** @type {ReturnType<typeof JSON.parse>} */ value) => String(connection.quote(value)), { list: (/** @type {Array<ReturnType<typeof JSON.parse>>} */ values) => values.map((value) => String(connection.quote(value))).join(", ") });
    }
    /**
     * Normalizes the aggregate specs (string shorthand or object) and validates each operation.
     * @param {Record<string, AggregateSpec>} aggregates - Raw aggregate specs.
     * @returns {Record<string, {op: AggregateOperation, column: string}>} - Normalized aggregate specs.
     */
    _normalizeAggregates(aggregates) {
        /** @type {Record<string, {op: AggregateOperation, column: string}>} */
        const normalized = {};
        for (const [name, spec] of Object.entries(aggregates)) {
            const op = /** @type {AggregateOperation} */ ((typeof spec === "string" ? spec : spec.op).toUpperCase());
            if (!AGGREGATE_OPERATIONS.has(op)) {
                throw new Error(`Unsupported aggregate operation for ${name}: ${op}. Supported: ${Array.from(AGGREGATE_OPERATIONS).join(", ")}.`);
            }
            normalized[name] = { column: typeof spec === "string" ? name : spec.column, op };
        }
        return normalized;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuYW50LWFnZ3JlZ2F0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVuYW50cy90ZW5hbnQtYWdncmVnYXRvci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBRW5DOztHQUVHO0FBRUg7O0dBRUc7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7Ozs7OztHQVVHO0FBRUg7O0dBRUc7QUFFSCxNQUFNLG9CQUFvQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtBQUNwRSxNQUFNLG1CQUFtQixHQUFHLDRCQUE0QixDQUFBO0FBRXhEOzs7Ozs7Ozs7R0FTRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0JBQWdCO0lBQ25DOzs7T0FHRztJQUNILFlBQVksT0FBTztRQUNqQixJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ3JFLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUE7UUFDMUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ2pFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsR0FBRztRQUNQLE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBRXBELElBQUksZUFBZSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTyxFQUFFLENBQUE7UUFFM0MsbUVBQW1FO1FBQ25FLE1BQU0sSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUVmLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1lBQ3pELE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUVqRCxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsU0FBUyxDQUFDLENBQUE7UUFDekIsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxlQUFlO1FBQ25CLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxJQUFJLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDekUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFBO1FBRXBGLE9BQU8sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFO1lBQzdCLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyw0QkFBNEIsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQTtZQUU5Ryw4RkFBOEY7WUFDOUYsMkZBQTJGO1lBQzNGLDRGQUE0RjtZQUM1Riw4RkFBOEY7WUFDOUYsK0ZBQStGO1lBQy9GLGdCQUFnQjtZQUNoQixPQUFPO2dCQUNMLFFBQVEsRUFBRSxxQkFBcUIsQ0FBQyxRQUFRO2dCQUN4QyxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDeEIscUJBQXFCLENBQUMsSUFBSSxJQUFJLElBQUk7b0JBQ2xDLHFCQUFxQixDQUFDLElBQUksSUFBSSxJQUFJO29CQUNsQyxxQkFBcUIsQ0FBQyxJQUFJLElBQUksSUFBSTtvQkFDbEMscUJBQXFCLENBQUMsUUFBUSxJQUFJLElBQUk7aUJBQ3ZDLENBQUM7Z0JBQ0YsTUFBTTthQUNQLENBQUE7UUFDSCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsb0JBQW9CO1FBQ3hCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUN0RixNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsaUJBQWlCLENBQzlELEVBQUMsSUFBSSxFQUFFLDJCQUEyQixJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFDLEVBQzVELEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxRQUFRLENBQUMsV0FBVyxDQUFDLEVBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsVUFBVSxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FDakgsQ0FBQTtRQUVELElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDbEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLHdDQUF3QyxDQUFDLENBQUE7UUFDbEgsQ0FBQztRQUVELE9BQU8sYUFBYSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsY0FBYyxDQUFDLGVBQWU7UUFDNUIsNENBQTRDO1FBQzVDLE1BQU0sTUFBTSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFeEIsS0FBSyxNQUFNLGNBQWMsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUM3QyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUVsRCxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUNWLEtBQUssQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDNUIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLFNBQVMsRUFBRSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUE7WUFDeEQsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsYUFBYSxDQUFDLEtBQUs7UUFDdkIsTUFBTSxDQUFDLFdBQVcsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUMzQixNQUFNLCtCQUErQixHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FDNUQsV0FBVyxDQUFDLE1BQU0sRUFDbEIsS0FBSyxFQUFFLFdBQVcsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMsK0JBQStCLEVBQUUsQ0FDOUYsQ0FBQTtRQUVELElBQUksK0JBQStCLEVBQUUsQ0FBQztZQUNwQyxPQUFPLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsRUFBRTtnQkFDdEUsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBRXZELE9BQU8sTUFBTSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUMsQ0FBQyxFQUFFLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUNySSxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxtRUFBbUU7UUFDbkUsTUFBTSxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRWYsS0FBSyxNQUFNLGNBQWMsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNuQyxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLEVBQUU7Z0JBQ3JGLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUV2RCxPQUFPLE1BQU0sVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFFLENBQUMsY0FBYyxDQUFDLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDLEVBQUUsRUFBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1lBQ2pKLENBQUMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLFVBQVUsQ0FBQyxDQUFBO1FBQzFCLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsUUFBUTtRQUNoQyxPQUFPLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7SUFDekgsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQkFBaUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFDO1FBQ2hELE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwQyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUN2QyxJQUFJLFNBQVMsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDakMsTUFBTSxJQUFJLEtBQUssQ0FBQyxrR0FBa0csSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksQ0FBQyxDQUFBO1lBQ2hKLENBQUM7WUFFRCxNQUFNLEtBQUssR0FBRyxDQUFDLHFCQUFxQixDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUztnQkFDMUQsQ0FBQyxDQUFDLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLHFCQUFxQixDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsRUFBRTtnQkFDN0csQ0FBQyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUE7WUFFckMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUNoRixDQUFDLENBQUMsQ0FBQTtRQUVGLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7UUFFMUYsS0FBSyxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDM0QsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUUxRixXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLEVBQUUsSUFBSSxpQkFBaUIsUUFBUSxPQUFPLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMxRixDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsa0JBQWtCLFFBQVEsS0FBSyxPQUFPLENBQUMsY0FBYyxDQUFDLEdBQUcsbUJBQW1CLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDN0osTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUMzQyxDQUFDLENBQUMsY0FBYyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUNuRyxDQUFDLENBQUMsRUFBRSxDQUFBO1FBRU4sT0FBTyxVQUFVLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsUUFBUSxPQUFPLE9BQU8sQ0FBQyxjQUFjLENBQUMsbUJBQW1CLENBQUMsR0FBRyxVQUFVLEVBQUUsQ0FBQTtJQUMvSCxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxVQUFVLENBQUMsSUFBSTtRQUNiLHlFQUF5RTtRQUN6RSxNQUFNLE1BQU0sR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRXhCLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNqRixJQUFJLFdBQVcsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBRXBDLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztnQkFDakIsV0FBVyxHQUFHLEVBQUUsQ0FBQTtnQkFFaEIsS0FBSyxNQUFNLFNBQVMsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ3hDLFdBQVcsQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBQ3pDLENBQUM7Z0JBRUQsS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO29CQUNoRCxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFBO2dCQUMxQixDQUFDO2dCQUVELE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxDQUFBO1lBQ2pDLENBQUM7WUFFRCxLQUFLLE1BQU0sQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDM0QsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUUxQixJQUFJLFFBQVEsS0FBSyxJQUFJLElBQUksUUFBUSxLQUFLLFNBQVM7b0JBQUUsU0FBUTtnQkFFekQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFFM0MsV0FBVyxDQUFDLElBQUksQ0FBQyxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLFdBQVcsQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUMzRyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsUUFBUSxDQUFDLEVBQUUsRUFBRSxPQUFPLEVBQUUsS0FBSztRQUN6QixJQUFJLEVBQUUsS0FBSyxLQUFLO1lBQUUsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsQ0FBQTtRQUNqRCxJQUFJLEVBQUUsS0FBSyxLQUFLO1lBQUUsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsQ0FBQTtRQUVqRCxPQUFPLE9BQU8sR0FBRyxLQUFLLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsY0FBYyxDQUFDLFFBQVE7UUFDckIsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRTlCLElBQUksT0FBTyxRQUFRLEtBQUssUUFBUSxJQUFJLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDcEcsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsUUFBUSxnRkFBZ0YsQ0FBQyxDQUFBO1FBQzlILENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsV0FBVyxDQUFDLFVBQVU7UUFDcEIsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUNsQixDQUFDLDRDQUE0QyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFDdkYsRUFBQyxJQUFJLEVBQUUsQ0FBQyxtREFBbUQsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUMsQ0FDMUksQ0FBQTtJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0JBQW9CLENBQUMsVUFBVTtRQUM3Qix1RUFBdUU7UUFDdkUsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO1FBRXJCLEtBQUssTUFBTSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDdEQsTUFBTSxFQUFFLEdBQUcsaUNBQWlDLENBQUMsQ0FBQyxDQUFDLE9BQU8sSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQTtZQUV4RyxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7Z0JBQ2xDLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLElBQUksS0FBSyxFQUFFLGdCQUFnQixLQUFLLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUNuSSxDQUFDO1lBRUQsVUFBVSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUMsTUFBTSxFQUFFLE9BQU8sSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsRUFBQyxDQUFBO1FBQ2hGLENBQUM7UUFFRCxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEN1cnJlbnQgZnJvbSBcIi4uL2N1cnJlbnQuanNcIlxuXG4vKipcbiAqIEB0eXBlZGVmIHtcIlNVTVwiIHwgXCJDT1VOVFwiIHwgXCJNQVhcIiB8IFwiTUlOXCJ9IEFnZ3JlZ2F0ZU9wZXJhdGlvblxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge0FnZ3JlZ2F0ZU9wZXJhdGlvbiB8IHtvcDogQWdncmVnYXRlT3BlcmF0aW9uLCBjb2x1bW46IHN0cmluZ319IEFnZ3JlZ2F0ZVNwZWNcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN1YnF1ZXJ5Q29udGV4dFxuICogQHByb3BlcnR5IHsodGFibGVOYW1lOiBzdHJpbmcpID0+IHN0cmluZ30gdGFibGUgLSBRdW90ZXMgYSB0YWJsZSBmb3IgdGhpcyB0ZW5hbnQuIEluIGEgY3Jvc3MtZGF0YWJhc2UgYFVOSU9OIEFMTGAgaXQgcmV0dXJucyBhIGBkYXRhYmFzZWAuYHRhYmxlYCBxdWFsaWZpZWQgaWRlbnRpZmllcjsgd2hlbiBlYWNoIHRlbmFudCBydW5zIG9uIGl0cyBvd24gY29ubmVjdGlvbiBpdCByZXR1cm5zIHRoZSBwbGFpbiBxdW90ZWQgdGFibGUgbmFtZS4gVXNlIGl0IGZvciBldmVyeSB0YWJsZSB0aGUgc3VicXVlcnkgcmVhZHMgc28gdGhlIHNhbWUgc3VicXVlcnkgd29ya3Mgb24gYm90aCBleGVjdXRpb24gcGF0aHMuXG4gKiBAcHJvcGVydHkgeygodmFsdWU6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBzdHJpbmcpICYge2xpc3Q6ICh2YWx1ZXM6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gc3RyaW5nfX0gcXVvdGUgLSBRdW90ZXMgYSB2YWx1ZSBmb3IgdGhlIGFjdGl2ZSBjb25uZWN0aW9uLiBgcXVvdGUubGlzdCh2YWx1ZXMpYCBxdW90ZXMgYW5kIGNvbW1hLWpvaW5zIGFuIGFycmF5IGZvciBgSU4gKC4uLilgIGNsYXVzZXMuXG4gKiBAcHJvcGVydHkge29iamVjdH0gdGVuYW50IC0gVGhlIHRlbmFudCBkZXNjcmlwdG9yIHRoaXMgc3VicXVlcnkgaXMgYmVpbmcgYnVpbHQgZm9yLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFRoZSBkcml2ZXIgdGhlIHF1ZXJ5IHdpbGwgcnVuIG9uLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gVGVuYW50QWdncmVnYXRlT3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyIHdob3NlIHRlbmFudHMgYXJlIGFnZ3JlZ2F0ZWQgKGZvciBleGFtcGxlIGBcInByb2plY3RUZW5hbnRcImApLlxuICogQHByb3BlcnR5IHtvYmplY3RbXX0gW3RlbmFudHNdIC0gRXhwbGljaXQgdGVuYW50IGRlc2NyaXB0b3JzIHRvIGFnZ3JlZ2F0ZS4gRGVmYXVsdHMgdG8gZXZlcnkgdGVuYW50IHRoZSBpZGVudGlmaWVyJ3MgcHJvdmlkZXIgYGxpc3RUZW5hbnRzYCByZXR1cm5zLlxuICogQHByb3BlcnR5IHsodGVuYW50OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gYm9vbGVhbn0gW2ZpbHRlcl0gLSBPcHRpb25hbCBmaWx0ZXIgYXBwbGllZCB0byB0aGUgcmVzb2x2ZWQgdGVuYW50IGxpc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBba2V5Q29sdW1uc10gLSBDb2x1bW5zIHRoZSBhZ2dyZWdhdGUgaXMgZ3JvdXBlZCBieSAoZm9yIGV4YW1wbGUgYFtcImRvY2tlcl9zZXJ2ZXJfaWRcIl1gKS4gRW1wdHkgbWVhbnMgYSBzaW5nbGUgZ3JhbmQtdG90YWwgcm93LlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBBZ2dyZWdhdGVTcGVjPn0gYWdncmVnYXRlcyAtIE91dHB1dCBjb2x1bW4gbmFtZSB0byBhZ2dyZWdhdGUuIGBcIlNVTVwiYCBpcyBzaG9ydGhhbmQgZm9yIGB7b3A6IFwiU1VNXCIsIGNvbHVtbjogPG91dHB1dCBuYW1lPn1gOyB1c2UgYHtvcDogXCJDT1VOVFwiLCBjb2x1bW46IFwiKlwifWAgZm9yIGBDT1VOVCgqKWAuXG4gKiBAcHJvcGVydHkge0Fib3J0U2lnbmFsfSBbc2lnbmFsXSAtIFNpZ25hbCBwYXNzZWQgdG8gZWFjaCBhZ2dyZWdhdGUgZGF0YWJhc2UgcXVlcnkuXG4gKiBAcHJvcGVydHkgeyhjb250ZXh0OiBTdWJxdWVyeUNvbnRleHQpID0+IHN0cmluZ30gc3VicXVlcnkgLSBCdWlsZHMgb25lIHRlbmFudCdzIGlubmVyIGBTRUxFQ1RgLCB3aGljaCBtdXN0IHNlbGVjdCBldmVyeSBga2V5Q29sdW1uc2AgZW50cnkgcGx1cyBldmVyeSBhZ2dyZWdhdGUgc291cmNlIGNvbHVtbi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIHRvIHJ1biBhZ2FpbnN0LiBEZWZhdWx0cyB0byB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge3t0ZW5hbnQ6IG9iamVjdCwgZGF0YWJhc2U6IHN0cmluZyB8IHVuZGVmaW5lZCwgc2VydmVyS2V5OiBzdHJpbmd9fSBSZXNvbHZlZFRlbmFudFxuICovXG5cbmNvbnN0IEFHR1JFR0FURV9PUEVSQVRJT05TID0gbmV3IFNldChbXCJTVU1cIiwgXCJDT1VOVFwiLCBcIk1BWFwiLCBcIk1JTlwiXSlcbmNvbnN0IERFUklWRURfVEFCTEVfQUxJQVMgPSBcInZlbG9jaW91c190ZW5hbnRfYWdncmVnYXRlXCJcblxuLyoqXG4gKiBSdW5zIG9uZSBhZ2dyZWdhdGUgcXVlcnkgYWNyb3NzIG1hbnkgdGVuYW50IGRhdGFiYXNlcyBhbmQgbWVyZ2VzIHRoZSByZXN1bHQuIFRlbmFudCBkYXRhYmFzZXMgbWF5XG4gKiBiZSBjby1sb2NhdGVkIG9uIHRoZSBkZWZhdWx0IHNlcnZlciBvciBzcHJlYWQgYWNyb3NzIG90aGVyIHNlcnZlcnMsIGFuZCB0aGV5IGNhbiBhcHBlYXIgb3JcbiAqIGRpc2FwcGVhciBhdCBydW50aW1lOyB0aGlzIHJlc29sdmVzIHRoZSBsaXZlIHRlbmFudCBsaXN0LCBncm91cHMgdGVuYW50cyBieSB0aGUgc2VydmVyIHRoZXkgbGl2ZVxuICogb24sIGFuZCDigJQgcGVyIHNlcnZlciDigJQgZW1pdHMgYSBzaW5nbGUgY3Jvc3MtZGF0YWJhc2UgYFVOSU9OIEFMTGAgd2hlbiB0aGUgZHJpdmVyIHN1cHBvcnRzIHF1YWxpZmllZFxuICogY3Jvc3MtZGF0YWJhc2UgcmVmZXJlbmNlcyAoTXlTUUwvTVNTUUwpIG9yIGZhbGxzIGJhY2sgdG8gb25lIHF1ZXJ5IHBlciB0ZW5hbnQgb3RoZXJ3aXNlXG4gKiAoUG9zdGdyZVNRTC9TUUxpdGUpLiBSZXN1bHRzIGZyb20gZXZlcnkgc2VydmVyIGFyZSBtZXJnZWQgd2l0aCB0aGUgYWdncmVnYXRlJ3Mgb3duIG9wZXJhdGlvbiwgc29cbiAqIGNhbGxlcnMgZ2V0IG9uZSBjb21iaW5lZCByZXN1bHQgc2V0IHJlZ2FyZGxlc3Mgb2YgaG93IHRoZSB0ZW5hbnRzIGFyZSBkaXN0cmlidXRlZC4gUmVhY2hlZCB0aHJvdWdoXG4gKiBgVGVuYW50LmFnZ3JlZ2F0ZUFjcm9zc2AuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlbmFudEFnZ3JlZ2F0b3Ige1xuICAvKipcbiAgICogUHJlcGFyZXMgYW4gYWdncmVnYXRlIHJ1biwgbm9ybWFsaXppbmcgdGhlIGFnZ3JlZ2F0ZSBzcGVjcyB1cCBmcm9udC5cbiAgICogQHBhcmFtIHtUZW5hbnRBZ2dyZWdhdGVPcHRpb25zfSBvcHRpb25zIC0gQWdncmVnYXRlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9uc1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IG9wdGlvbnMuY29uZmlndXJhdGlvbiA/PyBDdXJyZW50LmNvbmZpZ3VyYXRpb24oKVxuICAgIHRoaXMua2V5Q29sdW1ucyA9IG9wdGlvbnMua2V5Q29sdW1ucyA/PyBbXVxuICAgIHRoaXMuYWdncmVnYXRlcyA9IHRoaXMuX25vcm1hbGl6ZUFnZ3JlZ2F0ZXMob3B0aW9ucy5hZ2dyZWdhdGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSB0ZW5hbnQgbGlzdCwgcnVucyB0aGUgYWdncmVnYXRlIHBlciBzZXJ2ZXIsIGFuZCBtZXJnZXMgZXZlcnl0aGluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gT25lIG1lcmdlZCByb3cgcGVyIGRpc3RpbmN0IGtleS1jb2x1bW4gY29tYmluYXRpb24uXG4gICAqL1xuICBhc3luYyBydW4oKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRUZW5hbnRzID0gYXdhaXQgdGhpcy5fcmVzb2x2ZVRlbmFudHMoKVxuXG4gICAgaWYgKHJlc29sdmVkVGVuYW50cy5sZW5ndGggPT09IDApIHJldHVybiBbXVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IHJvd3MgPSBbXVxuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiB0aGlzLl9ncm91cEJ5U2VydmVyKHJlc29sdmVkVGVuYW50cykpIHtcbiAgICAgIGNvbnN0IGdyb3VwUm93cyA9IGF3YWl0IHRoaXMuX3J1bkZvclNlcnZlcihncm91cClcblxuICAgICAgcm93cy5wdXNoKC4uLmdyb3VwUm93cylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbWVyZ2VSb3dzKHJvd3MpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHRlbmFudCBsaXN0IChleHBsaWNpdCBvciBmcm9tIHRoZSBwcm92aWRlciksIHRoZW4gbWFwcyBlYWNoIHRvIGl0cyBzZXJ2ZXIgYW5kXG4gICAqIGRhdGFiYXNlIHZpYSB0aGUgdGVuYW50IGRhdGFiYXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNvbHZlZFRlbmFudFtdPn0gLSBUZW5hbnRzIHRvIGFnZ3JlZ2F0ZSwgZWFjaCByZXNvbHZlZCB0byBpdHMgc2VydmVyICsgZGF0YWJhc2UuXG4gICAqL1xuICBhc3luYyBfcmVzb2x2ZVRlbmFudHMoKSB7XG4gICAgY29uc3QgdGVuYW50cyA9IHRoaXMub3B0aW9ucy50ZW5hbnRzID8/IGF3YWl0IHRoaXMuX2xpc3RQcm92aWRlclRlbmFudHMoKVxuICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5vcHRpb25zLmZpbHRlciA/IHRlbmFudHMuZmlsdGVyKHRoaXMub3B0aW9ucy5maWx0ZXIpIDogdGVuYW50c1xuXG4gICAgcmV0dXJuIGZpbHRlcmVkLm1hcCgodGVuYW50KSA9PiB7XG4gICAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbih0aGlzLm9wdGlvbnMuaWRlbnRpZmllciwgdGVuYW50KVxuXG4gICAgICAvLyBUaGUgc2VydmVyIGtleSBncm91cHMgdGVuYW50cyB0aGF0IHNoYXJlIGEgY29ubmVjdGlvbiBlbmRwb2ludCBzbyBjby1sb2NhdGVkIHRlbmFudHMgY2FuIGJlXG4gICAgICAvLyBVTklPTi1lZCBvbiBvbmUgY29ubmVjdGlvbi4gSXQgb25seSBuZWVkcyB0byBiZSBleGFjdCBmb3IgdGhlIGNyb3NzLWRhdGFiYXNlIGBVTklPTiBBTExgXG4gICAgICAvLyBwYXRoLCB3aGljaCBpcyBNeVNRTC1vbmx5LCB3aGVyZSBob3N0L3BvcnQvdXNlcm5hbWUvdHlwZSBmdWxseSBpZGVudGlmeSB0aGUgc2VydmVyLiBFdmVyeVxuICAgICAgLy8gb3RoZXIgZHJpdmVyIHRha2VzIHRoZSBmYW4tb3V0IHBhdGggKG9uZSBjb25uZWN0aW9uIHBlciB0ZW5hbnQpLCBzbyBhIGNvYXJzZSBrZXkgdGhlcmUganVzdFxuICAgICAgLy8gZ3JvdXBzIHRlbmFudHMgdGhhdCBhcmUgdGhlbiBxdWVyaWVkIGluZGl2aWR1YWxseSBhbnl3YXkg4oCUIGl0IGNhbiBuZXZlciByb3V0ZSBhIHF1ZXJ5IHRvIHRoZVxuICAgICAgLy8gd3Jvbmcgc2VydmVyLlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZGF0YWJhc2U6IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5kYXRhYmFzZSxcbiAgICAgICAgc2VydmVyS2V5OiBKU09OLnN0cmluZ2lmeShbXG4gICAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLnR5cGUgPz8gbnVsbCxcbiAgICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24uaG9zdCA/PyBudWxsLFxuICAgICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbi5wb3J0ID8/IG51bGwsXG4gICAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLnVzZXJuYW1lID8/IG51bGxcbiAgICAgICAgXSksXG4gICAgICAgIHRlbmFudFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgZXZlcnkgdGVuYW50IGZvciB0aGUgaWRlbnRpZmllciB0aHJvdWdoIGl0cyBwcm92aWRlcidzIGBsaXN0VGVuYW50c2AgaG9vay5cbiAgICogQHJldHVybnMge1Byb21pc2U8b2JqZWN0W10+fSAtIEV2ZXJ5IHRlbmFudCB0aGUgcHJvdmlkZXIgbGlzdHMgZm9yIHRoZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgYXN5bmMgX2xpc3RQcm92aWRlclRlbmFudHMoKSB7XG4gICAgY29uc3QgcHJvdmlkZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcih0aGlzLm9wdGlvbnMuaWRlbnRpZmllcilcbiAgICBjb25zdCBsaXN0ZWRUZW5hbnRzID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKFxuICAgICAge25hbWU6IGBUZW5hbnQuYWdncmVnYXRlQWNyb3NzOiAke3RoaXMub3B0aW9ucy5pZGVudGlmaWVyfWB9LFxuICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgcHJvdmlkZXIubGlzdFRlbmFudHMoe2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbiwgaWRlbnRpZmllcjogdGhpcy5vcHRpb25zLmlkZW50aWZpZXJ9KVxuICAgIClcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShsaXN0ZWRUZW5hbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgZm9yICR7dGhpcy5vcHRpb25zLmlkZW50aWZpZXJ9IG11c3QgcmV0dXJuIGFuIGFycmF5IGZyb20gbGlzdFRlbmFudHNgKVxuICAgIH1cblxuICAgIHJldHVybiBsaXN0ZWRUZW5hbnRzXG4gIH1cblxuICAvKipcbiAgICogR3JvdXBzIHRlbmFudHMgYnkgdGhlIHNlcnZlciB0aGV5IGxpdmUgb24gc28gY28tbG9jYXRlZCB0ZW5hbnRzIGNhbiBzaGFyZSBvbmUgcXVlcnkuXG4gICAqIEBwYXJhbSB7UmVzb2x2ZWRUZW5hbnRbXX0gcmVzb2x2ZWRUZW5hbnRzIC0gVGVuYW50cyByZXNvbHZlZCB0byB0aGVpciBzZXJ2ZXIuXG4gICAqIEByZXR1cm5zIHtSZXNvbHZlZFRlbmFudFtdW119IC0gVGVuYW50cyBncm91cGVkIGJ5IHRoZSBzZXJ2ZXIgdGhleSBsaXZlIG9uLlxuICAgKi9cbiAgX2dyb3VwQnlTZXJ2ZXIocmVzb2x2ZWRUZW5hbnRzKSB7XG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBSZXNvbHZlZFRlbmFudFtdPn0gKi9cbiAgICBjb25zdCBncm91cHMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcmVzb2x2ZWRUZW5hbnQgb2YgcmVzb2x2ZWRUZW5hbnRzKSB7XG4gICAgICBjb25zdCBncm91cCA9IGdyb3Vwcy5nZXQocmVzb2x2ZWRUZW5hbnQuc2VydmVyS2V5KVxuXG4gICAgICBpZiAoZ3JvdXApIHtcbiAgICAgICAgZ3JvdXAucHVzaChyZXNvbHZlZFRlbmFudClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGdyb3Vwcy5zZXQocmVzb2x2ZWRUZW5hbnQuc2VydmVyS2V5LCBbcmVzb2x2ZWRUZW5hbnRdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5mcm9tKGdyb3Vwcy52YWx1ZXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBhZ2dyZWdhdGUgZm9yIG9uZSBzZXJ2ZXIncyB0ZW5hbnRzLCB1c2luZyBhIHNpbmdsZSBjcm9zcy1kYXRhYmFzZSBgVU5JT04gQUxMYCB3aGVuIHRoZVxuICAgKiBkcml2ZXIgc3VwcG9ydHMgaXQgb3Igb25lIHF1ZXJ5IHBlciB0ZW5hbnQgb3RoZXJ3aXNlLiBUaGUgZHJpdmVyIGNhcGFiaWxpdHkgaXMgcHJvYmVkIGluIGl0cyBvd25cbiAgICogY29ubmVjdGlvbiBzY29wZSB0aGF0IGlzIHJlbGVhc2VkIGJlZm9yZSB0aGUgZmFuLW91dCBydW5zLCBzbyBhIGBtYXg6IDFgIHRlbmFudCBwb29sIGlzIG5ldmVyXG4gICAqIGFza2VkIGZvciBhIHNlY29uZCBjb25uZWN0aW9uIHdoaWxlIHRoZSBmaXJzdCBpcyBzdGlsbCBoZWxkICh3aGljaCB3b3VsZCBkZWFkbG9jaykuXG4gICAqIEBwYXJhbSB7UmVzb2x2ZWRUZW5hbnRbXX0gZ3JvdXAgLSBUZW5hbnRzIHNoYXJpbmcgb25lIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gUm93cyBwcm9kdWNlZCBmb3IgdGhpcyBzZXJ2ZXIuXG4gICAqL1xuICBhc3luYyBfcnVuRm9yU2VydmVyKGdyb3VwKSB7XG4gICAgY29uc3QgW2ZpcnN0VGVuYW50XSA9IGdyb3VwXG4gICAgY29uc3Qgc3VwcG9ydHNDcm9zc0RhdGFiYXNlUmVmZXJlbmNlcyA9IGF3YWl0IHRoaXMuX3dpdGhUZW5hbnQoXG4gICAgICBmaXJzdFRlbmFudC50ZW5hbnQsXG4gICAgICBhc3luYyAoY29ubmVjdGlvbnMpID0+IGNvbm5lY3Rpb25zW3RoaXMub3B0aW9ucy5pZGVudGlmaWVyXS5zdXBwb3J0c0Nyb3NzRGF0YWJhc2VSZWZlcmVuY2VzKClcbiAgICApXG5cbiAgICBpZiAoc3VwcG9ydHNDcm9zc0RhdGFiYXNlUmVmZXJlbmNlcykge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhUZW5hbnQoZmlyc3RUZW5hbnQudGVuYW50LCBhc3luYyAoY29ubmVjdGlvbnMpID0+IHtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25zW3RoaXMub3B0aW9ucy5pZGVudGlmaWVyXVxuXG4gICAgICAgIHJldHVybiBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KHRoaXMuYnVpbGRBZ2dyZWdhdGVTcWwoe2Nvbm5lY3Rpb24sIGVudHJpZXM6IGdyb3VwLCBxdWFsaWZpZWQ6IHRydWV9KSwge3NpZ25hbDogdGhpcy5vcHRpb25zLnNpZ25hbH0pXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCByb3dzID0gW11cblxuICAgIGZvciAoY29uc3QgcmVzb2x2ZWRUZW5hbnQgb2YgZ3JvdXApIHtcbiAgICAgIGNvbnN0IHRlbmFudFJvd3MgPSBhd2FpdCB0aGlzLl93aXRoVGVuYW50KHJlc29sdmVkVGVuYW50LnRlbmFudCwgYXN5bmMgKGNvbm5lY3Rpb25zKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBjb25uZWN0aW9uc1t0aGlzLm9wdGlvbnMuaWRlbnRpZmllcl1cblxuICAgICAgICByZXR1cm4gYXdhaXQgY29ubmVjdGlvbi5xdWVyeSh0aGlzLmJ1aWxkQWdncmVnYXRlU3FsKHtjb25uZWN0aW9uLCBlbnRyaWVzOiBbcmVzb2x2ZWRUZW5hbnRdLCBxdWFsaWZpZWQ6IGZhbHNlfSksIHtzaWduYWw6IHRoaXMub3B0aW9ucy5zaWduYWx9KVxuICAgICAgfSlcblxuICAgICAgcm93cy5wdXNoKC4uLnRlbmFudFJvd3MpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJvd3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGBjYWxsYmFja2AgaW5zaWRlIGEgdGVuYW50J3MgY29udGV4dCB3aXRoIGl0cyBjb25uZWN0aW9ucyBlc3RhYmxpc2hlZCwgbWlycm9yaW5nXG4gICAqIGBUZW5hbnQud2l0aGAgd2l0aG91dCBpbXBvcnRpbmcgaXQgKHdoaWNoIHdvdWxkIGNyZWF0ZSBhbiBpbXBvcnQgY3ljbGUpLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gdGVuYW50IC0gVGVuYW50IGRlc2NyaXB0b3IgdG8gc3dpdGNoIGludG8uXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb25zOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIHRvIHJ1biB3aXRoIHRoZSB0ZW5hbnQncyBhY3RpdmUgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdCBmcm9tIHdpdGhpbiB0aGUgdGVuYW50IGNvbnRleHQuXG4gICAqL1xuICBhc3luYyBfd2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGFnZ3JlZ2F0ZSBTUUw6IGFuIG91dGVyIGBHUk9VUCBCWWAgb3ZlciBhIGBVTklPTiBBTExgIG9mIGVhY2ggZW50cnkncyBzdWJxdWVyeS5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGVudHJpZXM6IFJlc29sdmVkVGVuYW50W10sIHF1YWxpZmllZDogYm9vbGVhbn19IGFyZ3MgLSBDb25uZWN0aW9uLCB0ZW5hbnRzLCBhbmQgd2hldGhlciB0byBxdWFsaWZ5IHRhYmxlcyB3aXRoIHRoZWlyIGRhdGFiYXNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRXhlY3V0YWJsZSBhZ2dyZWdhdGUgU1FMLlxuICAgKi9cbiAgYnVpbGRBZ2dyZWdhdGVTcWwoe2Nvbm5lY3Rpb24sIGVudHJpZXMsIHF1YWxpZmllZH0pIHtcbiAgICBjb25zdCBvcHRpb25zID0gY29ubmVjdGlvbi5vcHRpb25zKClcbiAgICBjb25zdCBxdW90ZSA9IHRoaXMuX2J1aWxkUXVvdGUoY29ubmVjdGlvbilcbiAgICBjb25zdCBzdWJxdWVyaWVzID0gZW50cmllcy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICBpZiAocXVhbGlmaWVkICYmICFlbnRyeS5kYXRhYmFzZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBidWlsZCBhIGNyb3NzLWRhdGFiYXNlIHF1ZXJ5IGZvciBhIHRlbmFudCB3aXRob3V0IGEgcmVzb2x2ZWQgZGF0YWJhc2UgbmFtZSAoaWRlbnRpZmllcjogJHt0aGlzLm9wdGlvbnMuaWRlbnRpZmllcn0pLmApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhYmxlID0gKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyB0YWJsZU5hbWUpID0+IHF1YWxpZmllZFxuICAgICAgICA/IGAke29wdGlvbnMucXVvdGVEYXRhYmFzZU5hbWUoLyoqIEB0eXBlIHtzdHJpbmd9ICovIChlbnRyeS5kYXRhYmFzZSkpfS4ke29wdGlvbnMucXVvdGVUYWJsZU5hbWUodGFibGVOYW1lKX1gXG4gICAgICAgIDogb3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0YWJsZU5hbWUpXG5cbiAgICAgIHJldHVybiB0aGlzLm9wdGlvbnMuc3VicXVlcnkoe2Nvbm5lY3Rpb24sIHF1b3RlLCB0YWJsZSwgdGVuYW50OiBlbnRyeS50ZW5hbnR9KVxuICAgIH0pXG5cbiAgICBjb25zdCBzZWxlY3RQYXJ0cyA9IHRoaXMua2V5Q29sdW1ucy5tYXAoKGtleUNvbHVtbikgPT4gb3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUoa2V5Q29sdW1uKSlcblxuICAgIGZvciAoY29uc3QgW25hbWUsIHNwZWNdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuYWdncmVnYXRlcykpIHtcbiAgICAgIGNvbnN0IGFnZ3JlZ2F0ZUFyZ3VtZW50ID0gc3BlYy5jb2x1bW4gPT09IFwiKlwiID8gXCIqXCIgOiBvcHRpb25zLnF1b3RlQ29sdW1uTmFtZShzcGVjLmNvbHVtbilcblxuICAgICAgc2VsZWN0UGFydHMucHVzaChgJHtzcGVjLm9wfSgke2FnZ3JlZ2F0ZUFyZ3VtZW50fSkgQVMgJHtvcHRpb25zLnF1b3RlQ29sdW1uTmFtZShuYW1lKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHVuaW9uU3FsID0gc3VicXVlcmllcy5tYXAoKHN1YnF1ZXJ5KSA9PiBgU0VMRUNUICogRlJPTSAoJHtzdWJxdWVyeX0pICR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZShgJHtERVJJVkVEX1RBQkxFX0FMSUFTfV9zb3VyY2VgKX1gKS5qb2luKFwiXFxuVU5JT04gQUxMXFxuXCIpXG4gICAgY29uc3QgZ3JvdXBCeVNxbCA9IHRoaXMua2V5Q29sdW1ucy5sZW5ndGggPiAwXG4gICAgICA/IGBcXG5HUk9VUCBCWSAke3RoaXMua2V5Q29sdW1ucy5tYXAoKGtleUNvbHVtbikgPT4gb3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUoa2V5Q29sdW1uKSkuam9pbihcIiwgXCIpfWBcbiAgICAgIDogXCJcIlxuXG4gICAgcmV0dXJuIGBTRUxFQ1QgJHtzZWxlY3RQYXJ0cy5qb2luKFwiLCBcIil9XFxuRlJPTSAoXFxuJHt1bmlvblNxbH1cXG4pICR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZShERVJJVkVEX1RBQkxFX0FMSUFTKX0ke2dyb3VwQnlTcWx9YFxuICB9XG5cbiAgLyoqXG4gICAqIE1lcmdlcyByb3dzIGZyb20gZXZlcnkgc2VydmVyIGJ5IGNvbWJpbmluZyBlYWNoIGFnZ3JlZ2F0ZSB3aXRoIGl0cyBvd24gb3BlcmF0aW9uLiBBIGBOVUxMYFxuICAgKiBhZ2dyZWdhdGUgdmFsdWUgKGFuIGVtcHR5IHRlbmFudCdzIGBTVU1gL2BNQVhgL2BNSU5gIHJldHVybnMgYE5VTExgIG9uIHRoZSBmYW4tb3V0IHBhdGgpIGlzXG4gICAqIHRyZWF0ZWQgYXMgXCJubyBjb250cmlidXRpb25cIiBhbmQgc2tpcHBlZCwgbm90IGNvZXJjZWQgdG8gYDBgIOKAlCBvdGhlcndpc2UgYW4gZW1wdHkgdGVuYW50IHdvdWxkXG4gICAqIGRyYWcgYSBgTUFYYCBvZiBuZWdhdGl2ZXMgb3IgYSBgTUlOYCBvZiBwb3NpdGl2ZXMgdG8gYDBgLiBBIGtleSB3aG9zZSBldmVyeSB0ZW5hbnQgY29udHJpYnV0ZWRcbiAgICogYE5VTExgIHN0YXlzIGBOVUxMYCwgbWF0Y2hpbmcgU1FMIGFnZ3JlZ2F0ZSBzZW1hbnRpY3Mgb3ZlciBubyByb3dzLlxuICAgKiBAcGFyYW0ge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIGNvbGxlY3RlZCBmcm9tIGFsbCBzZXJ2ZXJzL3RlbmFudHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIE9uZSBtZXJnZWQgcm93IHBlciBkaXN0aW5jdCBrZXktY29sdW1uIGNvbWJpbmF0aW9uLlxuICAgKi9cbiAgX21lcmdlUm93cyhyb3dzKSB7XG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IG1lcmdlZCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgbWFwS2V5ID0gSlNPTi5zdHJpbmdpZnkodGhpcy5rZXlDb2x1bW5zLm1hcCgoa2V5Q29sdW1uKSA9PiByb3dba2V5Q29sdW1uXSkpXG4gICAgICBsZXQgYWNjdW11bGF0b3IgPSBtZXJnZWQuZ2V0KG1hcEtleSlcblxuICAgICAgaWYgKCFhY2N1bXVsYXRvcikge1xuICAgICAgICBhY2N1bXVsYXRvciA9IHt9XG5cbiAgICAgICAgZm9yIChjb25zdCBrZXlDb2x1bW4gb2YgdGhpcy5rZXlDb2x1bW5zKSB7XG4gICAgICAgICAgYWNjdW11bGF0b3Jba2V5Q29sdW1uXSA9IHJvd1trZXlDb2x1bW5dXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5hZ2dyZWdhdGVzKSkge1xuICAgICAgICAgIGFjY3VtdWxhdG9yW25hbWVdID0gbnVsbFxuICAgICAgICB9XG5cbiAgICAgICAgbWVyZ2VkLnNldChtYXBLZXksIGFjY3VtdWxhdG9yKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IFtuYW1lLCBzcGVjXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmFnZ3JlZ2F0ZXMpKSB7XG4gICAgICAgIGNvbnN0IHJhd1ZhbHVlID0gcm93W25hbWVdXG5cbiAgICAgICAgaWYgKHJhd1ZhbHVlID09PSBudWxsIHx8IHJhd1ZhbHVlID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLl90b0V4YWN0TnVtYmVyKHJhd1ZhbHVlKVxuXG4gICAgICAgIGFjY3VtdWxhdG9yW25hbWVdID0gYWNjdW11bGF0b3JbbmFtZV0gPT09IG51bGwgPyB2YWx1ZSA6IHRoaXMuX2NvbWJpbmUoc3BlYy5vcCwgYWNjdW11bGF0b3JbbmFtZV0sIHZhbHVlKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5mcm9tKG1lcmdlZC52YWx1ZXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21iaW5lcyB0d28gbm9uLW51bGwgcGVyLXNlcnZlciBhZ2dyZWdhdGUgdmFsdWVzIHdpdGggdGhlIGFnZ3JlZ2F0ZSdzIG93biBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7QWdncmVnYXRlT3BlcmF0aW9ufSBvcCAtIEFnZ3JlZ2F0ZSBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjdXJyZW50IC0gQWNjdW11bGF0ZWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIEluY29taW5nIHBlci1zZXJ2ZXIgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQ29tYmluZWQgdmFsdWUuXG4gICAqL1xuICBfY29tYmluZShvcCwgY3VycmVudCwgdmFsdWUpIHtcbiAgICBpZiAob3AgPT09IFwiTUFYXCIpIHJldHVybiBNYXRoLm1heChjdXJyZW50LCB2YWx1ZSlcbiAgICBpZiAob3AgPT09IFwiTUlOXCIpIHJldHVybiBNYXRoLm1pbihjdXJyZW50LCB2YWx1ZSlcblxuICAgIHJldHVybiBjdXJyZW50ICsgdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIGRyaXZlci1yZXR1cm5lZCBhZ2dyZWdhdGUgdmFsdWUgdG8gYSBudW1iZXIsIGZhaWxpbmcgbG91ZGx5IHJhdGhlciB0aGFuIHNpbGVudGx5XG4gICAqIGxvc2luZyBwcmVjaXNpb24uIERyaXZlcnMgcmV0dXJuIGV4YWN0IGludGVnZXIgYWdncmVnYXRlcyAoTXlTUUwgYFNVTWAvYENPVU5UYCwgUG9zdGdyZVNRTFxuICAgKiBgYmlnaW50YCkgYXMgc3RyaW5nczsgYW4gaW50ZWdlciBiZXlvbmQgYE51bWJlci5NQVhfU0FGRV9JTlRFR0VSYCBjYW5ub3QgYmUgcmVwcmVzZW50ZWQgZXhhY3RseVxuICAgKiBhcyBhIEpTIG51bWJlciwgc28gY3Jvc3Mtc2VydmVyIG1lcmdpbmcgd291bGQgY29ycnVwdCB0aGUgcmVzdWx0IOKAlCB0aHJvdyBpbnN0ZWFkLiAoRnJhY3Rpb25hbFxuICAgKiBgREVDSU1BTGAvYE5VTUVSSUNgIHZhbHVlcyBhcmUgc3RpbGwgc3ViamVjdCB0byBub3JtYWwgZmxvYXRpbmctcG9pbnQgcmVwcmVzZW50YXRpb24uKVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByYXdWYWx1ZSAtIFZhbHVlIHJldHVybmVkIGJ5IHRoZSBkcml2ZXIgZm9yIGFuIGFnZ3JlZ2F0ZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHZhbHVlIGFzIGEgbnVtYmVyLlxuICAgKi9cbiAgX3RvRXhhY3ROdW1iZXIocmF3VmFsdWUpIHtcbiAgICBjb25zdCB2YWx1ZSA9IE51bWJlcihyYXdWYWx1ZSlcblxuICAgIGlmICh0eXBlb2YgcmF3VmFsdWUgPT09IFwic3RyaW5nXCIgJiYgL14tP1xcZCskLy50ZXN0KHJhd1ZhbHVlLnRyaW0oKSkgJiYgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBZ2dyZWdhdGUgdmFsdWUgJHtyYXdWYWx1ZX0gZXhjZWVkcyB0aGUgc2FmZS1pbnRlZ2VyIHJhbmdlIGFuZCBjYW5ub3QgYmUgbWVyZ2VkIHdpdGhvdXQgbG9zaW5nIHByZWNpc2lvbi5gKVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgdmFsdWUgcXVvdGVyIHBhc3NlZCB0byBzdWJxdWVyaWVzLCB3aXRoIGEgYC5saXN0YCBoZWxwZXIgZm9yIGBJTiAoLi4uKWAgY2xhdXNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIERyaXZlciB3aG9zZSBxdW90aW5nIGlzIHVzZWQuXG4gICAqIEByZXR1cm5zIHsoKHZhbHVlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gc3RyaW5nKSAmIHtsaXN0OiAodmFsdWVzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHN0cmluZ319IC0gVmFsdWUgcXVvdGVyIHdpdGggYSBgLmxpc3RgIGhlbHBlci5cbiAgICovXG4gIF9idWlsZFF1b3RlKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihcbiAgICAgICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyB2YWx1ZSkgPT4gU3RyaW5nKGNvbm5lY3Rpb24ucXVvdGUodmFsdWUpKSxcbiAgICAgIHtsaXN0OiAoLyoqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIHZhbHVlcykgPT4gdmFsdWVzLm1hcCgodmFsdWUpID0+IFN0cmluZyhjb25uZWN0aW9uLnF1b3RlKHZhbHVlKSkpLmpvaW4oXCIsIFwiKX1cbiAgICApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyB0aGUgYWdncmVnYXRlIHNwZWNzIChzdHJpbmcgc2hvcnRoYW5kIG9yIG9iamVjdCkgYW5kIHZhbGlkYXRlcyBlYWNoIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBBZ2dyZWdhdGVTcGVjPn0gYWdncmVnYXRlcyAtIFJhdyBhZ2dyZWdhdGUgc3BlY3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7b3A6IEFnZ3JlZ2F0ZU9wZXJhdGlvbiwgY29sdW1uOiBzdHJpbmd9Pn0gLSBOb3JtYWxpemVkIGFnZ3JlZ2F0ZSBzcGVjcy5cbiAgICovXG4gIF9ub3JtYWxpemVBZ2dyZWdhdGVzKGFnZ3JlZ2F0ZXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHtvcDogQWdncmVnYXRlT3BlcmF0aW9uLCBjb2x1bW46IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgc3BlY10gb2YgT2JqZWN0LmVudHJpZXMoYWdncmVnYXRlcykpIHtcbiAgICAgIGNvbnN0IG9wID0gLyoqIEB0eXBlIHtBZ2dyZWdhdGVPcGVyYXRpb259ICovICgodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgPyBzcGVjIDogc3BlYy5vcCkudG9VcHBlckNhc2UoKSlcblxuICAgICAgaWYgKCFBR0dSRUdBVEVfT1BFUkFUSU9OUy5oYXMob3ApKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYWdncmVnYXRlIG9wZXJhdGlvbiBmb3IgJHtuYW1lfTogJHtvcH0uIFN1cHBvcnRlZDogJHtBcnJheS5mcm9tKEFHR1JFR0FURV9PUEVSQVRJT05TKS5qb2luKFwiLCBcIil9LmApXG4gICAgICB9XG5cbiAgICAgIG5vcm1hbGl6ZWRbbmFtZV0gPSB7Y29sdW1uOiB0eXBlb2Ygc3BlYyA9PT0gXCJzdHJpbmdcIiA/IG5hbWUgOiBzcGVjLmNvbHVtbiwgb3B9XG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxufVxuIl19