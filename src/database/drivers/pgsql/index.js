// @ts-check

import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import {Client} from "pg"
import CreateDatabase from "./sql/create-database.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import {digg} from "diggerize"
import DropTable from "./sql/drop-table.js"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import StructureSql from "./structure-sql.js"
import Upsert from "./sql/upsert.js"
import Update from "./sql/update.js"

export default class VelociousDatabaseDriversPgsql extends Base{
  async connect() {
    const client = new Client(this.connectArgs())

    try {
      await client.connect()
    } catch (error) {
      // Re-throw to recover real stack trace
      if (error instanceof Error) {
        throw new Error(`Connect to Postgres server failed: ${error.message}`, {cause: error})
      } else {
        throw new Error(`Connect to Postgres server failed: ${error}`, {cause: error})
      }
    }

    this.connection = client
  }

  async disconnect() {
    await this.connection?.end()
    this.connection = undefined
    this._transactionsCount = 0
  }

  connectArgs() {
    const args = this.getArgs()
    const forward = ["database", "host", "password", "port"]

    /** @type {Record<string, any>} */
    const connectArgs = {}

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]

    return connectArgs
  }

  async close() {
    await this.connection?.end()
    this.connection = undefined
    this._transactionsCount = 0
  }

  /**
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async alterTableSQLs(tableData) {
    const alterArgs = {tableData, driver: this}
    const alterTable = new AlterTable(alterArgs)

    return await alterTable.toSQLs()
  }

  /**
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifNotExists] - Whether if not exists.
   * @returns {string[]} - SQL statements.
   */
  createDatabaseSql(databaseName, args) {
    const createArgs = Object.assign({databaseName, driver: this}, args)
    const createDatabase = new CreateDatabase(createArgs)

    return createDatabase.toSql()
  }

  /**
   * @param {import("../base.js").CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createIndexSQLs(indexData) {
    const createArgs = Object.assign({driver: this}, indexData)
    const createIndex = new CreateIndex(createArgs)

    return await createIndex.toSQLs()
  }

  /**
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) {
    const createArgs = {tableData, driver: this, indexInCreateTable: false}
    const createTable = new CreateTable(createArgs)

    return await createTable.toSql()
  }

  async currentDatabase() {
    const rows = await this.query("SELECT CURRENT_DATABASE() AS db_name")

    return digg(rows, 0, "db_name")
  }

  async disableForeignKeys() {
    await this.query("SET session_replication_role = 'replica'")
  }

  async enableForeignKeys() {
    await this.query("SET session_replication_role = 'origin'")
  }

  /**
   * @param {string} tableName - Table name.
   * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async dropTableSQLs(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return await dropTable.toSQLs()
  }

  getType() { return "pgsql" }
  primaryKeyType() { return "bigint" }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
   */
  async _queryActual(sql) {
    let response

    if (!this.connection) await this.connect()
    if (!this.connection) throw new Error("PostgreSQL connection failed to initialize")

    try {
      response = await this.connection.query(sql)
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Query failed: ${error.message} with SQL: ${sql}`, {cause: error})
      } else {
        throw new Error(`Query failed: ${error} with SQL: ${sql}`, {cause: error})
      }
    }

    return response.rows
  }

  /**
   * @param {import("../../query/index.js").default} query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(query) { return new QueryParser({query}).toSql() }
  shouldSetAutoIncrementWhenPrimaryKey() { return true }
  supportsDefaultPrimaryKeyUUID() { return true }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The converted value.
   */
  _convertValue(value) {
    if (typeof value === "boolean") {
      return value ? "true" : "false"
    }

    return super._convertValue(value)
  }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The escape.
   */
  escape(value) {
    if (!this.connection) throw new Error("Can't escape before connected")
    if (typeof value === "number") return value

    const escapedValueWithQuotes = this.connection.escapeLiteral(this._convertValue(value))

    return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1)
  }

  /**
   * @param {any} value - Value to use.
   * @returns {string | number} - The quoted value.
   */
  quote(value) {
    if (!this.connection) throw new Error("Can't escape before connected")
    if (typeof value === "number") return value

    return this.connection.escapeLiteral(this._convertValue(value))
  }

  /**
   * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql({tableName, conditions}) {
    const deleteInstruction = new Delete({conditions, driver: this, tableName})

    return deleteInstruction.toSql()
  }

  /**
   * @abstract
   * @param {import("../base.js").InsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  insertSql(args) {
    const insertArgs = Object.assign({driver: this}, args)
    const insert = new Insert(insertArgs)

    return insert.toSql()
  }

  async getTables() {
    const result = await this.query("SELECT * FROM information_schema.tables WHERE table_catalog = CURRENT_DATABASE() AND table_schema = 'public'")
    const tables = []

    for (const row of result) {
      const table = new Table(this, /** @type {Record<string, string>} */ (row))

      tables.push(table)
    }

    return tables
  }

  async lastInsertID() {
    const result = await this.query("SELECT LASTVAL() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  options() {
    if (!this._options) this._options = new Options(this)

    return this._options
  }

  async _startTransactionAction() {
    await this.query("START TRANSACTION")
  }

  /**
   * @abstract
   * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }

  /**
   * @param {import("../base.js").UpsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  upsertSql(args) {
    const upsert = new Upsert({...args, driver: this})

    return upsert.toSql()
  }

  /**
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return await new StructureSql({driver: this}).toSql()
  }

  /**
   * Deterministically hashes a lock name into a signed 64-bit integer so it
   * can be passed to `pg_advisory_lock(bigint)`. We use a fast 64-bit FNV-1a
   * hash — the exact value does not matter, only that the same name always
   * produces the same key within a process AND across processes that share
   * the same implementation. Returns the value as a string so the caller
   * can interpolate it into SQL without losing precision to JS number
   * coercion.
   *
   * @param {string} name - Lock name.
   * @returns {string} - Signed 64-bit integer as a decimal string.
   */
  advisoryLockKey(name) {
    // FNV-1a 64-bit, computed with BigInt so we don't lose precision.
    const fnvOffsetBasis = 0xcbf29ce484222325n
    const fnvPrime = 0x00000100000001b3n
    const mask64 = 0xffffffffffffffffn
    let hash = fnvOffsetBasis

    for (let index = 0; index < name.length; index += 1) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(name.charCodeAt(index))) * fnvPrime & mask64)
    }

    // Convert unsigned 64-bit into signed by reinterpreting the top bit.
    const signed = hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash

    return signed.toString()
  }

  /**
   * Blocks until a PostgreSQL session-level advisory lock is acquired on
   * this connection. Implemented via `pg_advisory_lock(bigint)`, which has
   * no native timeout — the `timeoutMs` argument is emulated by racing a
   * `pg_try_advisory_lock` poll loop so callers on MySQL and Postgres see
   * the same contract.
   *
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
   * @returns {Promise<boolean>} - True if the lock was acquired, false if the timeout elapsed.
   */
  async acquireAdvisoryLock(name, {timeoutMs} = {}) {
    const key = this.advisoryLockKey(name)

    if (typeof timeoutMs !== "number" || timeoutMs < 0) {
      await this.query(`SELECT pg_advisory_lock(${key})`)
      return true
    }

    const deadline = Date.now() + timeoutMs
    const pollIntervalMs = 50

    while (true) {
      if (await this.tryAcquireAdvisoryLock(name)) return true
      if (Date.now() >= deadline) return false

      const remaining = deadline - Date.now()

      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)))
    }
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
   */
  async tryAcquireAdvisoryLock(name) {
    const key = this.advisoryLockKey(name)
    const rows = await this.query(`SELECT pg_try_advisory_lock(${key}) AS velocious_advisory_lock_result`)
    const result = rows?.[0]?.velocious_advisory_lock_result

    return result === true || result === "t" || result === 1 || result === "1"
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was held by this session and has now been released.
   */
  async releaseAdvisoryLock(name) {
    const key = this.advisoryLockKey(name)
    const rows = await this.query(`SELECT pg_advisory_unlock(${key}) AS velocious_advisory_lock_result`)
    const result = rows?.[0]?.velocious_advisory_lock_result

    return result === true || result === "t" || result === 1 || result === "1"
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if any session currently holds the lock.
   */
  async isAdvisoryLockHeld(name) {
    const key = this.advisoryLockKey(name)
    const rows = await this.query(
      `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND ((classid::bigint << 32) | (objid::bigint & 4294967295)) = ${key}) AS velocious_advisory_lock_held`
    )
    const held = rows?.[0]?.velocious_advisory_lock_held

    return held === true || held === "t" || held === 1 || held === "1"
  }
}
