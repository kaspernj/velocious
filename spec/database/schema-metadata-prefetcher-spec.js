// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import MssqlDriver from "../../src/database/drivers/mssql/index.js"
import SchemaMetadataPrefetcher from "../../src/database/schema-metadata-prefetcher.js"

/** @returns {Configuration} - Configuration instance for prefetch specs. */
function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

/**
 * Builds a model-class double that resolves to a fixed driver.
 * @param {object} args - Double args.
 * @param {import("../../src/database/drivers/base.js").default} args.driver - Driver the model resolves to.
 * @param {string} args.tableName - Table the model reads.
 * @returns {typeof import("../../src/database/record/index.js").default} - Model class double.
 */
function buildModelClass({driver, tableName}) {
  class PrefetchSpecModel {
    /** @returns {string} - Table name. */
    static tableName() { return tableName }

    /** @returns {string} - Translations table name. */
    static getTranslationsTableName() { return `${tableName}_translations` }

    /** @returns {import("../../src/database/drivers/base.js").default} - Driver. */
    static connection() { return driver }
  }

  return /** @type {typeof import("../../src/database/record/index.js").default} */ (/** @type {unknown} */ (PrefetchSpecModel))
}

/** MSSQL driver double that answers the table list and one batched column query. */
class BatchedMetadataDriver extends MssqlDriver {
  /** @type {string[]} */
  queries = []

  /**
   * @param {string} sql - SQL about to run.
   * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Stubbed rows.
   */
  async query(sql) {
    this.queries.push(sql)

    if (sql.includes("[INFORMATION_SCHEMA].[TABLES]")) {
      return [{TABLE_NAME: "tasks"}, {TABLE_NAME: "tasks_translations"}]
    }

    return [
      {TABLE_NAME: "tasks", COLUMN_NAME: "id", DATA_TYPE: "int", IS_NULLABLE: "NO", isIdentity: 1, isPrimaryKey: 1},
      {TABLE_NAME: "tasks", COLUMN_NAME: "name", DATA_TYPE: "nvarchar", IS_NULLABLE: "YES", isIdentity: 0, isPrimaryKey: 0},
      {TABLE_NAME: "tasks_translations", COLUMN_NAME: "id", DATA_TYPE: "int", IS_NULLABLE: "NO", isIdentity: 1, isPrimaryKey: 1}
    ]
  }
}

/** MSSQL driver double that can only read one table's columns per query. */
class PerTableMetadataDriver extends MssqlDriver {
  /** @type {string[]} */
  queries = []
  /** @type {number} */
  inFlight = 0
  /** @type {number} */
  maxInFlight = 0

  /**
   * @param {Array<import("../../src/database/drivers/base-table.js").default>} tables - Tables to load columns for.
   * @returns {Promise<null>} - Always null, forcing the per-table path.
   */
  async batchTableColumns(tables) {
    void tables

    return null
  }

  /**
   * @param {string} sql - SQL about to run.
   * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Stubbed rows.
   */
  async query(sql) {
    this.queries.push(sql)
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    this.inFlight -= 1

    if (sql.includes("[INFORMATION_SCHEMA].[TABLES]")) {
      return [{TABLE_NAME: "tasks"}, {TABLE_NAME: "tasks_translations"}]
    }

    return [{COLUMN_NAME: "id", DATA_TYPE: "int", IS_NULLABLE: "NO", isIdentity: 1, isPrimaryKey: 1}]
  }
}

describe("Database - schema metadata prefetcher", {databaseCleaning: {transaction: true}}, () => {
  it("loads every model's columns and translation columns in one query per database", async () => {
    const driver = new BatchedMetadataDriver({sqlConfig: {}})
    const configuration = buildConfiguration()
    const prefetcher = new SchemaMetadataPrefetcher({configuration})

    await prefetcher.prefetch({modelClasses: [buildModelClass({driver, tableName: "tasks"})]})

    expect(driver.queries).toHaveLength(2)

    const tasksTable = await driver.getTableByNameOrFail("tasks")
    const translationTable = await driver.getTableByNameOrFail("tasks_translations")

    expect((await tasksTable.getColumns()).map((column) => column.getName())).toEqual(["id", "name"])
    expect((await translationTable.getColumns()).map((column) => column.getName())).toEqual(["id"])
    expect(driver.queries).toHaveLength(2)
  })

  it("falls back to bounded per-table reads for drivers that cannot batch", async () => {
    const driver = new PerTableMetadataDriver({sqlConfig: {}})
    const configuration = buildConfiguration()
    const prefetcher = new SchemaMetadataPrefetcher({configuration, concurrency: 2})

    await prefetcher.prefetch({modelClasses: [buildModelClass({driver, tableName: "tasks"})]})

    // One table-list query plus one column query per table (base + translations).
    expect(driver.queries).toHaveLength(3)
    expect(driver.maxInFlight).toBeLessThanOrEqual(2)
  })

  it("leaves models whose connection cannot be resolved out of the prefetch", async () => {
    const driver = new BatchedMetadataDriver({sqlConfig: {}})
    const configuration = buildConfiguration()
    const prefetcher = new SchemaMetadataPrefetcher({configuration})

    class UnreachableModel {
      /** @returns {string} - Table name. */
      static tableName() { return "unreachable" }

      /** @returns {never} - Always throws, like a model whose database is not configured. */
      static connection() { throw new Error("No database connection") }
    }

    await prefetcher.prefetch({modelClasses: [/** @type {typeof import("../../src/database/record/index.js").default} */ (/** @type {unknown} */ (UnreachableModel))]})

    expect(driver.queries).toHaveLength(0)
  })
})
