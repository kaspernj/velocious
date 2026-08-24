// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import AsyncTrackedMultiConnectionPool from "../../src/database/pool/async-tracked-multi-connection.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../src/testing/test.js"

class StorePoolDriver extends DatabaseDriverBase {
  /** @returns {Promise<[]>} - Empty query result. */
  async _queryActual() { return [] }

  async connect() {}
  getType() { return "test" }
  primaryKeyType() { return "bigint" }
  queryToSql() { return "" }
}

class ObservedTrackedPool extends AsyncTrackedMultiConnectionPool {
  checkoutWaited = Promise.withResolvers()

  async waitForCheckout(databaseConfig, reuseKey, options = {}) {
    this.checkoutWaited.resolve()

    return await super.waitForCheckout(databaseConfig, reuseKey, options)
  }
}

class PoolAdmissionStore extends BackgroundJobsStore {
  firstMutationStarted = Promise.withResolvers()
  firstMutationCanFinish = Promise.withResolvers()
  readStarted = Promise.withResolvers()
  readCanFinish = Promise.withResolvers()
  mutationCount = 0

  async ensureReady() {}
  async _lockCountRevision() {}

  async _countSnapshotOnLockedConnection() {
    this.mutationCount++

    if (this.mutationCount === 1) {
      this.firstMutationStarted.resolve()
      await this.firstMutationCanFinish.promise
    }

    return {counts: {}, revision: 0, total: 0}
  }

  async _nextQueuedJob() {
    this.readStarted.resolve()
    await this.readCanFinish.promise

    return null
  }
}

describe("Background jobs store serializer pool admission", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("queues serialized mutations before checking out another connection", async () => {
    const configuration = new Configuration({
      backgroundJobs: {databaseIdentifier: "default"},
      database: {test: {default: {
        driver: StorePoolDriver,
        pool: {checkoutTimeoutMillis: null, max: 2},
        poolType: ObservedTrackedPool,
        type: "test"
      }}},
      environment: "test",
      environmentHandler: new NodeEnvironmentHandler()
    })
    const pool = /** @type {ObservedTrackedPool} */ (configuration.getDatabasePool("default"))
    const store = new PoolAdmissionStore({configuration})
    const firstMutation = store.countSnapshot()

    await store.firstMutationStarted.promise

    const queuedMutation = store.countSnapshot()
    const read = store.nextAvailableJob()

    try {
      const outcome = await Promise.race([
        store.readStarted.promise.then(() => "read-started"),
        pool.checkoutWaited.promise.then(() => "checkout-waited")
      ])

      expect(outcome).toEqual("read-started")
      expect(Object.keys(pool.connectionsInUse).length).toEqual(2)
      expect(pool.pendingCheckouts.length).toEqual(0)
    } finally {
      store.readCanFinish.resolve()
      store.firstMutationCanFinish.resolve()
      await Promise.all([firstMutation, queuedMutation, read])
      await pool.closeAll()
    }
  })
})
