// @ts-check

import DatabaseDriverBase from "../../../src/database/drivers/base.js"

class InsertChunkTestDriver extends DatabaseDriverBase {
  /**
   * Minimal insert SQL implementation for the chunking tests.
   *
   * Matches the real driver contract: an empty row set returns the statement
   * without the `VALUES` clause so `_insertMultipleChunks` can measure the
   * prefix and each row's values tuple separately.
   * @param {import("../../../src/database/drivers/base.js").InsertSqlArgsType} args - Insert args.
   * @returns {string} - SQL string.
   */
  insertSql(args) {
    const columnsPart = args.columns ? `(${args.columns.map((column) => `"${column}"`).join(", ")})` : ""
    let sql = `INSERT INTO "${args.tableName}"${columnsPart}`

    if (!args.rows || args.rows.length === 0) {
      return sql
    }

    const values = args.rows.map((row) => `(${row.join(", ")})`).join(", ")

    return `${sql} VALUES ${values}`
  }
}

describe("database driver base - insertMultiple chunking", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("accounts bytes incrementally and chunks by row count", () => {
    const driver = new InsertChunkTestDriver({maxRowsPerInsert: 10, maxInsertSqlBytes: 1_000_000}, {})
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
    // Prefix is `INSERT INTO "tests"("a") VALUES ` (32 bytes). Each small row is "(0)" (3 bytes).
    // With a separator of ", " (2 bytes), three rows produce 32 + 3 + 2 + 3 + 2 + 3 = 45 bytes,
    // which exactly fits; four rows exceed the limit, so the fourth row starts a new chunk.
    const driver = new InsertChunkTestDriver({maxRowsPerInsert: 100, maxInsertSqlBytes: 45}, {})
    const rows = Array.from({length: 8}, (_value, index) => [index])

    /**
     * Build SQL for candidate rows.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} chunkRows - Candidate rows.
     * @returns {string} - SQL string.
     */
    const buildSql = (chunkRows) => driver.insertSql({columns: ["a"], rows: chunkRows, tableName: "tests"})

    const chunks = driver._insertMultipleChunks(rows, buildSql)

    expect(chunks.length).toEqual(3)
    expect(chunks[0].length).toEqual(3)
    expect(chunks[1].length).toEqual(3)
    expect(chunks[2].length).toEqual(2)
  })

  it("chunks without Node's Buffer global so browser and React Native bundles work", () => {
    const bufferGlobal = globalThis.Buffer

    // Simulate the browser/RN bundle environment where no Buffer polyfill exists.
    // @ts-expect-error - the global is deleted deliberately and restored in finally.
    delete globalThis.Buffer

    try {
      const driver = new InsertChunkTestDriver({maxRowsPerInsert: 10, maxInsertSqlBytes: 1_000_000}, {})
      const rows = Array.from({length: 25}, (_value, index) => [index])
      const chunks = driver._insertMultipleChunks(rows, (chunkRows) => driver.insertSql({columns: ["a"], rows: chunkRows, tableName: "tests"}))

      expect(chunks.length).toEqual(3)
      expect(chunks[0]).toHaveLength(10)
      expect(chunks[2]).toHaveLength(5)
    } finally {
      globalThis.Buffer = bufferGlobal
    }
  })
})
