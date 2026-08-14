// @ts-check

import AsyncTrackedMultiConnectionPool from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import {
  runWithSharedTransactionBrokerConfig,
  sharedTransactionBrokerConfig
} from "../../src/testing/shared-transaction-proxy-driver.js"

describe("Shared transaction pooled job context", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("selects broker coordinates per sequential job instead of retaining the child bootstrap environment", async () => {
    const first = {address: "ws://127.0.0.1:1001", capability: "first", databaseIdentifiers: ["default"], expected: true}
    const second = {address: "ws://127.0.0.1:1002", capability: "second", databaseIdentifiers: ["default"], expected: true}

    await runWithSharedTransactionBrokerConfig(first, async () => {
      expect(sharedTransactionBrokerConfig("default")).toEqual({address: first.address, capability: first.capability})
    })
    await runWithSharedTransactionBrokerConfig(second, async () => {
      expect(sharedTransactionBrokerConfig("default")).toEqual({address: second.address, capability: second.capability})
    })
  })

  it("fails closed when a pooled job expects sharing but has no broker coordinates", async () => {
    await expect(() => runWithSharedTransactionBrokerConfig({expected: true}, async () => {
      sharedTransactionBrokerConfig("default")
    })).toThrow(/expected.*broker/i)
  })

  it("does not fall back to immutable child environment inside a per-job context", async () => {
    const previous = process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER
    process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER = Buffer.from(JSON.stringify({
      address: "ws://127.0.0.1:1000",
      capability: "stale",
      databaseIdentifiers: ["default"]
    })).toString("base64url")

    try {
      await expect(() => runWithSharedTransactionBrokerConfig({expected: true}, async () => {
        sharedTransactionBrokerConfig("default")
      })).toThrow(/expected.*broker/i)
    } finally {
      if (previous === undefined) delete process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER
      else process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER = previous
    }
  })

  it("uses async-context connection ownership for concurrent pooled broker jobs", async () => {
    const configuration = new Configuration({
      database: {test: {default: {poolType: SingleMultiUsePool}}},
      environment: "test",
      environmentHandler: new NodeEnvironmentHandler()
    })
    const broker = {address: "ws://127.0.0.1:1001", capability: "shared", databaseIdentifiers: ["default"], expected: true}

    expect(configuration.getDatabasePoolType()).toEqual(SingleMultiUsePool)
    await runWithSharedTransactionBrokerConfig(broker, async () => {
      expect(configuration.getDatabasePoolType()).toEqual(AsyncTrackedMultiConnectionPool)
    })
  })
})
