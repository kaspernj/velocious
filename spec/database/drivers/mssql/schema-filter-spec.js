// @ts-check

import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import { describe, expect, it } from "../../../../src/testing/test.js"

describe("Database - drivers - mssql schema filter", () => {
  it("applies the schema when provided", async () => {
    const driver = new MssqlDriver({schema: "pyt18", sqlConfig: {}}, {debug: false})
    let lastSql = null

    driver.query = async (sql) => {
      lastSql = sql
      return []
    }

    await driver.getTables()

    expect(lastSql).toContain("[TABLE_SCHEMA] = 'pyt18'")
  })

  it("omits the schema clause when not provided", async () => {
    const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})
    let lastSql = null

    driver.query = async (sql) => {
      lastSql = sql
      return []
    }

    await driver.getTables()

    expect(lastSql).toContain("[TABLE_SCHEMA] = SCHEMA_NAME()")
  })

  it("uses schema from options", async () => {
    const driver = new MssqlDriver({options: {schema: "pyt18"}, sqlConfig: {}}, {debug: false})
    let lastSql = null

    driver.query = async (sql) => {
      lastSql = sql
      return [{TABLE_NAME: "ArtikelKuenstler"}]
    }

    await driver.getTableByName("ArtikelKuenstler")

    expect(lastSql).toContain("[TABLE_SCHEMA] = 'pyt18'")
  })
})
