// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import AsyncTrackedMultiConnectionPool from "../../src/database/pool/async-tracked-multi-connection.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../src/testing/test.js"
import {
  clearSharedTransactionCoordinator,
  setSharedTransactionCoordinator
} from "../../src/testing/shared-transaction-connection-coordinator.js"

class StoreContextDriver extends DatabaseDriverBase {
  /** @type {(sql: string) => Promise<void>} */
  queryCallback = async () => {}

  /** @param {string} sql - SQL query. @returns {Promise<[]>} - Empty query result. */
  async _queryActual(sql) {
    await this.queryCallback(sql)
    return []
  }

  async connect() {}
  getType() { return "test" }
  primaryKeyType() { return "bigint" }
  queryToSql() { return "" }
}

describe("BackgroundJobsStore test shared connection", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("runs persistence through the installed test transaction connection", async () => {
    const configuration = new Configuration({
      backgroundJobs: {databaseIdentifier: "default"},
      database: {test: {default: {driver: StoreContextDriver, poolType: AsyncTrackedMultiConnectionPool, type: "test"}}},
      environment: "test",
      environmentHandler: new NodeEnvironmentHandler()
    })
    const pool = configuration.getDatabasePool("default")
    const parentConnection = /** @type {StoreContextDriver} */ (await pool.checkout())
    const registration = pool.setTestSharedConnection(parentConnection)
    const store = new BackgroundJobsStore({configuration})

    try {
      const selected = await store._withDb(async (db) => db)
      expect(selected).toBe(parentConnection)
    } finally {
      pool.clearTestSharedConnection(registration)
      await pool.checkin(parentConnection)
      await pool.closeAll()
    }
  })

  it("coordinates parent persistence with broker work on the shared physical connection", async () => {
    const configuration = new Configuration({
      backgroundJobs: {databaseIdentifier: "default"},
      database: {test: {default: {driver: StoreContextDriver, poolType: AsyncTrackedMultiConnectionPool, type: "test"}}},
      environment: "test",
      environmentHandler: new NodeEnvironmentHandler()
    })
    const pool = configuration.getDatabasePool("default")
    const parentConnection = /** @type {StoreContextDriver} */ (await pool.checkout())
    const registration = pool.setTestSharedConnection(parentConnection)
    const store = new BackgroundJobsStore({configuration})
    let active = 0
    let maxActive = 0
    let coordinatorCalls = 0
    let queue = Promise.resolve()
    /** @type {(callback: () => Promise<unknown>) => Promise<unknown>} */
    const coordinator = async (callback) => {
      coordinatorCalls++
      const previous = queue
      let release = () => {}
      queue = new Promise((resolve) => { release = resolve })
      await previous
      try { return await callback() } finally { release() }
    }
    setSharedTransactionCoordinator(parentConnection, coordinator)
    /** @type {() => void} */
    let releaseFirst = () => {}
    const firstBlocked = new Promise((resolve) => { releaseFirst = resolve })
    parentConnection.queryCallback = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      active--
    }

    try {
      const first = coordinator(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await firstBlocked
        active--
      })
      const second = store._withDb(async (db) => {
        await db.query("SELECT parent", {logQuery: false})
      })
      await Promise.resolve()
      releaseFirst()
      await Promise.all([first, second])
      expect(coordinatorCalls).toEqual(2)
      expect(maxActive).toEqual(1)
    } finally {
      clearSharedTransactionCoordinator(parentConnection, coordinator)
      pool.clearTestSharedConnection(registration)
      await pool.checkin(parentConnection)
      await pool.closeAll()
    }
  })
})
