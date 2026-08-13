// @ts-check

import Configuration from "../../../src/configuration.js"
import MssqlDriver from "../../../src/database/drivers/mssql/index.js"
import MysqlDriver from "../../../src/database/drivers/mysql/index.js"
import PgsqlDriver from "../../../src/database/drivers/pgsql/index.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import { NamedTestTable } from "../../helpers/truncate-all-tables-test-helper.js"

class CountingTestTable extends NamedTestTable {
  truncateCalls = 0

  /** @returns {Promise<[]>} - Empty query result. */
  async truncate() {
    this.truncateCalls++
    return []
  }
}

class RecordingPgsqlDriver extends PgsqlDriver {
  /** @type {string[]} */
  queries = []

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<[]>} - Empty result.
   */
  async query(sql) { this.queries.push(sql); return [] }
}

class RecordingMssqlDriver extends MssqlDriver {
  /** @type {string[]} */
  queries = []

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<[]>} - Empty result.
   */
  async query(sql) { this.queries.push(sql); return [] }
}

class RecordingMysqlDriver extends MysqlDriver {
  /** @type {string[]} */
  queries = []

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<[]>} - Empty result.
   */
  async query(sql) { this.queries.push(sql); return [] }
}

describe("database - drivers - truncate tables - driver SQL", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("builds the driver-specific batch without changing identity or fallback semantics", async () => {
    const configuration = Configuration.current()
    const pgsql = new RecordingPgsqlDriver({}, configuration)
    const pgsqlTables = [new CountingTestTable({driver: pgsql, name: "one"}), new CountingTestTable({driver: pgsql, name: "two"})]

    await pgsql.truncateTables(pgsqlTables)

    expect(pgsql.queries).toEqual(['TRUNCATE TABLE "one", "two" CASCADE'])
    expect(pgsql.queries[0].includes("RESTART IDENTITY")).toEqual(false)

    const mssql = new RecordingMssqlDriver({sqlConfig: {}}, configuration)
    const mssqlTables = [new CountingTestTable({driver: mssql, name: "one"}), new CountingTestTable({driver: mssql, name: "two"})]

    await mssql.truncateTables(mssqlTables)

    expect(mssql.queries.length).toEqual(1)
    expect(mssql.queries[0].match(/TRUNCATE TABLE/gu)?.length).toEqual(2)
    expect(mssql.queries[0].match(/ERROR_NUMBER\(\) = 4712/gu)?.length).toEqual(2)
    expect(mssql.queries[0].match(/DELETE FROM/gu)?.length).toEqual(2)
    expect(mssql.queries[0].match(/THROW/gu)?.length).toEqual(2)

    const mysqlBatched = new RecordingMysqlDriver({multipleStatements: true}, configuration)
    const mysqlBatchedTables = [new CountingTestTable({driver: mysqlBatched, name: "one"}), new CountingTestTable({driver: mysqlBatched, name: "two"})]

    await mysqlBatched.truncateTables(mysqlBatchedTables)

    expect(mysqlBatched.queries).toEqual(["TRUNCATE TABLE `one`;\nTRUNCATE TABLE `two`"])
    expect(mysqlBatchedTables.map((table) => table.truncateCalls)).toEqual([0, 0])

    const mysqlSequential = new RecordingMysqlDriver({multipleStatements: false}, configuration)
    const mysqlSequentialTables = [new CountingTestTable({driver: mysqlSequential, name: "one"}), new CountingTestTable({driver: mysqlSequential, name: "two"})]

    await mysqlSequential.truncateTables(mysqlSequentialTables)

    expect(mysqlSequential.queries).toEqual([])
    expect(mysqlSequentialTables.map((table) => table.truncateCalls)).toEqual([1, 1])
  })
})
