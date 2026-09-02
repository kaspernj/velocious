// @ts-check

/**
 * Runs base methods forward.
 * @param {typeof import("./base.js").default} PoolBase - Pool base.
 * @returns {void} - No return value.
 */
export default function baseMethodsForward(PoolBase) {
  const forwardMethods = [
    "alterTable",
    "alterTableSQLs",
    "createIndex",
    "createIndexSQLs",
    "createTable",
    "createTableSql",
    "delete",
    "deleteSql",
    "getTables",
    "insert",
    "insertSql",
    "primaryKeyType",
    "query",
    "quote",
    "quoteColumn",
    "quoteTable",
    "removeIndexSQLs",
    "select",
    "update",
    "updateSql"
  ]

  const prototype = /** @type {Record<string, (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>>} */ (/** @type {ReturnType<typeof JSON.parse>} */ (PoolBase.prototype))

  for (const forwardMethod of forwardMethods) {
    prototype[forwardMethod] = function(...args) {
      const connection = this.getCurrentConnection()
      const connectionRecord = /** @type {Record<string, (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>>} */ (/** @type {ReturnType<typeof JSON.parse>} */ (connection))
      const connectionMethod = connectionRecord[forwardMethod]

      if (!connectionMethod) throw new Error(`${forwardMethod} isn't defined on driver`)

      return connectionMethod.apply(connection, args)
    }
  }
}
