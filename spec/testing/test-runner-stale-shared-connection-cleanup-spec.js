// @ts-check

import { afterAll, beforeAll, describe, expect, it } from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"
import { deleteProjectMarker, projectMarkerRows } from "../helpers/project-marker-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const marker = "test-runner-stale-shared-connection-cleanup"

describe("TestRunner stale shared connection cleanup", {
  databaseCleaning: {transaction: false, truncate: false},
  type: "request"
}, () => {
  beforeAll(async () => {
    await deleteProjectMarker(dummyConfiguration, marker)
  })

  afterAll(async () => {
    await deleteProjectMarker(dummyConfiguration, marker)
  })

  it("does not let an abandoned lifecycle clear a newer request provider", async () => {
    const pool = dummyConfiguration.getDatabasePool("default")
    const connection = pool.getCurrentConnection()
    const testRunner = new TestRunner({configuration: dummyConfiguration, testFiles: []})
    /** @type {() => void} */
    let resumeOldCleanup = () => {}
    const oldCleanupSignal = new Promise((resolve) => {
      resumeOldCleanup = resolve
    })

    await connection.startTransaction()

    const oldRegistrations = testRunner.activateTestSharedConnections()
    const oldCleanup = oldCleanupSignal.then(() => {
      testRunner.clearTestSharedConnections(oldRegistrations)
    })
    const currentRegistrations = testRunner.activateTestSharedConnections()

    try {
      // Models a lifecycle that exceeded its timeout grace, then resumed its
      // detached finally only after the next lifecycle installed its provider.
      resumeOldCleanup()
      await oldCleanup

      const response = await fetch("http://localhost:31006/test-request-transaction-marker", {
        body: JSON.stringify({marker}),
        headers: {"Content-Type": "application/json"},
        method: "POST"
      })

      expect(response.status).toEqual(200)

      const body = await response.json()

      expect(body).toEqual({marker, markerCount: 1, status: "success"})
      await connection.rollbackTransaction()

      const persistedProjects = await projectMarkerRows(dummyConfiguration, marker)

      expect(persistedProjects).toHaveLength(0)
    } finally {
      testRunner.clearTestSharedConnections(currentRegistrations)

      if (connection.insideTransaction()) {
        await connection.rollbackTransaction()
      }
    }
  })
})
