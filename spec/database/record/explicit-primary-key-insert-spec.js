// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Task from "../../dummy/src/models/task.js"
import UuidItem from "../../dummy/src/models/uuid-item.js"

/**
 * Builds a fake connection that records every query and marks explicit
 * primary-key inserts, delegating SQL generation to the real driver.
 * @param {object} args - Harness args.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.insertedRow - Row returned for the INSERT (mirrors an OUTPUT/RETURNING clause).
 * @returns {{connection: Record<string, ReturnType<typeof JSON.parse>>, queries: string[]}} Fake connection harness.
 */
function buildIdentityInsertConnection({insertedRow}) {
  const realDriver = Task.connection()

  /** @type {string[]} */
  const queries = []

  const connection = {
    afterCommit: async (/** @type {() => Promise<void>} */ callback) => await callback(),
    insertSql: (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ args) => realDriver.insertSql(args),
    insertWithExplicitPrimaryKey: async (/** @type {{options: Record<string, ReturnType<typeof JSON.parse>>, sql: string, tableName: string}} */ args) => {
      queries.push(`EXPLICIT ${args.tableName}: ${args.sql}`)

      return [insertedRow]
    },
    query: async (/** @type {string} */ sql) => {
      queries.push(sql)

      return sql.startsWith("INSERT INTO") ? [insertedRow] : []
    }
  }

  return {connection, queries}
}

describe("Database - record - explicit primary key insert", {tags: ["dummy"]}, () => {
  it("does not use the explicit primary-key insert for a non-identity UUID primary key", async () => {
    const {connection, queries} = buildIdentityInsertConnection({insertedRow: {id: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c"}})
    const uuidItem = new UuidItem({id: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c", title: "Explicit UUID key"})

    uuidItem.__connection = /** @type {import("../../../src/database/drivers/base.js").default} */ (/** @type {ReturnType<typeof JSON.parse>} */ (connection))

    await uuidItem._createNewRecord()

    expect(queries.some((query) => query.startsWith("EXPLICIT"))).toBeFalse()
    expect(queries.some((query) => query.startsWith("INSERT INTO"))).toBeTrue()
  })

  it("uses the explicit primary-key insert for an auto-increment primary key", async () => {
    const {connection, queries} = buildIdentityInsertConnection({insertedRow: {id: 123456}})
    const task = new Task({id: 123456, name: "Explicit identity key"})

    task.__connection = /** @type {import("../../../src/database/drivers/base.js").default} */ (/** @type {ReturnType<typeof JSON.parse>} */ (connection))

    await task._createNewRecord()

    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatch(/^EXPLICIT tasks: INSERT INTO/u)
  })

  it("runs the explicit primary-key insert on the same connection that built the insert", async () => {
    /**
     * Builds a minimal explicit-insert connection recording onto the given log.
     * @param {string[]} queries - Query log.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Fake connection.
     */
    const buildConnection = (queries) => ({
      insertSql: () => "INSERT INTO [tasks] ([id]) VALUES (123456)",
      insertWithExplicitPrimaryKey: async (/** @type {{options: Record<string, ReturnType<typeof JSON.parse>>, sql: string, tableName: string}} */ args) => {
        queries.push(`EXPLICIT ${args.tableName}: ${args.sql}`)

        return [{id: 123456}]
      },
      query: async (/** @type {string} */ sql) => {
        queries.push(sql)

        return [{id: 123456}]
      },
      supportsDefaultPrimaryKeyUUID: () => true
    })

    /** @type {string[]} */
    const connAQueries = []
    /** @type {string[]} */
    const connBQueries = []
    const connA = buildConnection(connAQueries)
    const connB = buildConnection(connBQueries)

    // A pool can resolve a different current connection across the awaits of
    // the insert path: the early resolutions serve the insertSql build, the
    // post-await resolution serves the insert itself.
    let resolutions = 0
    const originalConnection = Task.connection

    Task.connection = /** @type {typeof Task.connection} */ (/** @type {ReturnType<typeof JSON.parse>} */ (() => {
      resolutions++

      return resolutions <= 3 ? connA : connB
    }))

    const task = new Task({id: 123456, name: "Explicit identity key"})

    try {
      await task._createNewRecord()
    } finally {
      Task.connection = originalConnection
    }

    expect(connBQueries).toEqual([])
    expect(connAQueries).toEqual(["EXPLICIT tasks: INSERT INTO [tasks] ([id]) VALUES (123456)"])
  })
})
