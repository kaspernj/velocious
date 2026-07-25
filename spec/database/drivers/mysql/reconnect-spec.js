// @ts-check

import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

const configuration = /** @type {any} */ ({
  debug: false,
  getCurrentRequestTiming: () => undefined,
  getQueryLoggingEnabled: () => false
})

class FailingAdvisoryLockReleaseMysqlDriver extends MysqlDriver {
  reconnectCount = 0
  releaseAttempts = 0

  /** @returns {Promise<void>} - Records an unexpected reconnect. */
  async reconnect() {
    this.reconnectCount++
  }

  /**
   * Simulates one acquired lock followed by a lost connection during release.
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../../../../src/database/drivers/base.js").QueryResultType>} - Query rows.
   */
  async _queryActual(sql) {
    if (sql.startsWith("SELECT GET_LOCK")) return [{velocious_advisory_lock_result: 1}]

    if (sql.startsWith("SELECT RELEASE_LOCK")) {
      this.releaseAttempts++

      const connectionError = new Error("Connection lost during advisory lock release")
      // @ts-expect-error MySQL attaches its symbolic error code at runtime.
      connectionError.code = "PROTOCOL_CONNECTION_LOST"

      throw new Error("Query failed", {cause: connectionError})
    }

    return []
  }
}

describe("Database - drivers - mysql reconnect", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("connects when the pool is missing", async () => {
    const driver = new MysqlDriver({}, configuration)
    let didConnect = false

    driver.connect = async () => {
      didConnect = true
      driver.pool = {
        escape: (value) => `'${value}'`,
        getConnection: (connectionCallback) => connectionCallback(null, {
          query: (sql, cb) => cb(null, [{result: 1}], [{name: "result"}]),
          release: () => {},
          destroy: () => {}
        })
      }
    }

    const rows = await driver.query("SELECT 1")

    expect(didConnect).toBeTrue()
    expect(rows).toEqual([{result: 1}])
  })

  it("escapes values without a pool", () => {
    const driver = new MysqlDriver({}, configuration)

    const escaped = driver.escape("hello")
    const quoted = driver.quote("hello")

    expect(escaped).toEqual("hello")
    expect(quoted).toEqual("'hello'")
  })

  it("retries and reconnects after connection failures", async () => {
    const driver = new MysqlDriver({}, configuration)
    let connectCount = 0
    let closeCount = 0
    let attempts = 0

    driver.connect = async () => {
      connectCount++
      driver._sessionTimezoneSetToUtc = false
      driver.pool = {
        escape: (value) => `'${value}'`,
        getConnection: (connectionCallback) => connectionCallback(null, {
          query: (sql, cb) => {
            if (sql == "SET time_zone = '+00:00'") {
              cb(null, [], [])
              return
            }

            attempts++

            if (attempts < 3) {
              cb(new Error("connect ECONNREFUSED 127.0.0.1:3306"))
            } else {
              cb(null, [{result: 1}], [{name: "result"}])
            }
          },
          release: () => {},
          destroy: () => {}
        })
      }
    }

    driver.close = async () => {
      closeCount++
      driver.pool = undefined
    }

    const rows = await driver.query("SELECT 1")

    expect(rows).toEqual([{result: 1}])
    expect(attempts).toEqual(3)
    expect(connectCount).toEqual(3)
    expect(closeCount).toEqual(2)
  })

  it("retries a wrapped ER_CHECKREAD without reconnecting", async () => {
    const driver = new MysqlDriver({}, configuration)
    let attempts = 0
    let reconnectCount = 0

    driver.setDesiredSessionTimeZone(null)
    driver.reconnect = async () => {
      reconnectCount++
    }
    driver._queryActual = async () => {
      attempts++

      if (attempts == 1) {
        const mysqlError = new Error("Record has changed since last read in table 'background_jobs'")
        // @ts-expect-error MySQL attaches its symbolic error code at runtime.
        mysqlError.code = "ER_CHECKREAD"
        throw new Error("Query failed", {cause: mysqlError})
      }

      return [{result: 1}]
    }

    const rows = await driver.query("SELECT 1")

    expect(rows).toEqual([{result: 1}])
    expect(attempts).toEqual(2)
    expect(reconnectCount).toEqual(0)
  })

  it("raises when a reconnect would bypass an active transaction", async () => {
    const driver = new MysqlDriver({}, configuration)
    let didReconnect = false

    driver._transactionsCount = 1

    driver.connect = async () => {
      driver.pool = {
        escape: (value) => `'${value}'`,
        getConnection: (connectionCallback) => connectionCallback(null, {
          query: (sql, cb) => {
            if (sql == "SET time_zone = '+00:00'") {
              cb(null, [], [])
              return
            }

            cb(new Error("connect ECONNREFUSED 127.0.0.1:3306"))
          },
          release: () => {},
          destroy: () => {}
        })
      }
    }

    driver.reconnect = async () => {
      didReconnect = true
    }

    await expect(async () => {
      await driver.query("SELECT 1")
    }).toThrowError("Cannot reconnect while a transaction is active (1). Original error: Query failed: Query failed because of Error: connect ECONNREFUSED 127.0.0.1:3306: SELECT 1")
    expect(didReconnect).toBeFalse()
  })

  it("does not reconnect while closing a session with an advisory lock", async () => {
    const driver = new FailingAdvisoryLockReleaseMysqlDriver({}, configuration)

    driver.setDesiredSessionTimeZone(null)

    expect(await driver.tryAcquireAdvisoryLock("release-without-reconnect")).toBeTrue()

    await expect(async () => {
      await driver.close()
    }).toThrowError("Query failed")

    expect(driver.releaseAttempts).toEqual(1)
    expect(driver.reconnectCount).toEqual(0)
  })
})
