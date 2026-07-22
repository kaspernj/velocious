// @ts-check

import splitSqlStatements from "../utils/split-sql-statements.js"

/**
 * Loads a database structure SQL dump into a connection in one pass. Foreign keys are
 * disabled around the load so tables can be created in any order, and the driver's
 * native multi-statement `exec` is used when available (a single round-trip) instead
 * of issuing every statement separately. This is much faster than materializing a
 * schema table by table (e.g. cloning), so it is the preferred way to provision a
 * tenant/test database from a structure dump.
 *
 * Used by the `db:schema:load` CLI command and reusable by any caller that needs to
 * apply a structure dump to a specific connection.
 */
export default class StructureSqlLoader {
  /**
   * Loads `structureSql` into `db`.
   * @param {object} args - Options object.
   * @param {import("./drivers/base.js").default} args.db - Target database connection.
   * @param {string} args.structureSql - Structure SQL to load.
   * @returns {Promise<void>} - Resolves when the structure has been loaded.
   */
  async load({db, structureSql}) {
    const statements = splitSqlStatements(structureSql)

    if (statements.length == 0) return

    const executableConnection = this.executableConnection(db)

    await db.disableForeignKeys()

    try {
      // Prefer a single round-trip for the whole dump: a driver-native multi-statement
      // batch (e.g. MySQL with `multipleStatements`) first, then a native `exec`
      // connection (e.g. SQLite), and finally per-statement execution. Running the
      // whole dump at once is far faster than issuing every CREATE separately.
      if (!await db.execStructureScript(structureSql)) {
        if (executableConnection) {
          await executableConnection.exec(structureSql)
        } else {
          for (const statement of statements) {
            await db.query(statement)
          }
        }
      }
    } finally {
      await db.enableForeignKeys()

      // The batch / native `exec` paths mutate the schema outside `Base#query`, so the
      // usual post-DDL schema-cache invalidation never runs. Clear it here so a
      // caller that read schema metadata before provisioning (e.g. an empty table
      // list) does not keep seeing the pre-load schema afterwards. Harmless for the
      // per-statement path, which already invalidates as each DDL statement runs.
      db.clearSchemaCache()
    }
  }

  /**
   * Returns the underlying connection when it exposes a native multi-statement
   * `exec` (a single round-trip for the whole dump), otherwise undefined so the
   * caller falls back to per-statement execution.
   * @param {import("./drivers/base.js").default} db - Database connection.
   * @returns {{exec: (sql: string) => Promise<?>} | undefined} - Connection with exec support.
   */
  executableConnection(db) {
    const dbWithConnection = /** @type {import("./drivers/base.js").default & {connection?: ?}} */ (db)
    const connection = dbWithConnection.connection

    if (connection && typeof connection == "object" && "exec" in connection && typeof connection.exec == "function") {
      return /** @type {{exec: (sql: string) => Promise<?>}} */ (connection)
    }
  }
}
