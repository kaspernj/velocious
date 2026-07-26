// @ts-check

import { afterEach, beforeEach, describe, expect, it } from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const marker = "test-runner-same-hook-transaction-sharing"
const markerId = 10549
let requestWriteWasVisible = false

describe("TestRunner same-hook transaction connection sharing", {
  databaseCleaning: {transaction: false, truncate: false},
  type: "request"
}, () => {
  beforeEach(async () => {
    requestWriteWasVisible = false

    const connection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()
    const projectsTable = connection.quoteTable("projects")
    const idColumn = connection.quoteColumn("id")
    const markerColumn = connection.quoteColumn("creating_user_reference")

    await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
      await dummyConfiguration.withConnections(async (dbs) => {
        await dbs.default.query(
          `DELETE FROM ${projectsTable} WHERE ${idColumn} = ${connection.quote(markerId)}`
        )
      })
    })

    await connection.startTransaction()

    try {
      const response = await fetch("http://localhost:31006/test-request-transaction-marker", {
        body: JSON.stringify({marker}),
        headers: {"Content-Type": "application/json"},
        method: "POST"
      })

      expect(response.status).toEqual(200)
      expect(response.headers.get("content-type")).toContain("application/json")

      const body = await response.json()

      expect(body).toEqual({marker, markerCount: 1, status: "success"})

      const rows = await connection.query(
        `SELECT ${markerColumn} AS creating_user_reference FROM ${projectsTable} WHERE ${idColumn} = ${connection.quote(markerId)}`
      )

      expect(rows).toEqual([{creating_user_reference: marker}])
      requestWriteWasVisible = true
    } finally {
      if (connection.insideTransaction()) {
        await connection.rollbackTransaction()
      }
    }

    await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
      await dummyConfiguration.withConnections(async (dbs) => {
        const rows = await dbs.default.query(
          `SELECT ${idColumn} FROM ${projectsTable} WHERE ${idColumn} = ${connection.quote(markerId)}`
        )

        expect(rows).toEqual([])
      })
    })
  })

  afterEach(async () => {
    const connection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()
    const projectsTable = connection.quoteTable("projects")
    const idColumn = connection.quoteColumn("id")

    if (connection.insideTransaction()) {
      await connection.rollbackTransaction()
    }

    await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
      await dummyConfiguration.withConnections(async (dbs) => {
        await dbs.default.query(
          `DELETE FROM ${projectsTable} WHERE ${idColumn} = ${connection.quote(markerId)}`
        )
      })
    })
  })

  it("keeps the request write in the hook transaction until rollback", () => {
    expect(requestWriteWasVisible).toEqual(true)
  })
})
