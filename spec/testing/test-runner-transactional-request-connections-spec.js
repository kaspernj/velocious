// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("TestRunner transactional request connections", {
  databaseCleaning: {transaction: true},
  type: "request"
}, () => {
  it("removes a connection identity waiter when its request times out", async () => {
    const timedOutResponse = await fetch("http://localhost:31006/concurrent-connection-identity")

    expect(timedOutResponse.status).toEqual(500)
  })

  it("shares the active test transaction with in-process request handlers", async () => {
    const [firstResponse, secondResponse] = await Promise.all([
      fetch("http://localhost:31006/concurrent-connection-identity"),
      fetch("http://localhost:31006/concurrent-connection-identity")
    ])
    const firstBody = await firstResponse.json()
    const secondBody = await secondResponse.json()

    expect(firstBody.connectionId).toEqual(secondBody.connectionId)
    expect(firstBody.connectionIds).toEqual([firstBody.connectionId, firstBody.connectionId])
    expect(secondBody.connectionIds).toEqual([firstBody.connectionId, firstBody.connectionId])
  })

  it("shares only transaction-active connections in a multi-database configuration", async () => {
    const defaultConnection = dummyConfiguration.getDatabasePool("default").getCurrentConnection()
    const mssqlConnection = dummyConfiguration.getDatabasePool("mssql").getCurrentConnection()
    const testRunner = new TestRunner({configuration: dummyConfiguration, testFiles: []})

    await defaultConnection.rollbackTransaction()
    testRunner.clearTestSharedConnections()
    dummyConfiguration.getDatabasePool("default").setTestSharedConnection(defaultConnection)
    testRunner.activateTestSharedConnections()

    try {
      await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
        let sharedDefaultConnection
        let sharedMssqlConnection

        dummyConfiguration.getDatabasePool("default").runWithTestSharedConnection(() => {
          sharedDefaultConnection = dummyConfiguration.getDatabasePool("default").getCurrentContextConnection()
        })
        dummyConfiguration.getDatabasePool("mssql").runWithTestSharedConnection(() => {
          sharedMssqlConnection = dummyConfiguration.getDatabasePool("mssql").getCurrentContextConnection()
        })

        expect(sharedDefaultConnection).toBeUndefined()
        expect(sharedMssqlConnection).toBe(mssqlConnection)
      })
    } finally {
      testRunner.clearTestSharedConnections()
      await defaultConnection.startTransaction()
    }
  })
})
