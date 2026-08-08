// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"

class InsertChunkTestDriver extends DatabaseDriverBase {
  /**
   * Minimal insert SQL implementation for the chunking tests.
   * Real chunking tests pass a custom buildSql; this just satisfies the driver contract.
   * @param {import("../../../src/database/drivers/base.js").InsertSqlArgsType} args - Insert args.
   * @returns {string} - SQL string.
   */
  insertSql(args) {
    const columnsPart = args.columns ? `(${args.columns.join(", ")})` : ""

    if (!args.rows || args.rows.length === 0) {
      return `INSERT INTO ${args.tableName}${columnsPart} VALUES`
    }

    const values = args.rows.map((row) => `(${row.join(", ")})`).join(", ")

    return `INSERT INTO ${args.tableName}${columnsPart} VALUES ${values}`
  }
}

describe("database driver base - insertMultiple chunking", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("accounts bytes incrementally and chunks by row count", () => {
    const driver = new InsertChunkTestDriver({maxRowsPerInsert: 10, maxInsertSqlBytes: 1_000_000}, Configuration.current())
    const rows = Array.from({length: 100}, (_value, index) => [index])
    let buildSqlCalls = 0

    /**
     * Build SQL and count calls.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} chunkRows - Candidate rows.
     * @returns {string} - SQL string.
     */
    const buildSql = (chunkRows) => {
      buildSqlCalls += 1

      return driver.insertSql({columns: ["a"], rows: chunkRows, tableName: "tests"})
    }

    const chunks = driver._insertMultipleChunks(rows, buildSql)

    expect(buildSqlCalls).toEqual(rows.length + 1)
    expect(chunks.length).toEqual(10)

    for (const chunk of chunks) {
      expect(chunk.length).toEqual(10)
    }
  })

  it("splits chunks when the next row would exceed the byte limit", () => {
    // Base prefix is "INSERT INTO tests(a) VALUES " (29 bytes). Each small row is "(0)" (3 bytes).
    // With a separator of ", " (2 bytes), three rows fit in 29 + 3 + 2 + 3 + 2 + 3 = 42 bytes.
    // Four rows add another "(0)" + ", " = 5 bytes -> 47, which exceeds the 45-byte limit.
    const driver = new InsertChunkTestDriver({maxRowsPerInsert: 100, maxInsertSqlBytes: 45}, Configuration.current())
    const rows = Array.from({length: 8}, (_value, index) => [index])

    /**
     * Build SQL for candidate rows.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} chunkRows - Candidate rows.
     * @returns {string} - SQL string.
     */
    const buildSql = (chunkRows) => driver.insertSql({columns: ["a"], rows: chunkRows, tableName: "tests"})

    const chunks = driver._insertMultipleChunks(rows, buildSql)

    expect(chunks.length).toEqual(2)
    expect(chunks[0].length).toEqual(3)
    expect(chunks[1].length).toEqual(5)
  })
})
