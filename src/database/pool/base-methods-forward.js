// @ts-check

/**
 * @param {typeof import("./base.js").default} PoolBase
 * @return {void}
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

  for (const forwardMethod of forwardMethods) {
    // @ts-expect-error
    PoolBase.prototype[forwardMethod] = function(...args) {
      const connection = this.getCurrentConnection()

      // @ts-expect-error
      const connectionMethod = connection[forwardMethod]

      if (!connectionMethod) throw new Error(`${forwardMethod} isn't defined on driver`)

        // @ts-expect-error
      return connection[forwardMethod](...args)
    }
  }
}
