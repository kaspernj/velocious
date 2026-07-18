import query from "../../../../src/database/drivers/mysql/query.js"

class DriverRow {
  constructor(values) {
    Object.assign(this, values)
  }
}

/**
 * Builds a pool that returns one predetermined driver response.
 * @param {Array<DriverRow | Array<DriverRow>>} results - Driver results.
 * @param {Array<{name: string}> | Array<Array<{name: string}>>} fields - Driver fields.
 * @returns {import("mysql").Pool} - Pool-shaped test double.
 */
function poolReturning(results, fields) {
  return /** @type {import("mysql").Pool} */ ({
    query(_sql, callback) {
      callback(null, results, fields)
    }
  })
}

describe("Database - Drivers - Mysql - Query", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("materializes selected fields as isolated plain records", async () => {
    const date = new Date("2026-07-18T12:34:56.000Z")
    const buffer = Buffer.from([0, 1, 2, 255])
    const driverRow = new DriverRow({aliased_name: "task", ignored: "driver metadata", nullable: null, occurred_at: date, payload: buffer})
    const pool = poolReturning([driverRow], [
      {name: "aliased_name"},
      {name: "nullable"},
      {name: "occurred_at"},
      {name: "payload"}
    ])

    const rows = await query(pool, "SELECT contract fields")

    expect(rows).toEqual([{aliased_name: "task", nullable: null, occurred_at: date, payload: buffer}])
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype)
    expect(rows[0].occurred_at).toBe(date)
    expect(rows[0].payload).toBe(buffer)

    rows[0].aliased_name = "changed"
    expect(driverRow.aliased_name).toBe("task")
  })

  it("uses field order while preserving the last value for duplicate aliases", async () => {
    const pool = poolReturning([new DriverRow({duplicate_name: "last driver value"})], [
      {name: "duplicate_name"},
      {name: "duplicate_name"}
    ])

    expect(await query(pool, "SELECT duplicate aliases")).toEqual([{duplicate_name: "last driver value"}])
  })

  it("keeps the legacy flat-row contract for stored-procedure result shapes", async () => {
    const procedureRows = [new DriverRow({task_name: "from procedure"})]
    const pool = poolReturning([procedureRows], [[{name: "task_name"}]])

    // mysql returns CALL results as nested row/field arrays. The public query
    // adapter has historically exposed only flat SELECT rows, so it does not
    // pass the nested driver result through.
    const rows = await query(pool, "CALL task_names()")

    expect(Object.keys(rows[0])).toEqual(["undefined"])
    expect(rows[0].undefined).toBe(undefined)
  })
})
