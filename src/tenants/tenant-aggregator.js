// @ts-check

import Current from "../current.js"

/**
 * @typedef {"SUM" | "COUNT" | "MAX" | "MIN"} AggregateOperation
 */

/**
 * @typedef {AggregateOperation | {op: AggregateOperation, column: string}} AggregateSpec
 */

/**
 * @typedef {object} SubqueryContext
 * @property {(tableName: string) => string} table - Quotes a table for this tenant. In a cross-database `UNION ALL` it returns a `database`.`table` qualified identifier; when each tenant runs on its own connection it returns the plain quoted table name. Use it for every table the subquery reads so the same subquery works on both execution paths.
 * @property {((value: ?) => string) & {list: (values: Array<?>) => string}} quote - Quotes a value for the active connection. `quote.list(values)` quotes and comma-joins an array for `IN (...)` clauses.
 * @property {object} tenant - The tenant descriptor this subquery is being built for.
 * @property {import("../database/drivers/base.js").default} connection - The driver the query will run on.
 */

/**
 * @typedef {object} TenantAggregateOptions
 * @property {string} identifier - Database identifier whose tenants are aggregated (for example `"projectTenant"`).
 * @property {object[]} [tenants] - Explicit tenant descriptors to aggregate. Defaults to every tenant the identifier's provider `listTenants` returns.
 * @property {(tenant: ?) => boolean} [filter] - Optional filter applied to the resolved tenant list.
 * @property {string[]} [keyColumns] - Columns the aggregate is grouped by (for example `["docker_server_id"]`). Empty means a single grand-total row.
 * @property {Record<string, AggregateSpec>} aggregates - Output column name to aggregate. `"SUM"` is shorthand for `{op: "SUM", column: <output name>}`; use `{op: "COUNT", column: "*"}` for `COUNT(*)`.
 * @property {(context: SubqueryContext) => string} subquery - Builds one tenant's inner `SELECT`, which must select every `keyColumns` entry plus every aggregate source column.
 * @property {import("../configuration.js").default} [configuration] - Configuration to run against. Defaults to the current configuration.
 */

/**
 * @typedef {{tenant: object, database: string | undefined, serverKey: string}} ResolvedTenant
 */

