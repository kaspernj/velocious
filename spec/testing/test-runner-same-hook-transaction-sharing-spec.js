// @ts-check

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "../../src/testing/test.js"
import { deleteProjectMarker, projectMarkerRows } from "../helpers/project-marker-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"

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

      await Project.ensureInitialized()

      const projects = await Project
        .where({creatingUserReference: marker})
        .toArray()

      expect(projects).toHaveLength(1)
      expect(projects[0].creatingUserReference()).toEqual(marker)
      requestWriteWasVisible = true
    } finally {
      if (connection.insideTransaction()) {
        await connection.rollbackTransaction()
      }
    }

    const persistedProjects = await projectMarkerRows(dummyConfiguration, marker)

    expect(persistedProjects).toHaveLength(0)
  })

  it("keeps the request write in the hook transaction until rollback", () => {
    expect(requestWriteWasVisible).toEqual(true)
  })
})
