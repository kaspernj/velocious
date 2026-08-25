// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"
import {describe, expect, it} from "../../../src/testing/test.js"

class EndOfDrainGatedPool extends AsyncTrackedMultiConnection {
  drainRequestCount = 0

  /** @type {Promise<void> | undefined} */
  drainBarrier

  /** @type {() => void} */
  releaseDrainBarrier = () => {}

  /** @type {() => void} */
  signalDrainBarrier = () => {}

  /** @type {Promise<void>} */
  drainBarrierReached = Promise.resolve()

  /** @type {Promise<void>} */
  overlappingDrainRequested = Promise.resolve()

  /** @type {() => void} */
  signalOverlappingDrainRequested = () => {}

  /** Arms a one-shot barrier after the active drain has made its final state check. */
  armEndOfDrainBarrier() {
    this.drainRequestCount = 0
    this.drainBarrierReached = new Promise((resolve) => {
      this.signalDrainBarrier = resolve
    })
    this.overlappingDrainRequested = new Promise((resolve) => {
      this.signalOverlappingDrainRequested = resolve
    })
    this.drainBarrier = new Promise((resolve) => {
      this.releaseDrainBarrier = resolve
    })
  }

  /** @returns {Promise<void>} - Resolves after the requested drain work completes. */
  async drainPendingCheckouts() {
    this.drainRequestCount++
    if (this.drainRequestCount === 2) this.signalOverlappingDrainRequested()

    await super.drainPendingCheckouts()
  }

  /** @returns {Promise<void>} - Resolves after the gated drain pass completes. */
  async drainPendingCheckoutsActual() {
    await super.drainPendingCheckoutsActual()

    const barrier = this.drainBarrier

    if (!barrier) return

    this.drainBarrier = undefined
    this.signalDrainBarrier()
    await barrier
  }
}

describe("database pool pending checkout drain requests", () => {
  it("runs another pass when a matching checkin requests a drain during active-drain completion", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-drain-request")
    /** @type {Promise<import("../../../src/database/drivers/base.js").default> | undefined} */
    let pendingConnectionPromise

    try {
      configuration.getDatabaseConfiguration().default.poolType = EndOfDrainGatedPool
      configuration.getDatabaseConfiguration().default.pool = {checkoutTimeoutMillis: null, max: 1}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof EndOfDrainGatedPool)) throw new Error("Expected the gated async tracked pool")

      const heldConnection = await pool.checkout()

      pool.armEndOfDrainBarrier()
      pendingConnectionPromise = pool.checkout()
      await pool.drainBarrierReached

      const checkinPromise = pool.checkin(heldConnection)

      await pool.overlappingDrainRequested
      pool.releaseDrainBarrier()
      await checkinPromise

      const snapshot = pool.getDebugSnapshot()

      expect(snapshot.idleCount).toEqual(0)
      expect(snapshot.pendingCheckoutCount).toEqual(0)
      expect(snapshot.idleMatchingPendingCheckoutCount).toEqual(0)

      const pendingConnection = await pendingConnectionPromise

      expect(pendingConnection).toBe(heldConnection)
      await pool.checkin(pendingConnection)
    } finally {
      if (pendingConnectionPromise) void pendingConnectionPromise.catch(() => {})
      await cleanup()
    }
  })

  it("reports matching idle capacity separately from different-tenant idle capacity", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-drain-invariant")

    try {
      const pool = configuration.getDatabasePool("projectTenant")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an async tracked pool")

      const alphaConfig = configuration.resolveDatabaseConfiguration("projectTenant", {slug: "alpha"})
      const betaConfig = configuration.resolveDatabaseConfiguration("projectTenant", {slug: "beta"})
      const alphaConnection = await pool.spawnConnectionWithConfiguration(alphaConfig, pool.getConfigurationReuseKey(alphaConfig))
      const betaConnection = await pool.spawnConnectionWithConfiguration(betaConfig, pool.getConfigurationReuseKey(betaConfig))

      pool.stampConnectionForConfigurationReuseKey(alphaConnection, pool.getConfigurationReuseKey(alphaConfig))
      pool.stampConnectionForConfigurationReuseKey(betaConnection, pool.getConfigurationReuseKey(betaConfig))
      pool.connections.push(alphaConnection, betaConnection)
      pool.pendingCheckouts.push({
        databaseConfig: alphaConfig,
        enqueuedAt: Date.now(),
        options: {},
        reject: () => {},
        resolve: () => {},
        reuseKey: pool.getConfigurationReuseKey(alphaConfig),
        timeoutAt: null,
        timeoutMillis: null,
        timeoutTimer: undefined
      })

      expect(pool.getDebugSnapshot().idleMatchingPendingCheckoutCount).toEqual(1)
    } finally {
      await cleanup()
    }
  })
})
