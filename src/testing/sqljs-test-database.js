// @ts-check

import queryWeb from "../database/drivers/sqlite/query.web.js"

/**
 * Recreates an in-memory SQL.js test database from a captured schema baseline
 * after a quarantined connection is closed.
 */
export default class SqljsTestDatabase {
  /**
   * Runs constructor.
   * @param {{createDatabase: (data?: Uint8Array) => import("sql.js").Database}} args - Database factory.
   */
  constructor({createDatabase}) {
    this.createDatabase = createDatabase
    /** @type {Uint8Array | undefined} */
    this.baseline = undefined
    /** @type {import("sql.js").Database | undefined} */
    this.currentDatabase = undefined
    /** @type {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>} | undefined} */
    this.currentConnection = undefined
  }

  /**
   * Gets the current database.
   * @returns {import("sql.js").Database} - Current database.
   */
  database() {
    this.currentDatabase ??= this.createDatabase(this.baseline)
    return this.currentDatabase
  }

  /** Captures the current migrated database as the recreation baseline. */
  captureBaseline() {
    this.baseline = this.database().export()
  }

  /**
   * Gets the current connection, recreating it from the schema baseline after quarantine.
   * @returns {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} - Connection wrapper.
   */
  connection() {
    if (this.currentConnection) return this.currentConnection

    const database = this.database()
    let closed = false
    const assertOpen = () => {
      if (closed) throw new Error("SQL.js test database connection is closed")
    }
    /** @type {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} */
    const connection = {
      query: async (sql) => {
        assertOpen()
        return await queryWeb(database, sql)
      },
      affectedRows: async (sql) => {
        assertOpen()
        await queryWeb(database, sql)
        return /** @type {import("sql.js").Database & {getRowsModified: () => number}} */ (database).getRowsModified()
      },
      close: async () => {
        if (closed) return
        closed = true
        if (this.currentConnection === connection) this.currentConnection = undefined
        if (this.currentDatabase === database) this.currentDatabase = undefined
        database.close()
      }
    }

    this.currentConnection = connection
    return connection
  }
}
