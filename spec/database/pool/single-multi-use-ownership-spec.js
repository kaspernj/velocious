// @ts-check

import DatabaseDriver from "../../../src/database/drivers/base.js"
import OperationLease from "../../../src/database/operation-lease.js"
import SingleMultiUsePool from "../../../src/database/pool/single-multi-use.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {deferred, waitFor} from "awaitery"

/**
 * ControlledConnect type.
 * @typedef {object} ControlledConnect
 * @property {Promise<void>} canFinish - Gate for the connect attempt.
 * @property {Error} [error] - Error raised after the gate opens.
 * @property {() => void} started - Signals that connect began.
 */

/** @type {ControlledConnect[]} */
let controlledConnects = []
let controlledConnectCount = 0
/** @type {Error | undefined} */
let controlledCheckoutCleanupError
/** @type {Error | undefined} */
let controlledCloseError
let controlledCloseCount = 0

class ControlledSinglePoolDriver extends DatabaseDriver {
  /** @returns {Promise<void>} - Runs a deterministic controlled connect. */
  async connect() {
    const controlledConnect = controlledConnects[controlledConnectCount]

    controlledConnectCount++
    if (!controlledConnect) return

    controlledConnect.started()
    await controlledConnect.canFinish
    if (controlledConnect.error) throw controlledConnect.error
  }

  /** @returns {Promise<void>} - Runs deterministic checkout-name cleanup. */
  async clearConnectionCheckoutName() {
    if (controlledCheckoutCleanupError) throw controlledCheckoutCleanupError

    await super.clearConnectionCheckoutName()
  }

  /** @returns {Promise<void>} - Runs deterministic physical close. */
  async _close() {
    controlledCloseCount++
    if (controlledCloseError) throw controlledCloseError
  }
}

