// @ts-check

import MssqlColumn from "../../../../src/database/drivers/mssql/column.js"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import MssqlTable from "../../../../src/database/drivers/mssql/table.js"
import { describe, expect, it } from "../../../../src/testing/test.js"

describe("database/drivers/mssql/column primary-key metadata", {databaseCleaning: {transaction: true}}, () => {
  it("distinguishes primary-key membership from identity generation", () => {
    const table = new MssqlTable(new MssqlDriver({sqlConfig: {}}), {TABLE_NAME: "background_job_schedule_order_watermarks"})
    const column = new MssqlColumn(table, {
      CHARACTER_MAXIMUM_LENGTH: 255,
      COLUMN_DEFAULT: null,
      COLUMN_NAME: "schedule_key",
      DATA_TYPE: "nvarchar",
      IS_NULLABLE: "NO",
      isIdentity: 0,
      isPrimaryKey: 1
    })

    expect(column.getAutoIncrement()).toEqual(false)
    expect(column.getPrimaryKey()).toEqual(true)
  })

  it("loads primary-key membership with MSSQL column metadata", async () => {
    class MetadataDriver extends MssqlDriver {
      /** @type {string[]} */
      queries = []

      async query(sql) {
        this.queries.push(sql)

        return []
      }
    }

    const driver = new MetadataDriver({sqlConfig: {}})
    const table = new MssqlTable(driver, {TABLE_NAME: "background_job_schedule_order_watermarks"})

    await table.getColumns()

    expect(driver.queries).toHaveLength(1)
    expect(driver.queries[0]).toContain("AS isPrimaryKey")
  })
})
