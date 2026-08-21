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
    this.failRollback = false
    this.failRelease = false
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

  async startSavePoint(name) { this.calls.push(`start:${name}`) }
  async releaseSavePoint(name) {
    this.calls.push(`release:${name}`)
    if (this.failRelease) throw new Error("release cleanup failed")
  }
  async rollbackSavePoint(name) {
    this.calls.push(`rollback:${name}`)
    if (this.failRollback) throw new Error("rollback cleanup failed")
  }
}

describe("Shared transaction broker protocol", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("completes a queued root lease admitted before revoke and cleans every holder once", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const first = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})
    const second = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})
    const late = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})

    await first.call("rootTransactionStart", ["first"])
    const secondQueued = waitForEvent(broker, "work-queued", {filter: (event) => event.method === "rootTransactionStart"})
    const secondStart = second.call("rootTransactionStart", ["second"])
    await secondQueued
    broker.revoke()
    await expect(() => late.call("query", ["late"])).toThrow(/revoked|capability/i)
    const close = broker.close()
    await secondStart
    await close

    expect(connection.calls).toEqual([
      "start:first",
      "rollback:first",
      "release:first",
      "start:second",
      "rollback:second",
      "release:second"
    ])
    expect(broker.httpServer.listening).toEqual(false)
    expect(broker.sessions.size).toEqual(0)
    await first.close()
    await second.close()
    await late.close()
  })

  it("routes enrolled physical identities and rejects unenrolled tenant identities", async () => {
    const defaultConnection = new FakeConnection()
    const tenantConnection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: defaultConnection}})
    const defaultClient = new SharedTransactionBrokerClient({
      address: broker.address(), capability: broker.capability(), databaseIdentifier: "default", reuseKey: "default-physical"
    })
    const tenantClient = new SharedTransactionBrokerClient({
      address: broker.address(), capability: broker.capability(), databaseIdentifier: "projectTenant", reuseKey: "tenant-alpha"
    })

    try {
      broker.enrollConnection({connection: defaultConnection, databaseIdentifier: "default", reuseKey: "default-physical"})
      await defaultClient.call("query", ["default write"])
      await expect(() => tenantClient.call("query", ["untracked write"])).toThrow(/unenrolled physical connection identity/i)
      broker.enrollConnection({connection: tenantConnection, databaseIdentifier: "projectTenant", reuseKey: "tenant-alpha"})
      await tenantClient.call("query", ["tenant write"])

      expect(defaultConnection.calls).toEqual(["default write"])
      expect(tenantConnection.calls).toEqual(["tenant write"])
    } finally {
      await defaultClient.close()
      await tenantClient.close()
      await broker.close()
    }
  })

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

  it("leases a physical connection from root savepoint start through release", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const first = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})
    const second = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})

    try {
      await first.call("rootTransactionStart", ["first"])
      const secondStart = second.call("rootTransactionStart", ["second"])
      await first.call("query", ["first write"])
      expect(connection.calls).toEqual(["start:first", "first write"])
      await first.call("rootTransactionRelease", ["first"])
      await secondStart
      await second.call("query", ["second write"])
      await second.call("rootTransactionRollback", ["second"])

      expect(connection.calls).toEqual([
        "start:first",
        "first write",
        "release:first",
        "start:second",
        "second write",
        "rollback:second",
        "release:second"
      ])
    } finally {
      await first.close()
      await second.close()
      await broker.close()
    }
  })

  it("rolls back and releases a disconnected root transaction holder", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const first = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})
    const second = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})

    try {
      await first.call("rootTransactionStart", ["abandoned"])
      const secondStart = second.call("rootTransactionStart", ["next"])
      await first.close()
      await secondStart
      await second.call("rootTransactionRelease", ["next"])
      expect(connection.calls).toEqual(["start:abandoned", "rollback:abandoned", "release:abandoned", "start:next", "release:next"])
    } finally {
      await second.close()
      await broker.close()
    }
  })

  it("rejects nested root leases and mismatched completion without releasing ownership", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const client = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})

    try {
      await client.call("rootTransactionStart", ["owned"])
      await expect(() => client.call("rootTransactionStart", ["nested"])).toThrow(/already active/i)
      await expect(() => client.call("rootTransactionRelease", ["wrong"])).toThrow(/does not match/i)
      await client.call("query", ["still owned"])
      await client.call("rootTransactionRollback", ["owned"])
      expect(connection.calls).toEqual(["start:owned", "still owned", "rollback:owned", "release:owned"])
    } finally {
      await client.close()
      await broker.close()
    }
  })

  it("records disconnected lease cleanup failure without an unhandled rejection and settles FIFO waiters", async () => {
    const connection = new FakeConnection()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const holder = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})
    const waiter = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "default"})
    /** @type {Array<Error>} */
    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason instanceof Error ? reason : new Error(String(reason)))
    process.on("unhandledRejection", onUnhandled)

    await holder.call("rootTransactionStart", ["broken"])
    const waitingStart = waiter.call("rootTransactionStart", ["waiting"])
    const waitingResult = waitingStart.then(() => "resolved", () => "rejected")
    connection.failRollback = true
    await holder.close()
    expect(await waitingResult).toEqual("resolved")
    await waiter.call("rootTransactionRelease", ["waiting"])
    await expect(() => broker.close()).toThrow(/rollback cleanup failed/i)

    process.removeListener("unhandledRejection", onUnhandled)
    expect(unhandled).toEqual([])
    expect(broker.httpServer.listening).toEqual(false)
    expect(broker.sessions.size).toEqual(0)
    await waiter.close()
  })

  it("continues explicit close after lease cleanup failures and rejects only after transport drain", async () => {
    const firstConnection = new FakeConnection()
    const secondConnection = new FakeConnection()
    firstConnection.failRollback = true
    secondConnection.failRelease = true
    const broker = await SharedTransactionBroker.start({connections: {first: firstConnection, second: secondConnection}})
    const first = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "first"})
    const second = new SharedTransactionBrokerClient({address: broker.address(), capability: broker.capability(), databaseIdentifier: "second"})
    await first.call("rootTransactionStart", ["first"])
    await second.call("rootTransactionStart", ["second"])

    await expect(() => broker.close()).toThrow(/cleanup failed/i)

    expect(firstConnection.calls).toEqual(["start:first", "rollback:first", "release:first"])
    expect(secondConnection.calls).toEqual(["start:second", "rollback:second", "release:second"])
    expect(broker.httpServer.listening).toEqual(false)
    expect(broker.sessions.size).toEqual(0)
    await first.close()
    await second.close()
  })
})
