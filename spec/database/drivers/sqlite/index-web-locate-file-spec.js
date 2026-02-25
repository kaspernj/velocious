import SqliteWebDriver from "../../../../src/database/drivers/sqlite/index.web.js"

describe("database - sqlite web driver - locateFile", () => {
  it("uses packaged sql-wasm by default", () => {
    const driver = new SqliteWebDriver({name: "test-db"}, {debug: false})
    const locateFile = driver.sqlJsLocateFile()
    const sqlWasmFile = locateFile("sql-wasm.wasm")

    expect(sqlWasmFile).toContain("database/drivers/sqlite/sql/sql-wasm.wasm")
  })

  it("uses custom locateFile callback when provided", () => {
    const locateFileResolver = (file) => `/assets/sqljs/${file}`
    const driver = new SqliteWebDriver({locateFile: locateFileResolver, name: "test-db"}, {debug: false})
    const locateFile = driver.sqlJsLocateFile()
    const sqlWasmFile = locateFile("sql-wasm.wasm")

    expect(sqlWasmFile).toBe("/assets/sqljs/sql-wasm.wasm")
  })
})
