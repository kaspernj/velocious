import {performance} from "node:perf_hooks"
import DatabaseDriverBase from "../src/database/drivers/base.js"

class InsertChunkBenchmarkDriver extends DatabaseDriverBase {
  /**
   * Minimal insert SQL implementation for the benchmark.
   * @param {import("../src/database/drivers/base.js").InsertSqlArgsType} args - Insert args.
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

/**
 * Measures chunking for the given row count.
 * @param {number} count - Number of rows.
 * @returns {{buildSqlCalls: number, chunks: number, milliseconds: number}} - Measurement.
 */
function measure(count) {
  const driver = new InsertChunkBenchmarkDriver({maxRowsPerInsert: 1000, maxInsertSqlBytes: 1_048_576}, {})
  const rows = Array.from({length: count}, (_value, index) => [`value-${index}-${"x".repeat(64)}`])
  let buildSqlCalls = 0

  /**
   * Build SQL and count calls.
   * @param {Array<Array<ReturnType<typeof JSON.parse>>>} chunkRows - Candidate rows.
   * @returns {string} - SQL string.
   */
  const buildSql = (chunkRows) => {
    buildSqlCalls += 1

    return driver.insertSql({columns: ["payload"], rows: chunkRows, tableName: "benchmarks"})
  }

  const startedAt = performance.now()
  const chunks = driver._insertMultipleChunks(rows, buildSql)
  const milliseconds = performance.now() - startedAt

  return {buildSqlCalls, chunks: chunks.length, milliseconds}
}

console.log("rows\tbuildSqlCalls\tchunks\ttotal\tper 1k rows")

for (const count of [1_000, 10_000, 100_000]) {
  const measurement = measure(count)

  if (measurement.buildSqlCalls !== count + 1) {
    throw new Error(`Expected ${count + 1} buildSql calls, got ${measurement.buildSqlCalls}`)
  }

  console.log(`${count}\t${measurement.buildSqlCalls}\t${measurement.chunks}\t${measurement.milliseconds.toFixed(2)} ms\t${((measurement.milliseconds / count) * 1000).toFixed(4)} ms`)
}