const AGGREGATE_OPERATIONS = new Set(["SUM", "COUNT", "MAX", "MIN"])
const DERIVED_TABLE_ALIAS = "velocious_tenant_aggregate"

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
    this.options = options
    this.configuration = options.configuration ?? Current.configuration()
    this.keyColumns = options.keyColumns ?? []
    this.aggregates = this._normalizeAggregates(options.aggregates)
  }

  /**
   * Resolves the tenant list, runs the aggregate per server, and merges everything.
   * @returns {Promise<Array<Record<string, ?>>>} - One merged row per distinct key-column combination.
   */
  async run() {
    const resolvedTenants = await this._resolveTenants()

    if (resolvedTenants.length === 0) return []

    /** @type {Array<Record<string, ?>>} */
    const rows = []

    for (const group of this._groupByServer(resolvedTenants)) {
      const groupRows = await this._runForServer(group)

      rows.push(...groupRows)
    }

    return this._mergeRows(rows)
  }

  /**
   * Resolves the tenant list (explicit or from the provider), then maps each to its server and
   * database via the tenant database resolver.
   * @returns {Promise<ResolvedTenant[]>} - Tenants to aggregate, each resolved to its server + database.
   */
  async _resolveTenants() {
    const tenants = this.options.tenants ?? await this._listProviderTenants()
    const filtered = this.options.filter ? tenants.filter(this.options.filter) : tenants

    return filtered.map((tenant) => {
      const databaseConfiguration = this.configuration.resolveDatabaseConfiguration(this.options.identifier, tenant)

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
      }
    })
  }

  /**
   * Lists every tenant for the identifier through its provider's `listTenants` hook.
   * @returns {Promise<object[]>} - Every tenant the provider lists for the identifier.
   */
  async _listProviderTenants() {
    const provider = this.configuration.getTenantDatabaseProvider(this.options.identifier)
    const listedTenants = await this.configuration.ensureConnections(
      {name: `Tenant.aggregateAcross: ${this.options.identifier}`},
      async () => await provider.listTenants({configuration: this.configuration, identifier: this.options.identifier})
    )

    if (!Array.isArray(listedTenants)) {
      throw new Error(`Tenant database provider for ${this.options.identifier} must return an array from listTenants`)
    }

    return listedTenants
  }

  /**
   * Groups tenants by the server they live on so co-located tenants can share one query.
   * @param {ResolvedTenant[]} resolvedTenants - Tenants resolved to their server.
   * @returns {ResolvedTenant[][]} - Tenants grouped by the server they live on.
   */
  _groupByServer(resolvedTenants) {
    /** @type {Map<string, ResolvedTenant[]>} */
    const groups = new Map()

    for (const resolvedTenant of resolvedTenants) {
      const group = groups.get(resolvedTenant.serverKey)

      if (group) {
        group.push(resolvedTenant)
      } else {
        groups.set(resolvedTenant.serverKey, [resolvedTenant])
      }
    }

    return Array.from(groups.values())
  }

  /**
   * Runs the aggregate for one server's tenants, using a single cross-database `UNION ALL` when the
   * driver supports it or one query per tenant otherwise. The driver capability is probed in its own
   * connection scope that is released before the fan-out runs, so a `max: 1` tenant pool is never
   * asked for a second connection while the first is still held (which would deadlock).
   * @param {ResolvedTenant[]} group - Tenants sharing one server.
   * @returns {Promise<Array<Record<string, ?>>>} - Rows produced for this server.
   */
  async _runForServer(group) {
    const [firstTenant] = group
    const supportsCrossDatabaseReferences = await this._withTenant(
      firstTenant.tenant,
      async (connections) => connections[this.options.identifier].supportsCrossDatabaseReferences()
    )

    if (supportsCrossDatabaseReferences) {
      return await this._withTenant(firstTenant.tenant, async (connections) => {
        const connection = connections[this.options.identifier]

        return await connection.query(this.buildAggregateSql({connection, entries: group, qualified: true}))
      })
    }

    /** @type {Array<Record<string, ?>>} */
    const rows = []

    for (const resolvedTenant of group) {
      const tenantRows = await this._withTenant(resolvedTenant.tenant, async (connections) => {
        const connection = connections[this.options.identifier]

        return await connection.query(this.buildAggregateSql({connection, entries: [resolvedTenant], qualified: false}))
      })

      rows.push(...tenantRows)
    }

    return rows
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
    return await this.configuration.runWithTenant(tenant, async () => await this.configuration.ensureConnections(callback))
  }

  /**
   * Builds the aggregate SQL: an outer `GROUP BY` over a `UNION ALL` of each entry's subquery.
   * @param {{connection: import("../database/drivers/base.js").default, entries: ResolvedTenant[], qualified: boolean}} args - Connection, tenants, and whether to qualify tables with their database name.
   * @returns {string} - Executable aggregate SQL.
   */
  buildAggregateSql({connection, entries, qualified}) {
    const options = connection.options()
    const quote = this._buildQuote(connection)
    const subqueries = entries.map((entry) => {
      if (qualified && !entry.database) {
        throw new Error(`Cannot build a cross-database query for a tenant without a resolved database name (identifier: ${this.options.identifier}).`)
      }

      const table = (/** @type {string} */ tableName) => qualified
        ? `${options.quoteDatabaseName(/** @type {string} */ (entry.database))}.${options.quoteTableName(tableName)}`
        : options.quoteTableName(tableName)

      return this.options.subquery({connection, quote, table, tenant: entry.tenant})
    })

    const selectParts = this.keyColumns.map((keyColumn) => options.quoteColumnName(keyColumn))

    for (const [name, spec] of Object.entries(this.aggregates)) {
      const aggregateArgument = spec.column === "*" ? "*" : options.quoteColumnName(spec.column)

      selectParts.push(`${spec.op}(${aggregateArgument}) AS ${options.quoteColumnName(name)}`)
    }

    const unionSql = subqueries.map((subquery) => `SELECT * FROM (${subquery}) ${options.quoteTableName(`${DERIVED_TABLE_ALIAS}_source`)}`).join("\nUNION ALL\n")
    const groupBySql = this.keyColumns.length > 0
      ? `\nGROUP BY ${this.keyColumns.map((keyColumn) => options.quoteColumnName(keyColumn)).join(", ")}`
      : ""

    return `SELECT ${selectParts.join(", ")}\nFROM (\n${unionSql}\n) ${options.quoteTableName(DERIVED_TABLE_ALIAS)}${groupBySql}`
  }

  /**
   * Merges rows from every server by combining each aggregate with its own operation. A `NULL`
   * aggregate value (an empty tenant's `SUM`/`MAX`/`MIN` returns `NULL` on the fan-out path) is
   * treated as "no contribution" and skipped, not coerced to `0` — otherwise an empty tenant would
   * drag a `MAX` of negatives or a `MIN` of positives to `0`. A key whose every tenant contributed
   * `NULL` stays `NULL`, matching SQL aggregate semantics over no rows.
   * @param {Array<Record<string, ?>>} rows - Rows collected from all servers/tenants.
   * @returns {Array<Record<string, ?>>} - One merged row per distinct key-column combination.
   */
  _mergeRows(rows) {
    /** @type {Map<string, Record<string, ?>>} */
    const merged = new Map()

    for (const row of rows) {
      const mapKey = JSON.stringify(this.keyColumns.map((keyColumn) => row[keyColumn]))
      let accumulator = merged.get(mapKey)

      if (!accumulator) {
        accumulator = {}

        for (const keyColumn of this.keyColumns) {
          accumulator[keyColumn] = row[keyColumn]
        }

        for (const name of Object.keys(this.aggregates)) {
          accumulator[name] = null
        }

        merged.set(mapKey, accumulator)
      }

      for (const [name, spec] of Object.entries(this.aggregates)) {
        const rawValue = row[name]

        if (rawValue === null || rawValue === undefined) continue

        const value = this._toExactNumber(rawValue)

        accumulator[name] = accumulator[name] === null ? value : this._combine(spec.op, accumulator[name], value)
      }
    }

    return Array.from(merged.values())
  }

  /**
   * Combines two non-null per-server aggregate values with the aggregate's own operation.
   * @param {AggregateOperation} op - Aggregate operation.
   * @param {number} current - Accumulated value.
   * @param {number} value - Incoming per-server value.
   * @returns {number} - Combined value.
   */
  _combine(op, current, value) {
    if (op === "MAX") return Math.max(current, value)
    if (op === "MIN") return Math.min(current, value)

    return current + value
  }

  /**
   * Converts a driver-returned aggregate value to a number, failing loudly rather than silently
   * losing precision. Drivers return exact integer aggregates (MySQL `SUM`/`COUNT`, PostgreSQL
   * `bigint`) as strings; an integer beyond `Number.MAX_SAFE_INTEGER` cannot be represented exactly
   * as a JS number, so cross-server merging would corrupt the result — throw instead. (Fractional
   * `DECIMAL`/`NUMERIC` values are still subject to normal floating-point representation.)
   * @param {?} rawValue - Value returned by the driver for an aggregate column.
   * @returns {number} - The value as a number.
   */
  _toExactNumber(rawValue) {
    const value = Number(rawValue)

    if (typeof rawValue === "string" && /^-?\d+$/.test(rawValue.trim()) && !Number.isSafeInteger(value)) {
      throw new Error(`Aggregate value ${rawValue} exceeds the safe-integer range and cannot be merged without losing precision.`)
    }

    return value
  }

  /**
   * Builds the value quoter passed to subqueries, with a `.list` helper for `IN (...)` clauses.
   * @param {import("../database/drivers/base.js").default} connection - Driver whose quoting is used.
   * @returns {((value: ?) => string) & {list: (values: Array<?>) => string}} - Value quoter with a `.list` helper.
   */
  _buildQuote(connection) {
    return Object.assign(
      (/** @type {?} */ value) => String(connection.quote(value)),
      {list: (/** @type {Array<?>} */ values) => values.map((value) => String(connection.quote(value))).join(", ")}
    )
  }

  /**
   * Normalizes the aggregate specs (string shorthand or object) and validates each operation.
   * @param {Record<string, AggregateSpec>} aggregates - Raw aggregate specs.
   * @returns {Record<string, {op: AggregateOperation, column: string}>} - Normalized aggregate specs.
   */
  _normalizeAggregates(aggregates) {
    /** @type {Record<string, {op: AggregateOperation, column: string}>} */
    const normalized = {}

    for (const [name, spec] of Object.entries(aggregates)) {
      const op = /** @type {AggregateOperation} */ ((typeof spec === "string" ? spec : spec.op).toUpperCase())

      if (!AGGREGATE_OPERATIONS.has(op)) {
        throw new Error(`Unsupported aggregate operation for ${name}: ${op}. Supported: ${Array.from(AGGREGATE_OPERATIONS).join(", ")}.`)
      }

      normalized[name] = {column: typeof spec === "string" ? name : spec.column, op}
    }

    return normalized
  }
}
