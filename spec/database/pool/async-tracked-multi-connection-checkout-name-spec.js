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
  /**
   * @param {string | undefined} name - Human-readable name for this active checkout.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async setConnectionCheckoutName(name) {
    if (name == "fail activation") throw new Error("Checkout name activation failed")

    await super.setConnectionCheckoutName(name)
  }
}

/** @returns {Promise<Configuration>} - Configuration backed by a temp SQLite database. */
async function testConfiguration() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-pool-checkout-name-"))

  return new Configuration({
    database: {
      test: {
        default: {
          driver: CheckoutNameFailingSqliteDriver,
          migrations: false,
          name: "pool-checkout-name-test",
          pool: {max: 1},
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

describe("database - pool - async tracked multi connection checkout names", () => {
  it("rejects a queued checkout when activation fails", async () => {
    const configuration = await testConfiguration()

    try {
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected async tracked pool")

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
    } finally {
      await configuration.closeDatabaseConnections()
    }
  })

  it("reports in-use and pending checkout timing in debug snapshots", async () => {
    const configuration = await testConfiguration()

    try {
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected async tracked pool")

      const firstConnection = await pool.checkout({name: "long checkout"})
      const queuedCheckout = pool.checkout({name: "waiting checkout"})

      await wait(0.02)

      const snapshot = pool.getDebugSnapshot()

      expect(snapshot.inUseCount).toBe(1)
      expect(snapshot.pendingCheckoutCount).toBe(1)
      expect(snapshot.pendingCheckouts?.[0]?.checkoutName).toBe("waiting checkout")
      expect(snapshot.pendingCheckouts?.[0]?.waitingForMs).toBeGreaterThanOrEqual(0)

      const inUseConnection = snapshot.connections.find((connection) => connection.state === "in-use")

      expect(inUseConnection?.checkoutName).toBe("long checkout")
      expect(inUseConnection?.checkedOutAt).toBeGreaterThan(0)
      expect(inUseConnection?.checkedOutForMs).toBeGreaterThanOrEqual(0)

      await pool.checkin(firstConnection)

      const secondConnection = await queuedCheckout

      await pool.checkin(secondConnection)
    } finally {
      await configuration.closeDatabaseConnections()
    }
  })
})