describe("SingleMultiUsePool captured ownership", () => {
  /**
   * Builds a distinct fake physical configuration.
   * @param {string} name - Physical database name.
   * @param {number} [max] - Pool maximum.
   * @returns {import("../../../src/configuration-types.js").DatabaseConfigurationType} - Fake configuration.
   */
  function databaseConfiguration(name, max = 1) {
    return {
      driver: ControlledSinglePoolDriver,
      migrations: false,
      name,
      pool: {checkoutTimeoutMillis: 1000, max},
      type: "sqlite"
    }
  }

  /** Resets module-owned deterministic driver state. */
  function resetControlledConnects() {
    controlledConnectCount = 0
    controlledConnects = []
    controlledCheckoutCleanupError = undefined
    controlledCloseError = undefined
    controlledCloseCount = 0
  }

  it("atomically reserves capacity before different physical databases spawn", async () => {
    const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
    const firstCanFinish = deferred()
    const firstStarted = deferred()
    const secondCanFinish = deferred()
    const secondStarted = deferred()

    controlledConnects = [
      {canFinish: firstCanFinish.promise, started: () => firstStarted.resolve(undefined)},
      {canFinish: secondCanFinish.promise, started: () => secondStarted.resolve(undefined)}
    ]

    const firstPromise = pool.checkoutForConfiguration(databaseConfiguration("atomic-a"), {name: "atomic-a"}, {retain: false})
    const secondPromise = pool.checkoutForConfiguration(databaseConfiguration("atomic-b"), {name: "atomic-b"}, {retain: false})

    try {
      await firstStarted.promise
      await waitFor({wait: 1}, () => {
        const snapshot = pool.getDebugSnapshot()

        if (controlledConnectCount === 2 || snapshot.pendingCheckoutCount === 1) return

        throw new Error("Second physical checkout has not reached admission")
      })

      expect(controlledConnectCount).toEqual(1)
      expect(pool.getDebugSnapshot().connectionsBeingSpawned).toEqual(1)
      expect(pool.getDebugSnapshot().pendingCheckoutCount).toEqual(1)

      firstCanFinish.resolve(undefined)
      const firstConnection = await firstPromise

      expect(controlledConnectCount).toEqual(1)
      await pool.checkin(firstConnection)
      await secondStarted.promise
      expect(controlledConnectCount).toEqual(2)

      secondCanFinish.resolve(undefined)
      await pool.checkin(await secondPromise)
      expect(pool.getDebugSnapshot().connectionsBeingSpawned).toEqual(0)
      expect(pool.getDebugSnapshot().pendingCheckoutCount).toEqual(0)
    } finally {
      firstCanFinish.resolve(undefined)
      secondCanFinish.resolve(undefined)
      const results = await Promise.allSettled([firstPromise, secondPromise])

      for (const result of results) {
        if (result.status === "fulfilled") await pool.checkin(result.value)
      }
      await pool.closeAll()
      resetControlledConnects()
    }
  })

  it("keeps a shared spawned entry for a valid caller when another caller is revoked", async () => {
    const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
    const canFinish = deferred()
    const started = deferred()
    const accessScope = {revoked: false}

    controlledConnects = [{canFinish: canFinish.promise, started: () => started.resolve(undefined)}]

    const revokedCheckout = dummyConfiguration.runWithTestDatabaseAccessScope(accessScope, async () => {
      return await pool.checkoutForConfiguration(databaseConfiguration("shared-spawn"), {name: "revoked"}, {retain: false})
    })
    const revokedOutcome = revokedCheckout.then(
      () => { throw new Error("Revoked shared checkout unexpectedly resolved") },
      (error) => error
    )

    try {
      await started.promise
      const validCheckout = pool.checkoutForConfiguration(databaseConfiguration("shared-spawn"), {name: "valid"}, {retain: false})

      accessScope.revoked = true
      canFinish.resolve(undefined)

      const rejectionError = await revokedOutcome
      const validConnection = await validCheckout

      expect(rejectionError.message).toEqual("Database access is no longer allowed for this test attempt")
      expect(controlledCloseCount).toEqual(0)
      expect(pool.getDebugSnapshot().connections).toHaveLength(1)

      await pool.checkin(validConnection)
    } finally {
      canFinish.resolve(undefined)
      await pool.closeAll()
      resetControlledConnects()
    }
  })

  it("releases an unused revoked spawn to a different-key capacity waiter", async () => {
    const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
    const firstCanFinish = deferred()
    const firstStarted = deferred()
    const accessScope = {revoked: false}
    const firstConfiguration = databaseConfiguration("revoked-spawn")
    const validConfiguration = databaseConfiguration("valid-waiter")

    firstConfiguration.pool = {checkoutTimeoutMillis: 100, max: 1}
    validConfiguration.pool = {checkoutTimeoutMillis: 100, max: 1}
    controlledConnects = [
      {canFinish: firstCanFinish.promise, started: () => firstStarted.resolve(undefined)},
      {canFinish: Promise.resolve(), started: () => {}}
    ]

    const revokedCheckout = dummyConfiguration.runWithTestDatabaseAccessScope(accessScope, async () => {
      return await pool.checkoutForConfiguration(firstConfiguration, {name: "revoked"}, {retain: false})
    })
    const revokedOutcome = revokedCheckout.then(
      () => { throw new Error("Revoked spawning checkout unexpectedly resolved") },
      (error) => error
    )

    try {
      await firstStarted.promise
      const validCheckout = pool.checkoutForConfiguration(validConfiguration, {name: "valid"}, {retain: false})

      await waitFor({wait: 1}, () => {
        if (pool.getDebugSnapshot().pendingCheckoutCount === 1) return
        throw new Error("Valid checkout has not reached capacity admission")
      })

      accessScope.revoked = true
      firstCanFinish.resolve(undefined)

      const rejectionError = await revokedOutcome
      const validConnection = await validCheckout

      expect(rejectionError.message).toEqual("Database access is no longer allowed for this test attempt")
      expect(controlledConnectCount).toEqual(2)
      expect(pool.getDebugSnapshot().pendingCheckoutCount).toEqual(0)

      await pool.checkin(validConnection)
    } finally {
      firstCanFinish.resolve(undefined)
      await pool.closeAll()
      resetControlledConnects()
    }
  })

  it("rejects operations through an existing current connection after access is revoked", async () => {
    const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
    const accessScope = {revoked: false}
    const connection = await pool.checkoutForConfiguration(databaseConfiguration("revoked-current"), {}, {retain: true})
    let caughtError

    try {
      await dummyConfiguration.runWithTestDatabaseAccessScope(accessScope, async () => {
        accessScope.revoked = true

        try {
          await pool.query("SELECT 1")
        } catch (error) {
          caughtError = error
        }
      })

      expect(caughtError).toBeInstanceOf(Error)
      expect(caughtError.message).toEqual("Database access is no longer allowed for this test attempt")
    } finally {
      await pool.checkin(connection)
      await pool.closeAll()
      resetControlledConnects()
    }
  })

  it("releases a capacity reservation when connect fails", async () => {
    const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
    const failedCanFinish = deferred()
    const failedStarted = deferred()

    controlledConnects = [{
      canFinish: failedCanFinish.promise,
      error: new Error("controlled connect failure"),
      started: () => failedStarted.resolve(undefined)
    }]

    try {
      const failedCheckout = pool.checkoutForConfiguration(databaseConfiguration("failed-connect"), {}, {retain: false})

      await failedStarted.promise
      expect(pool.getDebugSnapshot().connectionsBeingSpawned).toEqual(1)
      failedCanFinish.resolve(undefined)
      await expect(async () => await failedCheckout).toThrowError("controlled connect failure")
      expect(pool.getDebugSnapshot().connectionsBeingSpawned).toEqual(0)
      expect(pool.getDebugSnapshot().pendingCheckoutCount).toEqual(0)
      expect(pool.getDebugSnapshot().connections).toEqual([])

      const recoveredConnection = await pool.checkoutForConfiguration(databaseConfiguration("recovered-connect"), {}, {retain: false})

      await pool.checkin(recoveredConnection)
      expect(pool.getDebugSnapshot().connectionsBeingSpawned).toEqual(0)
    } finally {
      failedCanFinish.resolve(undefined)
      await pool.closeAll()
      resetControlledConnects()
    }
  })

  it("checks a connection back in when operation lease admission rejects", async () => {
    const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
    const config = databaseConfiguration("lease-admission", 2)
    const existingConnection = await pool.checkoutForConfiguration(config, {name: "existing-owner"}, {retain: true})
    const existingLease = new OperationLease(Symbol("existing-owner"))

    await existingConnection.setOperationLease(existingLease)

    try {
      await expect(async () => {
        await pool.withCapturedOperationConnection({databaseConfiguration: config, name: "rejected-owner"}, async () => {})
      }).toThrowError("A database operation lease is already active")

      const recoveredSnapshot = pool.getDebugSnapshot()

      expect(recoveredSnapshot.activeCheckoutCount).toBeUndefined()
      expect(recoveredSnapshot.inUseCount).toEqual(1)
      expect(recoveredSnapshot.connections).toHaveLength(1)
      expect(recoveredSnapshot.connections[0].activeCheckoutCount).toEqual(1)
      expect(recoveredSnapshot.connections[0].checkoutName).toEqual("existing-owner")
      await expect(async () => {
        await existingConnection.setOperationLease(new OperationLease(Symbol("probe-owner")))
      }).toThrowError("A database operation lease is already active")

      existingLease.release()
      existingConnection.clearOperationLease(existingLease)

      let subsequentEntered = false

      await pool.withCapturedOperationConnection({databaseConfiguration: config, name: "subsequent-owner"}, async () => {
        subsequentEntered = true
      })
      expect(subsequentEntered).toBe(true)
      expect(pool.getDebugSnapshot().connections[0].activeCheckoutCount).toEqual(1)
      expect(pool.getDebugSnapshot().connections[0].checkoutName).toEqual("existing-owner")
    } finally {
      existingLease.release()
      try {
        existingConnection.clearOperationLease(existingLease)
      } catch {
        // The test clears this lease before proving subsequent progress.
      }
      await pool.checkin(existingConnection)
      await pool.closeAll()
      resetControlledConnects()
    }
  })

  it("preserves both checkout cleanup and connection close failures", async () => {
    const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
    const connection = await pool.checkoutForConfiguration(databaseConfiguration("cleanup-close-errors"), {name: "failing checkout"}, {retain: false})

    controlledCheckoutCleanupError = new Error("controlled checkout cleanup failure")
    controlledCloseError = new Error("controlled connection close failure")

    try {
      /** @type {Error | undefined} */
      let checkinError

      try {
        await pool.checkin(connection)
      } catch (error) {
        checkinError = error instanceof Error ? error : new Error("Unexpected checkin rejection", {cause: error})
      }

      expect(checkinError instanceof AggregateError).toBe(true)

      const errors = checkinError instanceof AggregateError ? checkinError.errors : []

      expect(errors.map((error) => error.message)).toEqual([
        "controlled checkout cleanup failure",
        "controlled connection close failure"
      ])
      expect(pool.getDebugSnapshot().connections).toEqual([])
    } finally {
      resetControlledConnects()
      await pool.closeAll()
    }
  })
})
