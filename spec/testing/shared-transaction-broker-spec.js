// @ts-check

import SharedTransactionBroker from "../../src/testing/shared-transaction-broker.js"
import SharedTransactionBrokerClient from "../../src/testing/shared-transaction-broker-client.js"
import { waitForEvent } from "../../src/testing/test.js"

class FakeConnection {
  constructor() {
    this.active = 0
    this.calls = []
    this.maxActive = 0
    /** @type {() => void} */
    this.releaseBlocked = () => {}
    /** @type {(value?: void) => void} */
    this.resolveCall = () => {}
    this.callStarted = new Promise((resolve) => { this.resolveCall = resolve })
  }

  async query(value) {
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    this.calls.push(value)
    this.resolveCall()
    try {
      if (value === "blocked" || value === "slow") await new Promise((resolve) => { this.releaseBlocked = resolve })
      if (value === "error") {
        const error = new Error("driver rejected query")
        error.code = "EDRIVER"
        throw error
      }
      return [{value}]
    } finally {
      this.active--
    }
  }
}

describe("Shared transaction broker protocol", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("rejects unknown capabilities and database identifiers without executing SQL", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const wrongCapability = new SharedTransactionBrokerClient({address: broker.address(), capability: "wrong", databaseIdentifier: "default"})
    const wrongDatabase = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "missing"})

    try {
      await expect(() => wrongCapability.call("query", ["select secret"])).toThrow(/capability/i)
      await expect(() => wrongDatabase.call("query", ["select secret"])).toThrow(/database identifier/i)
      expect(connection.calls).toEqual([])
    } finally {
      await wrongCapability.close()
      await wrongDatabase.close()
      await broker.close()
    }
  })

  it("correlates concurrent responses and serializes work across websocket sessions", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection, secondary: connection}})
    const first = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})
    const second = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "secondary"})

    try {
      const slowPromise = first.call("query", ["slow"])
      await connection.callStarted
      const secondQueued = waitForEvent(broker, "work-queued", {
        filter: (event) => event.databaseIdentifier === "secondary"
      })
      const fastPromise = second.call("query", ["fast"])
      await secondQueued
      connection.releaseBlocked()
      const [slow, fast] = await Promise.all([slowPromise, fastPromise])

      expect(slow).toEqual([{value: "slow"}])
      expect(fast).toEqual([{value: "fast"}])
      expect(connection.maxActive).toEqual(1)
      expect(connection.calls).toEqual(["slow", "fast"])
    } finally {
      await first.close()
      await second.close()
      await broker.close()
    }
  })

  it("propagates tagged driver errors", async () => {
    const broker = await SharedTransactionBroker.start({connections: {default: new FakeConnection()}})
    const client = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})

    try {
      let caught
      try {
        await client.call("query", ["error"])
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      expect(caught.message).toEqual("driver rejected query")
      expect(caught.code).toEqual("EDRIVER")
    } finally {
      await client.close()
      await broker.close()
    }
  })

  it("rejects pending requests on disconnect and revokes teardown capability", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const address = broker.address()
    const capability = broker.capability()
    const client = new SharedTransactionBrokerClient({address: broker.address(), capability, databaseIdentifier: "default"})
    const pending = client.call("query", ["blocked"])

    await client.connected()
    await client.close()
    await expect(() => pending).toThrow(/closed|disconnect/i)
    connection.releaseBlocked()
    await broker.close()

    const stale = new SharedTransactionBrokerClient({address, capability, databaseIdentifier: "default"})
    await expect(() => stale.call("query", ["after teardown"])).toThrow(/connect|closed|refused/i)
    expect(connection.calls).toEqual(["blocked"])
    await stale.close()
  })
})
