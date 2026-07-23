import query from "../../../../src/database/drivers/mysql/query.js"
import QueryAbortedError from "../../../../src/database/query-aborted-error.js"

class DriverRow {
  constructor(values) {
    Object.assign(this, values)
  }
}

/**
 * Builds a pool whose checked-out connection returns one predetermined driver
 * response, tracking whether that connection was released or destroyed.
 * @param {Array<DriverRow | Array<DriverRow>>} results - Driver results.
 * @param {Array<{name: string}> | Array<Array<{name: string}>>} fields - Driver fields.
 * @returns {{pool: import("mysql").Pool, connection: {released: boolean, destroyed: boolean}}} - Pool double + connection lifecycle flags.
 */
function poolReturning(results, fields) {
  const connection = {
    released: false,
    destroyed: false,
    query(_sql, callback) {
      callback(null, results, fields)
    },
    release() {
      connection.released = true
    },
    destroy() {
      connection.destroyed = true
    }
  }
  const pool = /** @type {import("mysql").Pool} */ ({
    getConnection(callback) {
      callback(null, connection)
    }
  })

  return {pool, connection}
}

/**
 * Builds a pool whose checked-out connection never acks its query, so the query
 * only settles via its abort signal. Tracks release/destroy for assertions.
 * @returns {{pool: import("mysql").Pool, connection: {released: boolean, destroyed: boolean}}} - Pool double + connection lifecycle flags.
 */
function poolWithBlockedQuery() {
  const connection = {
    released: false,
    destroyed: false,
    query() {}, // never calls back — models a query blocked on a lock
    release() {
      connection.released = true
    },
    destroy() {
      connection.destroyed = true
    }
  }
  const pool = /** @type {import("mysql").Pool} */ ({
    getConnection(callback) {
      callback(null, connection)
    }
  })

  return {pool, connection}
}

describe("Database - Drivers - Mysql - Query", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("materializes selected fields as isolated plain records", async () => {
    const date = new Date("2026-07-18T12:34:56.000Z")
    const buffer = Buffer.from([0, 1, 2, 255])
    const driverRow = new DriverRow({aliased_name: "task", ignored: "driver metadata", nullable: null, occurred_at: date, payload: buffer})
    const {pool} = poolReturning([driverRow], [
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
    const {pool} = poolReturning([new DriverRow({duplicate_name: "last driver value"})], [
      {name: "duplicate_name"},
      {name: "duplicate_name"}
    ])

    expect(await query(pool, "SELECT duplicate aliases")).toEqual([{duplicate_name: "last driver value"}])
  })

  it("keeps the legacy flat-row contract for stored-procedure result shapes", async () => {
    const procedureRows = [new DriverRow({task_name: "from procedure"})]
    const {pool} = poolReturning([procedureRows], [[{name: "task_name"}]])

    // mysql returns CALL results as nested row/field arrays. The public query
    // adapter has historically exposed only flat SELECT rows, so it does not
    // pass the nested driver result through.
    const rows = await query(pool, "CALL task_names()")

    expect(Object.keys(rows[0])).toEqual(["undefined"])
    expect(rows[0].undefined).toBe(undefined)
  })

  it("releases the connection back to the pool after a successful query", async () => {
    const {pool, connection} = poolReturning([new DriverRow({name: "task"})], [{name: "name"}])

    await query(pool, "SELECT name")

    expect(connection.released).toBe(true)
    expect(connection.destroyed).toBe(false)
  })

  it("aborts an in-flight query on signal, destroys the connection, and rejects with QueryAbortedError", async () => {
    const {pool, connection} = poolWithBlockedQuery()
    const controller = new AbortController()
    const promise = query(pool, "SELECT SLEEP(30)", {signal: controller.signal})

    controller.abort()

    let caught
    try {
      await promise
    } catch (error) {
      caught = error
    }

    expect(caught instanceof QueryAbortedError).toBe(true)
    expect(caught.code).toEqual("VELOCIOUS_QUERY_ABORTED")
    // Destroyed (not released) so a mid-statement connection is never reused.
    expect(connection.destroyed).toBe(true)
    expect(connection.released).toBe(false)
  })

  it("throws QueryAbortedError without checking out a connection when the signal is already aborted", async () => {
    let checkedOut = false
    const pool = /** @type {import("mysql").Pool} */ ({
      getConnection() {
        checkedOut = true
      }
    })

    let caught
    try {
      await query(pool, "SELECT 1", {signal: AbortSignal.abort()})
    } catch (error) {
      caught = error
    }

    expect(caught instanceof QueryAbortedError).toBe(true)
    expect(checkedOut).toBe(false)
  })
})
