// @ts-check

import BaseDriver from "../../src/database/drivers/base.js"
import Configuration from "../../src/configuration.js"
import SharedTransactionBroker from "../../src/testing/shared-transaction-broker.js"
import SharedTransactionBrokerClient from "../../src/testing/shared-transaction-broker-client.js"
import { coordinateSharedTransactionConnection } from "../../src/testing/shared-transaction-connection-coordinator.js"
import { describe, expect, it } from "../../src/testing/test.js"

class SingleRequestDriver extends BaseDriver {
  activeRequests = 0
  maxActiveRequests = 0
  /** @type {string[]} */
  queries = []
  /** @type {() => void} */
  releaseChild = () => {}
  /** @type {Promise<void>} */
  childStarted
  /** @type {() => void} */
  resolveChildStarted = () => {}

  constructor() {
    super({}, Configuration.current())
    this.childStarted = new Promise((resolve) => { this.resolveChildStarted = resolve })
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<[]>} - Empty rows after the simulated request completes.
   */
  async _queryActual(sql) {
    this.activeRequests++
    this.maxActiveRequests = Math.max(this.maxActiveRequests, this.activeRequests)
    this.queries.push(sql)

    try {
      if (this.activeRequests > 1) throw new Error("Can't acquire connection for the request. There is another request in progress.")
      if (sql == "SELECT child") {
        this.resolveChildStarted()
        await new Promise((resolve) => { this.releaseChild = resolve })
      }

      return []
    } finally {
      this.activeRequests--
    }
  }
}

