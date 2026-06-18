// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../../src/database/drivers/sqlite/index.js"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import {describe, expect, it} from "../../../src/testing/test.js"

class CheckoutNameFailingSqliteDriver extends SqliteDriver {
  /** @type {number} */
  static closeDelayMillis = 0

  /**
   * @param {string | undefined} name - Human-readable name for this active checkout.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async setConnectionCheckoutName(name) {
    if (name == "fail activation") throw new Error("Checkout name activation failed")

    await super.setConnectionCheckoutName(name)
  }

  /** @returns {Promise<void>} - Resolves after the connection closes. */
  async close() {
    if (CheckoutNameFailingSqliteDriver.closeDelayMillis > 0) await wait(CheckoutNameFailingSqliteDriver.closeDelayMillis)

    await super.close()
  }
}

/**
 * @param {import("../../../src/configuration-types.js").DatabasePoolConfiguration} [poolConfig] - Pool config.
 * @returns {Promise<Configuration>} - Configuration backed by a temp SQLite database.
 */
async function testConfiguration(poolConfig = {max: 1}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-pool-checkout-name-"))

  return new Configuration({
    database: {
      test: {
        default: {
          driver: CheckoutNameFailingSqliteDriver,
          migrations: false,
          name: "pool-checkout-name-test",
          pool: poolConfig,
          poolType: AsyncTrackedMultiConnection,
          type: "sqlite"
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

/**
 * @param {(pool: AsyncTrackedMultiConnection) => Promise<void>} callback - Spec body.
 * @param {import("../../../src/configuration-types.js").DatabasePoolConfiguration} [poolConfig] - Pool config.
 * @returns {Promise<void>} - Resolves after closing database connections.
 */
async function withCheckoutNamePool(callback, poolConfig = {max: 1}) {
  const configuration = await testConfiguration(poolConfig)

  try {
    const pool = configuration.getDatabasePool("default")

    if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected async tracked pool")

    await callback(pool)
  } finally {
    await configuration.closeDatabaseConnections()
  }
}

/**
 * @param {import("../../../src/database/pool/base.js").DatabasePoolDebugSnapshot} snapshot - Pool debug snapshot.
 * @returns {void}
 */
function expectWaitingCheckoutSnapshot(snapshot) {
  expect(snapshot.inUseCount).toBe(1)
  expect(snapshot.pendingCheckoutCount).toBe(1)
  expect(snapshot.pendingCheckouts?.[0]?.checkoutName).toBe("waiting checkout")
  expect(snapshot.pendingCheckouts?.[0]?.waitingForMs).toBeGreaterThanOrEqual(0)
}

/**
 * @param {import("../../../src/database/pool/base.js").DatabasePoolDebugSnapshot} snapshot - Pool debug snapshot.
 * @returns {void}
 */
function expectLongCheckoutSnapshot(snapshot) {
  const inUseConnection = snapshot.connections.find((connection) => connection.state === "in-use")

  expect(inUseConnection?.checkoutName).toBe("long checkout")
  expect(inUseConnection?.checkedOutAt).toBeGreaterThan(0)
  expect(inUseConnection?.checkedOutForMs).toBeGreaterThanOrEqual(0)
}

describe("database - pool - async tracked multi connection checkout names", () => {
  it("rejects a queued checkout when activation fails", async () => {
    await withCheckoutNamePool(async (pool) => {
      const firstConnection = await pool.checkout({name: "first checkout"})
      const queuedCheckout = pool.checkout({name: "fail activation"})

      await pool.checkin(firstConnection)

      await timeout({timeout: 2000}, async () => {
        try {
          await queuedCheckout
          throw new Error("Queued checkout unexpectedly resolved")
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          expect(/** @type {Error} */ (error).message).toBe("Checkout name activation failed")
        }
      })

      expect(pool.pendingCheckouts.length).toBe(0)
    })
  })

  it("reports in-use and pending checkout timing in debug snapshots", async () => {
    await withCheckoutNamePool(async (pool) => {
      const firstConnection = await pool.checkout({name: "long checkout"})
      const queuedCheckout = pool.checkout({name: "waiting checkout"})

      await wait(0.02)

      const snapshot = pool.getDebugSnapshot()

      expectWaitingCheckoutSnapshot(snapshot)
      expectLongCheckoutSnapshot(snapshot)

      await pool.checkin(firstConnection)

      const secondConnection = await queuedCheckout

      await pool.checkin(secondConnection)
    })
  })

  it("uses default, configured, and disabled checkout timeouts", async () => {
    await withCheckoutNamePool(async (pool) => {
      expect(pool.checkoutTimeoutMillis()).toBe(10000)

      pool.getConfiguration().pool = {checkoutTimeoutMillis: 25, max: 1}
      expect(pool.checkoutTimeoutMillis()).toBe(25)

      pool.getConfiguration().pool = {checkoutTimeoutMillis: null, max: 1}
      expect(pool.checkoutTimeoutMillis()).toBe(null)
    })
  })

  it("rejects a queued checkout when the checkout timeout expires", async () => {
    await withCheckoutNamePool(async (pool) => {
      const firstConnection = await pool.checkout({name: "long checkout"})
      const queuedCheckout = pool.checkout({name: "waiting checkout"})

      await wait(0)

      const timeoutTimer = pool.pendingCheckouts[0]?.timeoutTimer

      if (!timeoutTimer || typeof timeoutTimer !== "object" || typeof timeoutTimer.hasRef !== "function") {
        throw new Error("Expected pending checkout timeout timer")
      }

      expect((/** @type {{hasRef: () => boolean}} */ (timeoutTimer)).hasRef()).toBe(true)

      await timeout({timeout: 2000}, async () => {
        try {
          await queuedCheckout
          throw new Error("Queued checkout unexpectedly resolved")
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          expect(/** @type {Error} */ (error).message).toContain("Timed out after 20ms waiting for database connection checkout from pool \"default\". Checkout name: \"waiting checkout\".")
          expect(/** @type {Error} */ (error).message).toContain("Pool state: max=1, inUse=1, idle=0")
          expect(/** @type {Error} */ (error).message).toContain("checkout=\"long checkout\"")
          expect(/** @type {Error} */ (error).message).toContain("openTransactions=0")
          expect(/** @type {Error} */ (error).message).not.toContain("sqlPreview")
        }
      })

      expect(pool.pendingCheckouts.length).toBe(0)

      await pool.checkin(firstConnection)
    }, {checkoutTimeoutMillis: 20, max: 1})
  })

  it("keeps later queued checkouts when an earlier checkout times out during capacity cleanup", async () => {
    await withCheckoutNamePool(async (pool) => {
      const oldConfigConnection = await pool.checkout({name: "old config checkout"})

      await pool.checkin(oldConfigConnection)

      pool.getConfiguration().name = "pool-checkout-name-timeout-survivor"
      CheckoutNameFailingSqliteDriver.closeDelayMillis = 50

      try {
        const databaseConfig = pool.getConfiguration()
        const reuseKey = pool.getConfigurationReuseKey()

        pool.getConfiguration().pool = {checkoutTimeoutMillis: 10, max: 1}

        const timedOutCheckout = pool.waitForCheckout(databaseConfig, reuseKey, {name: "timed out checkout"})

        pool.getConfiguration().pool = {checkoutTimeoutMillis: null, max: 1}

        const survivingCheckout = pool.waitForCheckout(databaseConfig, reuseKey, {name: "surviving checkout"})

        await timeout({timeout: 2000}, async () => {
          try {
            await timedOutCheckout
            throw new Error("Queued checkout unexpectedly resolved")
          } catch (error) {
            expect(error).toBeInstanceOf(Error)
            expect(/** @type {Error} */ (error).message).toContain("Timed out after 10ms waiting for database connection checkout from pool \"default\". Checkout name: \"timed out checkout\".")
            expect(/** @type {Error} */ (error).message).toContain("Pool state: max=1")
          }
        })

        const survivingConnection = await timeout({timeout: 2000}, async () => await survivingCheckout)

        await pool.checkin(survivingConnection)
      } finally {
        CheckoutNameFailingSqliteDriver.closeDelayMillis = 0
      }
    }, {checkoutTimeoutMillis: 10, max: 1})
  })

  it("leaves queued checkouts waiting when checkout timeout is disabled", async () => {
    await withCheckoutNamePool(async (pool) => {
      const firstConnection = await pool.checkout({name: "long checkout"})
      const queuedCheckout = pool.checkout({name: "waiting checkout"})

      await wait(0.02)

      const snapshot = pool.getDebugSnapshot()

      expect(snapshot.pendingCheckoutCount).toBe(1)
      expect(snapshot.pendingCheckouts?.[0]?.timeoutMillis).toBe(null)
      expect(snapshot.pendingCheckouts?.[0]?.remainingTimeoutMs).toBe(null)

      await pool.checkin(firstConnection)

      const secondConnection = await queuedCheckout

      await pool.checkin(secondConnection)
    }, {checkoutTimeoutMillis: null, max: 1})
  })
})
