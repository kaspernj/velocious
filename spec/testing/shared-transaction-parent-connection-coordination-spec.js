// @ts-check

import BaseDriver from "../../src/database/drivers/base.js"
import Configuration from "../../src/configuration.js"
import SharedTransactionBroker from "../../src/testing/shared-transaction-broker.js"
import SharedTransactionBrokerClient from "../../src/testing/shared-transaction-broker-client.js"
import { describe, expect, it } from "../../src/testing/test.js"

class SingleRequestDriver extends BaseDriver {
  activeRequests = 0
  maxActiveRequests = 0
  /** @type {string[]} */
  queries = []
  /** @type {() => void} */
  releaseChild = () => {}
  /** @type {() => void} */
  releaseParent = () => {}
  /** @type {Promise<void>} */
  childStarted
  /** @type {Promise<void>} */
  parentStarted
  /** @type {() => void} */
  resolveChildStarted = () => {}
  /** @type {() => void} */
  resolveParentStarted = () => {}

  constructor() {
    super({}, Configuration.current())
    this.childStarted = new Promise((resolve) => { this.resolveChildStarted = resolve })
    this.parentStarted = new Promise((resolve) => { this.resolveParentStarted = resolve })
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
      if (sql == "SELECT blocking parent") {
        this.resolveParentStarted()
        await new Promise((resolve) => { this.releaseParent = resolve })
      }

      return []
    } finally {
      this.activeRequests--
    }
  }
}

/**
 * Runs a callback in the async context inherited by broker-owned detached work.
 * @template T
 * @param {SharedTransactionBroker} broker - Active broker.
 * @param {SingleRequestDriver} connection - Registered physical connection.
 * @param {() => T} callback - Inherited work.
 * @returns {T} - Callback result.
 */
function runWithBrokerOwner(broker, connection, callback) {
  const owner = broker.connectionCoordinatorOwners.get(connection)

  if (!owner) throw new Error("Expected the broker to own the physical connection")

  return connection.configuration
    .getEnvironmentHandler()
    .runWithSharedTransactionCoordinatorOwner(connection, owner, callback)
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
      await runWithBrokerOwner(broker, connection, async () => {
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

  it("keeps later parent work behind detached inherited query work", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    /** @type {Promise<[]> | undefined} */
    let detachedQuery
    /** @type {Promise<[]> | undefined} */
    let parentQuery

    try {
      await runWithBrokerOwner(broker, connection, async () => {
        detachedQuery = connection.query("SELECT child", {logQuery: false})
        await connection.childStarted
      })

      parentQuery = connection.query("SELECT parent", {logQuery: false})
      void parentQuery.catch(() => undefined)

      await new Promise((resolve) => setImmediate(resolve))
      expect(connection.queries).toEqual(["SELECT child"])
      connection.releaseChild()
      await Promise.all([detachedQuery, parentQuery])

      expect(connection.maxActiveRequests).toEqual(1)
      expect(connection.queries).toEqual(["SELECT child", "SELECT parent"])
    } finally {
      connection.releaseChild()
      await Promise.allSettled(detachedQuery ? [detachedQuery] : [])
      await Promise.allSettled(parentQuery ? [parentQuery] : [])
      await broker.close()
    }
  })

  it("atomically queues parent work before later inherited work", async () => {
    const connection = new SingleRequestDriver()
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    /** @type {() => void} */
    let queueLaterInherited = () => {}
    const queueLaterInheritedSignal = new Promise((resolve) => { queueLaterInherited = resolve })
    /** @type {Promise<[]> | undefined} */
    let activeInheritedQuery
    /** @type {Promise<[]> | undefined} */
    let parentQuery
    /** @type {Promise<[]> | undefined} */
    let laterInheritedQuery

    try {
      await runWithBrokerOwner(broker, connection, async () => {
        activeInheritedQuery = connection.query("SELECT child", {logQuery: false})
        laterInheritedQuery = queueLaterInheritedSignal.then(async () => {
          return await connection.query("SELECT inherited", {logQuery: false})
        })
        await connection.childStarted
      })

      parentQuery = connection.query("SELECT blocking parent", {logQuery: false})
      void parentQuery.catch(() => undefined)
      await new Promise((resolve) => setImmediate(resolve))

      queueLaterInherited()
      void laterInheritedQuery.catch(() => undefined)
      await new Promise((resolve) => setImmediate(resolve))
      connection.releaseChild()
      await connection.parentStarted
      await new Promise((resolve) => setImmediate(resolve))
      expect(connection.queries).toEqual(["SELECT child", "SELECT blocking parent"])
      connection.releaseParent()
      await Promise.all([activeInheritedQuery, parentQuery, laterInheritedQuery])

      expect(connection.maxActiveRequests).toEqual(1)
      expect(connection.queries).toEqual(["SELECT child", "SELECT blocking parent", "SELECT inherited"])
    } finally {
      connection.releaseChild()
      connection.releaseParent()
      await Promise.allSettled([activeInheritedQuery, parentQuery, laterInheritedQuery].filter((promise) => promise !== undefined))
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
