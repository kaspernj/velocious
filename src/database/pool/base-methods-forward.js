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
    "select",
    "update",
    "updateSql"
  ]

  const prototype = /**
                     * Narrows the runtime value to the documented type.
                     * @type {Record<string, (...args: Array<?>) => ?>} */ (/**
                                                                            * Narrows the runtime value to the documented type.
                                                                            * @type {?} */ (PoolBase.prototype))

  for (const forwardMethod of forwardMethods) {
    prototype[forwardMethod] = function(...args) {
      const connection = this.getCurrentConnection()
      const connectionRecord = /**
                                * Narrows the runtime value to the documented type.
                                * @type {Record<string, (...args: Array<?>) => ?>} */ (/**
                                                                                       * Narrows the runtime value to the documented type.
                                                                                       * @type {?} */ (connection))
      const connectionMethod = connectionRecord[forwardMethod]

      if (!connectionMethod) throw new Error(`${forwardMethod} isn't defined on driver`)

      return connectionMethod.apply(connection, args)
    }
  }
}
