// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const marker = "test-runner-stale-shared-connection-cleanup"
const markerId = 10549

describe("TestRunner stale shared connection cleanup", {
  databaseCleaning: {transaction: false, truncate: false},
  type: "request"
}, () => {
  it("does not let an abandoned lifecycle clear a newer request provider", async () => {
    const pool = dummyConfiguration.getDatabasePool("default")
    const connection = pool.getCurrentConnection()
    const testRunner = new TestRunner({configuration: dummyConfiguration, testFiles: []})
    const projectsTable = connection.quoteTable("projects")
    const idColumn = connection.quoteColumn("id")
    /** @type {() => void} */
    let resumeOldCleanup = () => {}
    const oldCleanupSignal = new Promise((resolve) => {
      resumeOldCleanup = resolve
    })

    await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
      await dummyConfiguration.withConnections(async (dbs) => {
        await dbs.default.query(
          `DELETE FROM ${projectsTable} WHERE ${idColumn} = ${connection.quote(markerId)}`
        )
      })
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

      await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
        await dummyConfiguration.withConnections(async (dbs) => {
          const rows = await dbs.default.query(
            `SELECT ${idColumn} FROM ${projectsTable} WHERE ${idColumn} = ${connection.quote(markerId)}`
          )

          expect(rows).toEqual([])
        })
      })
    } finally {
      testRunner.clearTestSharedConnections(currentRegistrations)

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
    }
  })
})
