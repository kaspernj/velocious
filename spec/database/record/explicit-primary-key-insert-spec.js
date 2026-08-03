// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Task from "../../dummy/src/models/task.js"
import UuidItem from "../../dummy/src/models/uuid-item.js"

/**
 * Builds a fake connection that requires the identity-insert wrapper like
 * MSSQL, records every query, and delegates SQL generation to the real driver.
 * @param {object} args - Harness args.
 * @param {Record<string, ?>} args.insertedRow - Row returned for the INSERT (mirrors an OUTPUT/RETURNING clause).
 * @returns {{connection: Record<string, ?>, queries: string[]}} Fake connection harness.
 */
function buildIdentityInsertConnection({insertedRow}) {
  const realDriver = Task.connection()

  /** @type {string[]} */
  const queries = []

  const connection = {
    afterCommit: async (/** @type {() => Promise<void>} */ callback) => await callback(),
    insertSql: (/** @type {Record<string, ?>} */ args) => realDriver.insertSql(args),
    query: async (/** @type {string} */ sql) => {
      queries.push(sql)

      return sql.startsWith("INSERT INTO") ? [insertedRow] : []
    },
    requiresIdentityInsertForExplicitPrimaryKey: () => true,
    withExplicitPrimaryKeyInsert: async (/** @type {string} */ tableName, /** @type {() => Promise<?>} */ callback) => {
      queries.push(`SET IDENTITY_INSERT [${tableName}] ON`)
      const result = await callback()

      queries.push(`SET IDENTITY_INSERT [${tableName}] OFF`)

      return result
    }
  }

  return {connection, queries}
}

describe("Database - record - explicit primary key insert", {databaseCleaning: {transaction: false, truncate: false}, tags: ["dummy"]}, () => {
  it("does not wrap the insert for a non-identity UUID primary key", async () => {
    const {connection, queries} = buildIdentityInsertConnection({insertedRow: {id: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c"}})
    const uuidItem = new UuidItem({id: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c", title: "Explicit UUID key"})

    uuidItem.__connection = /** @type {import("../../../src/database/drivers/base.js").default} */ (/** @type {?} */ (connection))

    await uuidItem._createNewRecord()

    expect(queries.some((query) => query.startsWith("SET IDENTITY_INSERT"))).toBeFalse()
    expect(queries.some((query) => query.startsWith("INSERT INTO"))).toBeTrue()
  })

  it("wraps the insert for an auto-increment primary key", async () => {
    const {connection, queries} = buildIdentityInsertConnection({insertedRow: {id: 123456}})
    const task = new Task({id: 123456, name: "Explicit identity key"})

    task.__connection = /** @type {import("../../../src/database/drivers/base.js").default} */ (/** @type {?} */ (connection))

    await task._createNewRecord()

    const identityInsertQueries = queries.filter((query) => query.startsWith("SET IDENTITY_INSERT"))

    expect(identityInsertQueries).toEqual([
      "SET IDENTITY_INSERT [tasks] ON",
      "SET IDENTITY_INSERT [tasks] OFF"
    ])
    expect(queries.some((query) => query.startsWith("INSERT INTO"))).toBeTrue()
  })

  it("runs the insert on the same connection that enabled identity insert", async () => {
    /**
     * Builds a minimal identity-insert connection recording onto the given log.
     * @param {string[]} queries - Query log.
     * @returns {Record<string, ?>} Fake connection.
     */
    const buildConnection = (queries) => ({
      insertSql: () => "INSERT INTO [tasks] ([id]) VALUES (123456)",
      query: async (/** @type {string} */ sql) => {
        queries.push(sql)

        return [{id: 123456}]
      },
      requiresIdentityInsertForExplicitPrimaryKey: () => true,
      supportsDefaultPrimaryKeyUUID: () => true,
      withExplicitPrimaryKeyInsert: async (/** @type {string} */ tableName, /** @type {() => Promise<?>} */ callback) => {
        queries.push(`SET IDENTITY_INSERT [${tableName}] ON`)
        const result = await callback()

        queries.push(`SET IDENTITY_INSERT [${tableName}] OFF`)

        return result
      }
    })

    /** @type {string[]} */
    const connAQueries = []
    /** @type {string[]} */
    const connBQueries = []
    const connA = buildConnection(connAQueries)
    const connB = buildConnection(connBQueries)

    // A pool can resolve a different current connection across the awaits of
    // the insert path: the early resolutions serve the insertSql build and the
    // wrapper receiver, the post-await resolution serves the insert query.
    let resolutions = 0
    const originalConnection = Task.connection

    Task.connection = /** @type {typeof Task.connection} */ (/** @type {?} */ (() => {
      resolutions++

      return resolutions <= 6 ? connA : connB
    }))

    const task = new Task({id: 123456, name: "Explicit identity key"})

    try {
      await task._createNewRecord()
    } finally {
      Task.connection = originalConnection
    }

    expect(connBQueries).toEqual([])
    expect(connAQueries).toEqual([
      "SET IDENTITY_INSERT [tasks] ON",
      "INSERT INTO [tasks] ([id]) VALUES (123456)",
      "SET IDENTITY_INSERT [tasks] OFF"
    ])
  })
})
