import mysql from "mysql"
import {performance} from "node:perf_hooks"

const rowCount = Number(process.env.BENCHMARK_ROWS || 10_000)
const iterations = Number(process.env.BENCHMARK_ITERATIONS || 30)
const warmupIterations = Number(process.env.BENCHMARK_WARMUPS || 5)
const mysqlOptions = {
  database: process.env.MYSQL_DATABASE || "velocious_benchmark",
  host: process.env.MYSQL_HOST || "mariadb",
  password: process.env.MYSQL_PASSWORD || "benchmark",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "benchmark"
}

/** @param {Array<Record<string, ?>>} rows - Driver rows. @param {Array<{name: string}>} fields - Driver fields. @returns {Array<Record<string, ?>>} - Materialized rows. */
function fieldCopy(rows, fields) {
  return rows.map((row) => {
    const result = {}
    for (const field of fields) result[field.name] = row[field.name]
    return result
  })
}

/** @param {Array<Record<string, ?>>} rows - Driver rows. @returns {Array<Record<string, ?>>} - Materialized rows. */
function shallowClone(rows) {
  return rows.map((row) => ({...row}))
}

/** @param {Array<Record<string, ?>>} rows - Driver rows. @returns {Array<Record<string, ?>>} - Driver rows. */
function directRows(rows) {
  return rows
}

const strategies = {"field copy": fieldCopy, "shallow clone": shallowClone, "direct driver rows": directRows}

/** @param {import("mysql").Pool} pool - Pool. @param {string} sql - SQL. @returns {Promise<{fields: Array<{name: string}>, rows: Array<Record<string, ?>>}>} - Raw result. */
function rawQuery(pool, sql) {
  return new Promise((resolve, reject) => {
    pool.query(sql, (error, rows, fields) => {
      if (error) reject(error)
      else resolve({fields, rows})
    })
  })
}

/** @param {import("mysql").Pool} pool - Pool. @param {string} sql - SQL. @param {(rows: Array<Record<string, ?>>, fields: Array<{name: string}>) => Array<Record<string, ?>>} materialize - Strategy. @returns {Promise<Array<Record<string, ?>>>} - Rows. */
async function queryWith(pool, sql, materialize) {
  const result = await rawQuery(pool, sql)
  return materialize(result.rows, result.fields)
}

/** @param {number[]} values - Samples. @returns {number} - Median. */
function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 == 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const pool = mysql.createPool({...mysqlOptions, connectionLimit: 1, timezone: "Z"})
const tableName = `velocious_benchmark_numbers_${process.pid}`
const sql = `SELECT n AS task_id, CONCAT('task-', n) AS task_alias, IF(n % 7 = 0, NULL, n * 1.25) AS nullable_value, TIMESTAMP('2026-07-18 12:34:56') AS occurred_at, UNHEX(LPAD(HEX(n), 16, '0')) AS payload FROM ${tableName} ORDER BY n LIMIT ${rowCount}`
let tableCreated = false

try {
  await rawQuery(pool, `CREATE TABLE ${tableName} (n INT PRIMARY KEY)`)
  tableCreated = true

  const values = Array.from({length: rowCount}, (_value, index) => `(${index + 1})`)
  for (let offset = 0; offset < values.length; offset += 1_000) {
    await rawQuery(pool, `INSERT INTO ${tableName} (n) VALUES ${values.slice(offset, offset + 1_000).join(",")}`)
  }

  const raw = await rawQuery(pool, sql)
  const baseline = fieldCopy(raw.rows, raw.fields)
  const procedureRows = [[raw.rows[0]]]
  const procedureFields = [[raw.fields]]
  const procedureBaseline = fieldCopy(procedureRows, procedureFields)
  console.log(`Node ${process.version}; rows=${rowCount}; iterations=${iterations}; warmups=${warmupIterations}`)
  console.log("strategy\tmaterialization ms\tend-to-end ms\tcontract")

  const materializationSamples = Object.fromEntries(Object.keys(strategies).map((name) => [name, []]))
  const endToEndSamples = Object.fromEntries(Object.keys(strategies).map((name) => [name, []]))
  const contracts = {}

  for (const [name, strategy] of Object.entries(strategies)) {
    const candidate = strategy(raw.rows, raw.fields)
    const plain = candidate.every((row) => Object.getPrototypeOf(row) === Object.prototype)
    const isolated = candidate !== raw.rows && candidate.every((row, index) => row !== raw.rows[index])
    const valuesPreserved = JSON.stringify(candidate) === JSON.stringify(baseline)
    const procedureShapePreserved = JSON.stringify(strategy(procedureRows, procedureFields)) === JSON.stringify(procedureBaseline)
    const contract = plain && isolated && valuesPreserved && procedureShapePreserved ? "pass" : `fail (plain=${plain}, isolated=${isolated}, values=${valuesPreserved}, procedure=${procedureShapePreserved})`

    contracts[name] = contract
  }

  const strategyEntries = Object.entries(strategies)
  for (let warmup = 0; warmup < warmupIterations; warmup++) {
    for (const [, strategy] of strategyEntries) {
      strategy(raw.rows, raw.fields)
      await queryWith(pool, sql, strategy)
    }
  }

  // Rotate strategy order each round so server/cache drift does not consistently
  // favor the implementation measured first or last.
  for (let iteration = 0; iteration < iterations; iteration++) {
    const rotated = strategyEntries.slice(iteration % strategyEntries.length).concat(strategyEntries.slice(0, iteration % strategyEntries.length))
    for (const [name, strategy] of rotated) {
      let startedAt = performance.now()
      strategy(raw.rows, raw.fields)
      materializationSamples[name].push(performance.now() - startedAt)

      startedAt = performance.now()
      await queryWith(pool, sql, strategy)
      endToEndSamples[name].push(performance.now() - startedAt)
    }
  }

  for (const [name] of strategyEntries) {
    console.log(`${name}\t${median(materializationSamples[name]).toFixed(3)}\t${median(endToEndSamples[name]).toFixed(3)}\t${contracts[name]}`)
  }

  console.log("Stored-procedure note: mysql CALL returns nested result sets and an OK packet; direct rows change the legacy flat-row adapter shape and are not contract-compatible.")
} finally {
  try {
    if (tableCreated) await rawQuery(pool, `DROP TABLE ${tableName}`)
  } finally {
    await new Promise((resolve) => pool.end(resolve))
  }
}
