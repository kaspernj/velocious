// @ts-check

import {afterAll, beforeAll, beforeEach, describe, expect, it} from "../../src/testing/test.js"
import {deleteProjectMarker} from "../helpers/project-marker-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const marker = "test-runner-request-hook-sharing"

describe("TestRunner request hook connection sharing", {
  databaseCleaning: {transaction: true},
  type: "request"
}, () => {
  beforeAll(async () => {
    await deleteProjectMarker(dummyConfiguration, marker)
  })

  afterAll(async () => {
    await deleteProjectMarker(dummyConfiguration, marker)
  })

  beforeEach(async () => {
    const response = await fetch("http://localhost:31006/test-request-transaction-marker", {
      body: JSON.stringify({marker}),
      headers: {"Content-Type": "application/json"},
      method: "POST"
    })

    expect(response.status).toEqual(200)
    expect(response.headers.get("content-type")).toContain("application/json")

    const body = await response.json()

    expect(body).toEqual({marker, markerCount: 1, status: "success"})
  })

  it("makes a later request hook write visible through the test transaction", async () => {
    const connection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()
    const projectsTable = connection.quoteTable("projects")
    const markerColumn = connection.quoteColumn("creating_user_reference")
    const rows = await connection.query(
      `SELECT ${markerColumn} AS creating_user_reference FROM ${projectsTable} WHERE ${markerColumn} = ${connection.quote(marker)}`
    )

    expect(rows).toEqual([{creating_user_reference: marker}])
  })

  it("rolls back before reusing the same marker in the next request hook", async () => {
    const connection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()
    const projectsTable = connection.quoteTable("projects")
    const markerColumn = connection.quoteColumn("creating_user_reference")
    const rows = await connection.query(
      `SELECT ${markerColumn} AS creating_user_reference FROM ${projectsTable} WHERE ${markerColumn} = ${connection.quote(marker)}`
    )

    expect(rows).toEqual([{creating_user_reference: marker}])
  })
})
