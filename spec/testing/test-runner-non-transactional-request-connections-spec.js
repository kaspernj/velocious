// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import { SHARED_TRANSACTION_BROKER_ENV } from "../../src/testing/shared-transaction-proxy-driver.js"

describe("TestRunner non-transactional request connections", {
  databaseCleaning: {transaction: false, truncate: true},
  type: "request"
}, () => {
  it("checks out independent connections for concurrent in-process request handlers", async () => {
    expect(process.env[SHARED_TRANSACTION_BROKER_ENV]).toBeUndefined()
    const [firstResponse, secondResponse] = await Promise.all([
      fetch("http://localhost:31006/concurrent-connection-identity"),
      fetch("http://localhost:31006/concurrent-connection-identity")
    ])
    const firstBody = await firstResponse.json()
    const secondBody = await secondResponse.json()

    expect(firstBody.connectionId).not.toEqual(secondBody.connectionId)
    const expectedConnectionIds = [firstBody.connectionId, secondBody.connectionId].sort((a, b) => a - b)

    expect([...firstBody.connectionIds].sort((a, b) => a - b)).toEqual(expectedConnectionIds)
    expect([...secondBody.connectionIds].sort((a, b) => a - b)).toEqual(expectedConnectionIds)
  })
})
