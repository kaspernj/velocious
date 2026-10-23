// @ts-check

import Logger from "../logger.js"

/**
 * Loads table and column metadata for a whole set of model classes up front.
 *
 * Model initialization otherwise reads each table's columns on its own, which
 * turns a boot into one catalog query per model (and per HTTP worker process).
 * Drivers that can answer for many tables in one statement are asked to do so;
 * the resulting columns are seeded into the driver's per-table schema cache, so
 * the initialization pass that follows resolves without querying at all.
 */
export default class SchemaMetadataPrefetcher {
  /**
   * Builds a prefetcher for one configuration.
   * @param {object} args - Prefetcher args.
   * @param {import("../configuration.js").default} args.configuration - Configuration owning the database connections.
   * @param {number} [args.concurrency] - Concurrency for drivers that can only read one table per query.
   * @param {import("../logger.js").default} [args.logger] - Logger for debug output.
   */
  constructor({configuration, concurrency = 8, logger}) {
    this.configuration = configuration
    this.concurrency = concurrency
    this.logger = logger || new Logger(this)
  }

  /**
   * Prefetches column metadata for every model class that has a reachable table.
   *
   * Models whose table or connection is unavailable are skipped: their
   * initialization stays deferred and will initialize lazily on first use, which
   * is the same contract the per-model initialization applies.
   * @param {{modelClasses: Array<typeof import("./record/index.js").default>}} args - Model classes to prefetch for.
   * @returns {Promise<void>}
   */
  async prefetch({modelClasses}) {
    /** @type {Map<import("./drivers/base.js").default, Map<string, import("./drivers/base-table.js").default>>} */
    const tablesByDriver = new Map()

    for (const modelClass of modelClasses) {
      const table = await this.tableFor(modelClass)

      if (!table) continue

      const driver = table.getDriver()
      let tables = tablesByDriver.get(driver)

      if (!tables) {
        tables = new Map()
        tablesByDriver.set(driver, tables)
      }

      tables.set(table.getName(), table)

      // Translated models initialize their translation class as part of the same
      // startup pass, so its table has to be part of the batch as well - otherwise
      // every translated model still costs its own catalog read.
      const translationTable = await this.tableByName(driver, modelClass.getTranslationsTableName())

      if (translationTable) tables.set(translationTable.getName(), translationTable)
    }

    const startedAt = Date.now()
    let tableCount = 0

    for (const [driver, tables] of tablesByDriver) {
      await driver.prefetchTableColumns([...tables.values()], {concurrency: this.concurrency})
      tableCount += tables.size
    }

    void this.logger.debug(() => ["schema metadata prefetched", {
      databases: tablesByDriver.size,
      durationMs: Date.now() - startedAt,
      tables: tableCount
    }])
  }

  /**
   * Resolves a model's table without initializing its record metadata.
   * @param {typeof import("./record/index.js").default} modelClass - Model class to resolve a table for.
   * @returns {Promise<import("./drivers/base-table.js").default | null>} Table, or null when it is not reachable.
   */
  async tableFor(modelClass) {
    try {
      const driver = modelClass.connection({enforceTenantDatabaseScope: false})

      return await this.tableByName(driver, modelClass.tableName())
    } catch (error) {
      // A model whose database is unreachable - or whose table is optional and
      // absent - stays deferred rather than failing startup; it initializes
      // lazily on first use.
      void this.logger.debug(() => [`Leaving ${modelClass.name} out of schema prefetch`, error])

      return null
    }
  }

  /**
   * Looks a table up in the driver's table list without throwing when absent.
   * @param {import("./drivers/base.js").default} driver - Driver owning the table.
   * @param {string} tableName - Table name to resolve.
   * @returns {Promise<import("./drivers/base-table.js").default | null>} Table, or null when it does not exist.
   */
  async tableByName(driver, tableName) {
    return await driver.getTableByName(tableName, {throwError: false}) || null
  }
}
