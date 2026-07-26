// @ts-check

import {afterAll, beforeAll, beforeEach, describe, expect, it} from "../../src/testing/test.js"
import {deleteProjectMarker, projectMarkerRows} from "../helpers/project-marker-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const marker = "test-runner-same-hook-transaction-sharing"
let requestWriteWasVisible = false

describe("TestRunner same-hook transaction connection sharing", {
  databaseCleaning: {transaction: false, truncate: false},
  type: "request"
}, () => {
  beforeAll(async () => {
    await deleteProjectMarker(dummyConfiguration, marker)
  })

  afterAll(async () => {
    await deleteProjectMarker(dummyConfiguration, marker)
  })

  beforeEach(async () => {
    requestWriteWasVisible = false

    const connection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()
    const projectsTable = connection.quoteTable("projects")
    const markerColumn = connection.quoteColumn("creating_user_reference")

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
        `SELECT ${markerColumn} AS creating_user_reference FROM ${projectsTable} WHERE ${markerColumn} = ${connection.quote(marker)}`
      )

      expect(rows).toEqual([{creating_user_reference: marker}])
      requestWriteWasVisible = true
    } finally {
      if (connection.insideTransaction()) {
        await connection.rollbackTransaction()
      }
    }

    expect(await projectMarkerRows(dummyConfiguration, marker)).toEqual([])
  })

  it("keeps the request write in the hook transaction until rollback", () => {
    expect(requestWriteWasVisible).toEqual(true)
  })
})
