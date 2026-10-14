// @ts-check

import DatabaseDriver from "../../src/database/drivers/base.js"
import MysqlDriver from "../../src/database/drivers/mysql/index.js"
import {DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS} from "../../src/database/advisory-lock-bound.js"
import {describe, expect, it} from "../../src/testing/test.js"

const CONFIGURED_TIMEOUT_MS = 12345

/**
 * Driver that records the timeout each advisory-lock acquisition actually received.
 * @extends DatabaseDriver
 */
class RecordingDriver extends DatabaseDriver {
  /** @type {Array<{name: string, timeoutMs: number | null | undefined}>} - Recorded acquisitions. */
  acquireCalls = []

  /**
   * Records the requested acquisition and succeeds.
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [_args] - Acquisition options.
   * @returns {Promise<boolean>} - Always acquired.
   */
  async _acquireAdvisoryLock(name, _args = {}) {
    this.acquireCalls.push({name, timeoutMs: _args.timeoutMs})

    return true
  }
}

/**
 * MySQL driver that captures the emitted GET_LOCK statement instead of talking to a server.
 * @extends MysqlDriver
 */
class CapturingMysqlDriver extends MysqlDriver {
  /** @type {string[]} - Captured SQL statements. */
  statements = []

  /**
   * Captures the statement and reports a successful lock.
   * @param {string} sql - SQL to capture.
   * @returns {Promise<Array<Record<string, number>>>} - One acquired-lock row.
   */
  async query(sql) {
    this.statements.push(sql)

    return [{velocious_advisory_lock_result: 1}]
  }
}

/**
 * Extracts the GET_LOCK wait seconds from a captured statement.
 * @param {string} sql - Captured `SELECT GET_LOCK(...)` statement.
 * @returns {number} - Requested wait in seconds.
 */
function getLockWaitSeconds(sql) {
  const match = sql.match(/GET_LOCK\([^,]+,\s*(\d+)\)/)

  if (!match) throw new Error(`Captured statement has no GET_LOCK wait seconds: ${sql}`)

  return Number(match[1])
}

describe("Advisory lock acquisition timeout", () => {
  it("bounds an advisory-lock acquisition when the caller passes no timeout", async () => {
    const driver = new RecordingDriver({advisoryLockAcquireTimeoutMs: CONFIGURED_TIMEOUT_MS}, /** @type {any} */ ({}))

    expect(await driver.acquireAdvisoryLock("configured-bound")).toBe(true)
    expect(driver.acquireCalls).toEqual([{name: "configured-bound", timeoutMs: CONFIGURED_TIMEOUT_MS}])
  })

  it("bounds an unconfigured advisory-lock acquisition with a finite framework default", async () => {
    const driver = new RecordingDriver({}, /** @type {any} */ ({}))

    expect(await driver.acquireAdvisoryLock("framework-default")).toBe(true)

    const timeoutMs = driver.acquireCalls[0].timeoutMs

    expect(timeoutMs).toEqual(DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS)
  })

  it("keeps an explicit caller timeout", async () => {
    const driver = new RecordingDriver({advisoryLockAcquireTimeoutMs: CONFIGURED_TIMEOUT_MS}, /** @type {any} */ ({}))

    await driver.acquireAdvisoryLock("explicit-bound", {timeoutMs: 250})

    expect(driver.acquireCalls).toEqual([{name: "explicit-bound", timeoutMs: 250}])
  })

  it("honours an explicit null as an intentional indefinite wait", async () => {
    const driver = new RecordingDriver({advisoryLockAcquireTimeoutMs: CONFIGURED_TIMEOUT_MS}, /** @type {any} */ ({}))

    await driver.acquireAdvisoryLock("opt-out", {timeoutMs: null})

    expect(driver.acquireCalls).toEqual([{name: "opt-out", timeoutMs: null}])
  })

  it("honours a null database configuration as an intentional indefinite wait", async () => {
    const driver = new RecordingDriver({advisoryLockAcquireTimeoutMs: null}, /** @type {any} */ ({}))

    await driver.acquireAdvisoryLock("configured-opt-out")

    expect(driver.acquireCalls).toEqual([{name: "configured-opt-out", timeoutMs: null}])
  })

  it("emits a bounded MySQL GET_LOCK wait for the configured database bound", async () => {
    const driver = new CapturingMysqlDriver({advisoryLockAcquireTimeoutMs: 4000}, /** @type {any} */ ({}))

    expect(await driver.acquireAdvisoryLock("tensorbuzz-chained-transition-probe")).toBe(true)
    expect(getLockWaitSeconds(driver.statements[0])).toEqual(4)
  })

  it("never emits the indefinite MySQL GET_LOCK wait for an unconfigured caller", async () => {
    const driver = new CapturingMysqlDriver({}, /** @type {any} */ ({}))

    await driver.acquireAdvisoryLock("tensorbuzz-unconfigured-probe")

    expect(getLockWaitSeconds(driver.statements[0])).toEqual(DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS / 1000)
  })
})
