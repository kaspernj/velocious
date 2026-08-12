// @ts-check

import SharedTransactionBrokerClient from "./shared-transaction-broker-client.js"

export const SHARED_TRANSACTION_BROKER_ENV = "VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER"
export const BACKGROUND_JOB_CHILD_ENV = "VELOCIOUS_BACKGROUND_JOB_CHILD"

/**
 * Escapes a PostgreSQL literal without requiring a live child connection.
 * @param {ReturnType<typeof JSON.parse>} value - PostgreSQL literal value.
 * @returns {string} - Quoted literal.
 */
function pgEscapeLiteral(value) {
  const string = typeof value === "string" ? value : String(value)
  let escaped = "'"
  let hasBackslash = false

  for (const character of string) {
    if (character === "'") escaped += character
    if (character === "\\") {
      escaped += character
      hasBackslash = true
    }
    escaped += character
  }

  escaped += "'"
  return hasBackslash ? ` E${escaped}` : escaped
}

/**
 * Parses the test-runner-owned child transport configuration when this logical
 * database is registered for the active attempt.
 * @param {string} databaseIdentifier - Logical database identifier.
 * @returns {{address: string, capability: string} | undefined} - Broker coordinates.
 */
export function sharedTransactionBrokerConfig(databaseIdentifier) {
  if (process.env[BACKGROUND_JOB_CHILD_ENV] !== "1") return undefined
  const serialized = process.env[SHARED_TRANSACTION_BROKER_ENV]
  if (!serialized) return undefined

  const config = /** @type {{address?: ReturnType<typeof JSON.parse>, capability?: ReturnType<typeof JSON.parse>, databaseIdentifiers?: ReturnType<typeof JSON.parse>}} */ (JSON.parse(Buffer.from(serialized, "base64url").toString("utf8")))
  if (typeof config.address !== "string" || typeof config.capability !== "string" || !Array.isArray(config.databaseIdentifiers)) {
    throw new Error("Invalid shared transaction broker child configuration")
  }
  if (!config.databaseIdentifiers.includes(databaseIdentifier)) return undefined

  return {address: config.address, capability: config.capability}
}

/**
 * Creates a concrete-driver subclass that retains all local SQL/query/model
 * builders while forwarding only physical connection actions to the parent.
 * @param {typeof import("../database/drivers/base.js").default} DriverClass - Configured concrete driver.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} config - Database configuration.
 * @param {import("../configuration.js").default} configuration - Child configuration.
 * @param {string} databaseIdentifier - Logical identifier.
 * @param {{address: string, capability: string}} brokerConfig - Broker coordinates.
 * @returns {import("../database/drivers/base.js").default} - Unconnected physical proxy.
 */
export function createSharedTransactionProxyDriver(DriverClass, config, configuration, databaseIdentifier, brokerConfig) {
  class SharedTransactionProxyDriver extends DriverClass {
    constructor() {
      super(config, configuration)
      this.sharedTransactionClient = new SharedTransactionBrokerClient({...brokerConfig, databaseIdentifier})
      /** @type {string | undefined} */
      this.sharedTransactionRootSavePoint = undefined
    }

    /**
     * Connects the proxy transport.
     * @returns {Promise<void>} - Resolves when connected.
     */
    async connect() { await this.sharedTransactionClient.connected() }
    /**
     * Closes only the proxy transport.
     * @returns {Promise<void>} - Resolves when closed.
     */
    async _close() { await this.sharedTransactionClient.close() }
    /**
     * Routes a physical query.
     * @param {string} sql - SQL statement.
     * @returns {Promise<import("../database/drivers/base.js").QueryResultType>} - Rows.
     */
    async _queryActual(sql) { return await this.sharedTransactionClient.call("_queryActual", [sql]) }
    /**
     * Routes an affected-row query.
     * @param {string} sql - SQL statement.
     * @returns {Promise<number>} - Affected rows.
     */
    async _affectedRowsActual(sql) { return await this.sharedTransactionClient.call("_affectedRowsActual", [sql]) }

    /**
     * Starts a child transaction as a parent savepoint.
     * @returns {Promise<void>} - Resolves when started.
     */
    async _startTransactionAction() {
      this.sharedTransactionRootSavePoint = this.generateSavePointName()
      await this.sharedTransactionClient.call("startSavePoint", [this.sharedTransactionRootSavePoint])
    }

    /**
     * Releases the child transaction savepoint.
     * @returns {Promise<void>} - Resolves when released.
     */
    async _commitTransactionAction() {
      if (!this.sharedTransactionRootSavePoint) throw new Error("Shared transaction proxy has no root savepoint")
      await this.sharedTransactionClient.call("releaseSavePoint", [this.sharedTransactionRootSavePoint])
      this.sharedTransactionRootSavePoint = undefined
    }

    /**
     * Rolls back the child transaction savepoint.
     * @returns {Promise<void>} - Resolves when rolled back.
     */
    async _rollbackTransactionAction() {
      if (!this.sharedTransactionRootSavePoint) throw new Error("Shared transaction proxy has no root savepoint")
      await this.sharedTransactionClient.call("rollbackSavePoint", [this.sharedTransactionRootSavePoint])
      this.sharedTransactionRootSavePoint = undefined
    }

    /**
     * Escapes a local SQL value.
     * @param {ReturnType<typeof JSON.parse>} value - SQL value.
     * @returns {ReturnType<typeof JSON.parse>} - Escaped value.
     */
    escape(value) {
      if (this.getType() !== "pgsql") return super.escape(value)
      if (typeof value === "number") return value
      const escaped = pgEscapeLiteral(this._convertValue(value))
      return escaped.slice(1, -1)
    }

    /**
     * Quotes a local SQL value.
     * @param {ReturnType<typeof JSON.parse>} value - SQL value.
     * @returns {string | number} - Quoted value.
     */
    quote(value) {
      if (this.getType() !== "pgsql") return super.quote(value)
      if (typeof value === "number") return value
      return pgEscapeLiteral(this._convertValue(value))
    }

    /**
     * Streams brokered rows through the driver's buffered fallback.
     * @param {string} sql - SQL statement.
     * @param {import("../database/drivers/base.js").QueryOptions} [options] - Query options.
     * @yields {Record<string, ReturnType<typeof JSON.parse>>} - Result rows.
     */
    async *queryStream(sql, options = {}) {
      const rows = await this.query(sql, options)
      for (const row of rows) yield row
    }

    /**
     * Keeps structure SQL on normal brokered statements.
     * @returns {Promise<boolean>} - Always false.
     */
    async execStructureScript() { return false }
  }

  return new SharedTransactionProxyDriver()
}
