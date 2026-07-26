// @ts-check

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "../../src/testing/test.js"
import { deleteProjectMarker } from "../helpers/project-marker-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"

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
    await Project.ensureInitialized()

    const projects = await Project
      .where({creatingUserReference: marker})
      .toArray()

    expect(projects).toHaveLength(1)
    expect(projects[0].creatingUserReference()).toEqual(marker)
  })

  it("rolls back before reusing the same marker in the next request hook", async () => {
    await Project.ensureInitialized()

    const projects = await Project
      .where({creatingUserReference: marker})
      .toArray()

    expect(projects).toHaveLength(1)
    expect(projects[0].creatingUserReference()).toEqual(marker)
  })
})
