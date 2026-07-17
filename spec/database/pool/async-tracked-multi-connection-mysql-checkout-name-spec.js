// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import MysqlDriver from "../../../src/database/drivers/mysql/index.js"
import os from "os"
import path from "path"
import {forcedError} from "typanic"
import {describe, expect, it} from "../../../src/testing/test.js"

class CheckoutNameCapturingMysqlDriver extends MysqlDriver {
  /** @type {boolean} */
  static failClear = false

  /** @type {string[]} */
  checkoutNameQueries = []

  /** @type {boolean} */
  closed = false

  /** @returns {Promise<void>} - Resolves when connected. */
  async connect() {
    // The lifecycle behavior under test does not need a network connection.
  }

  /** @returns {Promise<void>} - Resolves when closed. */
  async close() {
    this.closed = true
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Empty query result.
   */
  async query(sql) {
    this.checkoutNameQueries.push(sql)

    if (CheckoutNameCapturingMysqlDriver.failClear && sql == "SET @velocious_connection_checkout_name = NULL") {
      throw new Error("Checkout name clear failed")
    }

    return []
  }
}

/**
 * @param {(pool: AsyncTrackedMultiConnection) => Promise<void>} callback - Spec body.
 * @returns {Promise<void>} - Resolves after closing database connections.
 */
async function withMysqlCheckoutNamePool(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mysql-pool-checkout-name-"))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: CheckoutNameCapturingMysqlDriver,
          migrations: false,
          name: "pool-checkout-name-test",
          pool: {max: 1},
          poolType: AsyncTrackedMultiConnection,
          type: "mysql"
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })

  try {
    const pool = configuration.getDatabasePool("default")

    if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected async tracked pool")

    await callback(pool)
  } finally {
    CheckoutNameCapturingMysqlDriver.failClear = false
    await configuration.closeDatabaseConnections()
    await fs.rm(directory, {force: true, recursive: true})
  }
}

describe("database - pool - async tracked multi connection MySQL checkout names", () => {
  it("does not issue checkout-name SQL for an unnamed lease", async () => {
    await withMysqlCheckoutNamePool(async (pool) => {
      const connection = /** @type {CheckoutNameCapturingMysqlDriver} */ (await pool.checkout())
      const checkedOutSnapshot = connection.getDebugSnapshot()

      expect(checkedOutSnapshot.checkedOutAtUnixMs).toBeGreaterThan(0)
      expect(checkedOutSnapshot.checkoutAgeMs).toBeGreaterThanOrEqual(0)

      await pool.checkin(connection)

      expect(connection.checkoutNameQueries).toEqual([])
      expect(connection.getDebugSnapshot().checkedOutAtUnixMs).toBe(undefined)
      expect(connection.getDebugSnapshot().checkoutAgeMs).toBe(undefined)
    })
  })

  it("clears a named lease before reusing its connection unnamed", async () => {
    await withMysqlCheckoutNamePool(async (pool) => {
      const namedConnection = /** @type {CheckoutNameCapturingMysqlDriver} */ (await pool.checkout({name: "named checkout"}))

      await pool.checkin(namedConnection)

      const unnamedConnection = /** @type {CheckoutNameCapturingMysqlDriver} */ (await pool.checkout())

      expect(unnamedConnection).toBe(namedConnection)
      expect(unnamedConnection.checkoutNameQueries).toEqual([
        "SET @velocious_connection_checkout_name = 'named checkout'",
        "SET @velocious_connection_checkout_name = NULL"
      ])

      await pool.checkin(unnamedConnection)

      expect(unnamedConnection.checkoutNameQueries).toHaveLength(2)
    })
  })

  it("clears a checkout name set after an unnamed checkout before reusing its connection unnamed", async () => {
    await withMysqlCheckoutNamePool(async (pool) => {
      const namedConnection = /** @type {CheckoutNameCapturingMysqlDriver} */ (await pool.checkout())

      expect(namedConnection.checkoutNameQueries).toEqual([])

      await namedConnection.setConnectionCheckoutName("late checkout name")
      await pool.checkin(namedConnection)

      const unnamedConnection = /** @type {CheckoutNameCapturingMysqlDriver} */ (await pool.checkout())

      expect(unnamedConnection).toBe(namedConnection)
      expect(unnamedConnection.checkoutNameQueries).toEqual([
        "SET @velocious_connection_checkout_name = 'late checkout name'",
        "SET @velocious_connection_checkout_name = NULL"
      ])

      await pool.checkin(unnamedConnection)

      expect(unnamedConnection.checkoutNameQueries).toHaveLength(2)
    })
  })

  it("disposes a connection when clearing a named lease fails", async () => {
    await withMysqlCheckoutNamePool(async (pool) => {
      const connection = /** @type {CheckoutNameCapturingMysqlDriver} */ (await pool.checkout({name: "named checkout"}))

      CheckoutNameCapturingMysqlDriver.failClear = true

      try {
        await pool.checkin(connection)
        throw new Error("Check-in unexpectedly succeeded")
      } catch (error) {
        expect(forcedError(error).message).toBe("Checkout name clear failed")
      }

      expect(connection.closed).toBe(true)
      expect(pool.connections).toEqual([])
      expect(pool.connectionsInUse).toEqual({})
    })
  })
})