describe("Shared transaction parent connection coordination", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("serializes a parent query behind child broker work on the same physical connection", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const child = new SharedTransactionBrokerClient({
      address: broker.address(),
      capability: broker.capability(),
      databaseIdentifier: "default"
    })

    try {
      const childQuery = child.call("_queryActual", ["SELECT child"])
      await connection.childStarted
      const parentQuery = connection.query("SELECT parent", {logQuery: false})

      queueMicrotask(connection.releaseChild)
      await Promise.all([childQuery, parentQuery])

      expect(connection.maxActiveRequests).toEqual(1)
      expect(connection.queries).toEqual(["SELECT child", "SELECT parent"])
    } finally {
      connection.releaseChild()
      await child.close()
      await broker.close()
    }
  })

  it("serializes concurrent sibling queries that inherit one coordinator owner", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    /** @type {Promise<[]>[]} */
    let siblingQueries = []

    try {
      await coordinateSharedTransactionConnection(connection, async () => {
        siblingQueries = [
          connection.query("SELECT child", {logQuery: false}),
          connection.query("SELECT parent", {logQuery: false})
        ]
        await connection.childStarted
        connection.releaseChild()
        await Promise.all(siblingQueries)
      })

      expect(connection.maxActiveRequests).toEqual(1)
      expect(connection.queries).toEqual(["SELECT child", "SELECT parent"])
    } finally {
      connection.releaseChild()
      await Promise.allSettled(siblingQueries)
      await broker.close()
    }
  })

  it("keeps a broker queue entry until its inherited query settles", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    /** @type {Promise<[]> | undefined} */
    let inheritedQuery
    let rootSettled = false
    /** @type {() => void} */
    let resolveRootCallbackReturned = () => {}
    const rootCallbackReturned = new Promise((resolve) => { resolveRootCallbackReturned = resolve })

    const root = coordinateSharedTransactionConnection(connection, async () => {
      inheritedQuery = connection.query("SELECT child", {logQuery: false})
      await connection.childStarted
      resolveRootCallbackReturned()
    }).then(() => { rootSettled = true })

    try {
      await rootCallbackReturned
      await new Promise((resolve) => setImmediate(resolve))

      expect(rootSettled).toEqual(false)

      connection.releaseChild()
      await root
      await inheritedQuery

      expect(connection.maxActiveRequests).toEqual(1)
    } finally {
      connection.releaseChild()
      await Promise.allSettled([root, inheritedQuery || Promise.resolve([])])
      await broker.close()
    }
  })

  it("routes delayed inherited work behind later broker traffic", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const child = new SharedTransactionBrokerClient({
      address: broker.address(),
      capability: broker.capability(),
      databaseIdentifier: "default"
    })
    /** @type {() => void} */
    let releaseDelayedQuery = () => {}
    const delayedQueryGate = new Promise((resolve) => { releaseDelayedQuery = resolve })
    /** @type {Promise<[]>} */
    let delayedQuery = Promise.resolve([])

    try {
      await coordinateSharedTransactionConnection(connection, async () => {
        delayedQuery = delayedQueryGate.then(async () => await connection.query("SELECT parent", {logQuery: false}))
      })

      const brokerQuery = child.call("_queryActual", ["SELECT child"])

      await connection.childStarted
      releaseDelayedQuery()
      queueMicrotask(connection.releaseChild)
      await Promise.all([brokerQuery, delayedQuery])

      expect(connection.maxActiveRequests).toEqual(1)
      expect(connection.queries).toEqual(["SELECT child", "SELECT parent"])
    } finally {
      releaseDelayedQuery()
      connection.releaseChild()
      await Promise.allSettled([delayedQuery])
      await child.close()
      await broker.close()
    }
  })

  it("keeps delayed inherited work serialized after broker cleanup", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    /** @type {() => void} */
    let releaseDelayedQuery = () => {}
    const delayedQueryGate = new Promise((resolve) => { releaseDelayedQuery = resolve })
    /** @type {Promise<[]>} */
    let delayedQuery = Promise.resolve([])

    await coordinateSharedTransactionConnection(connection, async () => {
      delayedQuery = delayedQueryGate.then(async () => await connection.query("SELECT parent", {logQuery: false}))
    })
    await broker.close()

    const currentQuery = connection.query("SELECT child", {logQuery: false})

    try {
      await connection.childStarted
      releaseDelayedQuery()
      void delayedQuery.catch(() => undefined)
      await new Promise((resolve) => setImmediate(resolve))

      expect(connection.queries).toEqual(["SELECT child"])

      connection.releaseChild()
      await Promise.all([currentQuery, delayedQuery])

      expect(connection.maxActiveRequests).toEqual(1)
      expect(connection.queries).toEqual(["SELECT child", "SELECT parent"])
    } finally {
      releaseDelayedQuery()
      connection.releaseChild()
      await Promise.allSettled([currentQuery, delayedQuery])
    }
  })

  it("chains replacement broker work behind the retained connection queue", async () => {
    const connection = new SingleRequestDriver()
    const firstBroker = await SharedTransactionBroker.start({connections: {default: connection}})
    /** @type {() => void} */
    let releaseDelayedQuery = () => {}
    const delayedQueryGate = new Promise((resolve) => { releaseDelayedQuery = resolve })
    /** @type {Promise<[]>} */
    let delayedQuery = Promise.resolve([])

    await coordinateSharedTransactionConnection(connection, async () => {
      delayedQuery = delayedQueryGate.then(async () => await connection.query("SELECT child", {logQuery: false}))
    })
    await firstBroker.close()
    releaseDelayedQuery()
    await connection.childStarted

    const replacementBroker = await SharedTransactionBroker.start({connections: {default: connection}})
    const replacementQuery = connection.query("SELECT parent", {logQuery: false})

    try {
      void replacementQuery.catch(() => undefined)
      await new Promise((resolve) => setImmediate(resolve))

      expect(connection.queries).toEqual(["SELECT child"])

      connection.releaseChild()
      await Promise.all([delayedQuery, replacementQuery])

      expect(connection.maxActiveRequests).toEqual(1)
      expect(connection.queries).toEqual(["SELECT child", "SELECT parent"])
    } finally {
      connection.releaseChild()
      await Promise.allSettled([delayedQuery, replacementQuery])
      await replacementBroker.close()
    }
  })

  it("allows nested owner coordination to re-enter without deadlocking", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    let nestedRan = false

    try {
      await coordinateSharedTransactionConnection(connection, async () => {
        await coordinateSharedTransactionConnection(connection, async () => {
          await coordinateSharedTransactionConnection(connection, async () => {
            nestedRan = true
          })
        })
      })

      expect(nestedRan).toEqual(true)
    } finally {
      await broker.close()
    }
  })

  it("keeps sibling coordination parallel across distinct physical connections", async () => {
    const firstConnection = new SingleRequestDriver()
    const secondConnection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {first: firstConnection, second: secondConnection}})
    const queries = [
      firstConnection.query("SELECT child", {logQuery: false}),
      secondConnection.query("SELECT child", {logQuery: false})
    ]

    try {
      await Promise.all([firstConnection.childStarted, secondConnection.childStarted])

      expect(firstConnection.activeRequests).toEqual(1)
      expect(secondConnection.activeRequests).toEqual(1)
    } finally {
      firstConnection.releaseChild()
      secondConnection.releaseChild()
      await Promise.allSettled(queries)
      await broker.close()
    }
  })
})
