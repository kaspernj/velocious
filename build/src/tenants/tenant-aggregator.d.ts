export type AggregateOperation = "SUM" | "COUNT" | "MAX" | "MIN";
export type AggregateSpec = AggregateOperation | {
    op: AggregateOperation;
    column: string;
};
export type SubqueryContext = {
    /**
     * - Quotes a table for this tenant. In a cross-database `UNION ALL` it returns a `database`.`table` qualified identifier; when each tenant runs on its own connection it returns the plain quoted table name. Use it for every table the subquery reads so the same subquery works on both execution paths.
     */
    table: (tableName: string) => string;
    /**
     * - Quotes a value for the active connection. `quote.list(values)` quotes and comma-joins an array for `IN (...)` clauses.
     */
    quote: ((value: ReturnType<typeof JSON.parse>) => string) & {
        list: (values: Array<ReturnType<typeof JSON.parse>>) => string;
    };
    /**
     * - The tenant descriptor this subquery is being built for.
     */
    tenant: object;
    /**
     * - The driver the query will run on.
     */
    connection: import("../database/drivers/base.js").default;
};
export type TenantAggregateOptions = {
    /**
     * - Database identifier whose tenants are aggregated (for example `"projectTenant"`).
     */
    identifier: string;
    /**
     * - Explicit tenant descriptors to aggregate. Defaults to every tenant the identifier's provider `listTenants` returns.
     */
    tenants?: object[];
    /**
     * - Optional filter applied to the resolved tenant list.
     */
    filter?: (tenant: ReturnType<typeof JSON.parse>) => boolean;
    /**
     * - Columns the aggregate is grouped by (for example `["docker_server_id"]`). Empty means a single grand-total row.
     */
    keyColumns?: string[];
    /**
     * - Output column name to aggregate. `"SUM"` is shorthand for `{op: "SUM", column: <output name>}`; use `{op: "COUNT", column: "*"}` for `COUNT(*)`.
     */
    aggregates: Record<string, AggregateSpec>;
    /**
     * - Signal passed to each aggregate database query.
     */
    signal?: AbortSignal;
    /**
     * - Builds one tenant's inner `SELECT`, which must select every `keyColumns` entry plus every aggregate source column.
     */
    subquery: (context: SubqueryContext) => string;
    /**
     * - Configuration to run against. Defaults to the current configuration.
     */
    configuration?: import("../configuration.js").default;
};
export type ResolvedTenant = {
    tenant: object;
    database: string | undefined;
    serverKey: string;
};
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
    options: TenantAggregateOptions;
    configuration: import("../configuration.js").default;
    keyColumns: string[];
    aggregates: Record<string, {
        op: AggregateOperation;
        column: string;
    }>;
    /**
     * Prepares an aggregate run, normalizing the aggregate specs up front.
     * @param {TenantAggregateOptions} options - Aggregate configuration.
     */
    constructor(options: TenantAggregateOptions);
    /**
     * Resolves the tenant list, runs the aggregate per server, and merges everything.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - One merged row per distinct key-column combination.
     */
    run(): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * Resolves the tenant list (explicit or from the provider), then maps each to its server and
     * database via the tenant database resolver.
     * @returns {Promise<ResolvedTenant[]>} - Tenants to aggregate, each resolved to its server + database.
     */
    _resolveTenants(): Promise<ResolvedTenant[]>;
    /**
     * Lists every tenant for the identifier through its provider's `listTenants` hook.
     * @returns {Promise<object[]>} - Every tenant the provider lists for the identifier.
     */
    _listProviderTenants(): Promise<object[]>;
    /**
     * Groups tenants by the server they live on so co-located tenants can share one query.
     * @param {ResolvedTenant[]} resolvedTenants - Tenants resolved to their server.
     * @returns {ResolvedTenant[][]} - Tenants grouped by the server they live on.
     */
    _groupByServer(resolvedTenants: ResolvedTenant[]): ResolvedTenant[][];
    /**
     * Runs the aggregate for one server's tenants, using a single cross-database `UNION ALL` when the
     * driver supports it or one query per tenant otherwise. The driver capability is probed in its own
     * connection scope that is released before the fan-out runs, so a `max: 1` tenant pool is never
     * asked for a second connection while the first is still held (which would deadlock).
     * @param {ResolvedTenant[]} group - Tenants sharing one server.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Rows produced for this server.
     */
    _runForServer(group: ResolvedTenant[]): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * Runs `callback` inside a tenant's context with its connections established, mirroring
     * `Tenant.with` without importing it (which would create an import cycle).
     * @template T
     * @param {object} tenant - Tenant descriptor to switch into.
     * @param {(connections: Record<string, import("../database/drivers/base.js").default>) => Promise<T>} callback - Operation to run with the tenant's active connections.
     * @returns {Promise<T>} - Callback result from within the tenant context.
     */
    _withTenant<T>(tenant: object, callback: (connections: Record<string, import("../database/drivers/base.js").default>) => Promise<T>): Promise<T>;
    /**
     * Builds the aggregate SQL: an outer `GROUP BY` over a `UNION ALL` of each entry's subquery.
     * @param {{connection: import("../database/drivers/base.js").default, entries: ResolvedTenant[], qualified: boolean}} args - Connection, tenants, and whether to qualify tables with their database name.
     * @returns {string} - Executable aggregate SQL.
     */
    buildAggregateSql({ connection, entries, qualified }: {
        connection: import("../database/drivers/base.js").default;
        entries: ResolvedTenant[];
        qualified: boolean;
    }): string;
    /**
     * Merges rows from every server by combining each aggregate with its own operation. A `NULL`
     * aggregate value (an empty tenant's `SUM`/`MAX`/`MIN` returns `NULL` on the fan-out path) is
     * treated as "no contribution" and skipped, not coerced to `0` — otherwise an empty tenant would
     * drag a `MAX` of negatives or a `MIN` of positives to `0`. A key whose every tenant contributed
     * `NULL` stays `NULL`, matching SQL aggregate semantics over no rows.
     * @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} rows - Rows collected from all servers/tenants.
     * @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} - One merged row per distinct key-column combination.
     */
    _mergeRows(rows: Array<Record<string, ReturnType<typeof JSON.parse>>>): Array<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Combines two non-null per-server aggregate values with the aggregate's own operation.
     * @param {AggregateOperation} op - Aggregate operation.
     * @param {number} current - Accumulated value.
     * @param {number} value - Incoming per-server value.
     * @returns {number} - Combined value.
     */
    _combine(op: AggregateOperation, current: number, value: number): number;
    /**
     * Converts a driver-returned aggregate value to a number, failing loudly rather than silently
     * losing precision. Drivers return exact integer aggregates (MySQL `SUM`/`COUNT`, PostgreSQL
     * `bigint`) as strings; an integer beyond `Number.MAX_SAFE_INTEGER` cannot be represented exactly
     * as a JS number, so cross-server merging would corrupt the result — throw instead. (Fractional
     * `DECIMAL`/`NUMERIC` values are still subject to normal floating-point representation.)
     * @param {ReturnType<typeof JSON.parse>} rawValue - Value returned by the driver for an aggregate column.
     * @returns {number} - The value as a number.
     */
    _toExactNumber(rawValue: ReturnType<typeof JSON.parse>): number;
    /**
     * Builds the value quoter passed to subqueries, with a `.list` helper for `IN (...)` clauses.
     * @param {import("../database/drivers/base.js").default} connection - Driver whose quoting is used.
     * @returns {((value: ReturnType<typeof JSON.parse>) => string) & {list: (values: Array<ReturnType<typeof JSON.parse>>) => string}} - Value quoter with a `.list` helper.
     */
    _buildQuote(connection: import("../database/drivers/base.js").default): ((value: ReturnType<typeof JSON.parse>) => string) & {
        list: (values: Array<ReturnType<typeof JSON.parse>>) => string;
    };
    /**
     * Normalizes the aggregate specs (string shorthand or object) and validates each operation.
     * @param {Record<string, AggregateSpec>} aggregates - Raw aggregate specs.
     * @returns {Record<string, {op: AggregateOperation, column: string}>} - Normalized aggregate specs.
     */
    _normalizeAggregates(aggregates: Record<string, AggregateSpec>): Record<string, {
        op: AggregateOperation;
        column: string;
    }>;
}
//# sourceMappingURL=tenant-aggregator.d.ts.map