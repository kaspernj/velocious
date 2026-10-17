// @ts-check

import MysqlDriver from "../../../src/database/drivers/mysql/index.js"
import PgsqlDriver from "../../../src/database/drivers/pgsql/index.js"
import VelociousDatabaseDriversSqliteNode from "../../../src/database/drivers/sqlite/index.js"
import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "../../../src/testing/test.js"

/**
 * Captures the driver-native lock statements instead of talking to a
 * server, and reports the native tier as free for the first caller and
 * busy for every later one, so the tests observe exactly which tier each
 * acquisition passed through.
 * @extends MysqlDriver
 */
class CapturingMysqlDriver extends MysqlDriver {
  /** @type {string[]} - Captured native-tier statements. */
  statements = []
  /** @type {boolean} - Whether the native tier reports the name free. */
  nativeFree = true

  /**
   * Captures the statement and reports the native-tier result.
   * @param {string} sql - SQL to capture.
   * @returns {Promise<Array<Record<string, number | null>>>} - One lock row.
   */
  async query(sql) {
    this.statements.push(sql)

    return [{velocious_advisory_lock_result: this.nativeFree ? 1 : 0}]
  }
}

/**
 * @extends PgsqlDriver
 */
class CapturingPgsqlDriver extends PgsqlDriver {
  /** @type {string[]} - Captured native-tier statements. */
  statements = []
  /** @type {boolean} - Whether the native tier reports the name free. */
  nativeFree = true

  /**
   * Captures the statement and reports the native-tier result.
   * @param {string} sql - SQL to capture.
   * @returns {Promise<Array<Record<string, boolean | null>>>} - One lock row.
   */
  async query(sql) {
    this.statements.push(sql)

    return [{velocious_advisory_lock_result: this.nativeFree ? true : false}]
  }
}

/**
 * Node SQLite driver whose filesystem tier is replaced by a programmable
 * gate so the tests can prove the process-local tier runs in front of it
 * without touching the real filesystem authority.
 * @extends VelociousDatabaseDriversSqliteNode
 */
class GateSqliteDriver extends VelociousDatabaseDriversSqliteNode {
  /** @type {number} - Native-tier attempts recorded. */
  nativeAttempts = 0
  /** @type {boolean} - Whether the native tier reports the name free. */
  nativeFree = true

  /**
   * Records the native-tier attempt without touching the filesystem.
   * @param {string} _name - Lock name.
   * @param {{timeoutMs?: number | null}} [_args] - Timeout args.
   * @returns {Promise<boolean>} - Gate result.
   */
  async _acquireAdvisoryLock(_name, _args = {}) {
    this.nativeAttempts++

    return this.nativeFree
  }

  /**
   * Records the native-tier attempt without touching the filesystem.
   * @param {string} _name - Lock name.
   * @returns {Promise<boolean>} - Gate result.
   */
  async _tryAcquireAdvisoryLock(_name) {
    this.nativeAttempts++

    return this.nativeFree
  }

  /**
   * Reports the native-tier release without touching the filesystem.
   * @param {string} _name - Lock name.
   * @returns {Promise<boolean>} - Always true for the gate.
   */
  async _releaseAdvisoryLock(_name) {
    return true
  }
}

/**
 * Creates an isolated configuration for gate drivers that never connect to
 * a database.
 * @param {string} tag - Unique scratch directory suffix.
 * @returns {Promise<{configuration: Configuration, cleanup: () => Promise<void>}>} Isolated configuration.
 */
async function withGateConfiguration(tag) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `velocious-advisory-lock-tier-${tag}-`))
  const configuration = new Configuration({
    database: {test: {}},
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })

  return {configuration, cleanup: async () => { await fs.rm(directory, {force: true, recursive: true}) }}
}

describe("Database - drivers - process-local advisory-lock tier", () => {
  it("serves two callers in one process FIFO on MariaDB without a native lock query while queued", async () => {
    const {configuration, cleanup} = await withGateConfiguration("mysql-fifo")

    try {
      const first = new CapturingMysqlDriver({}, configuration)
      const second = new CapturingMysqlDriver({}, configuration)

      expect(await first.acquireAdvisoryLock("tier-fifo-mysql")).toBe(true)
      expect(first.statements).toHaveLength(1)
      expect(first.statements[0]).toContain("GET_LOCK")

      // The second caller is queued in the process-local tier: it must not
      // reach the native tier (no GET_LOCK, no parked connection) until the
      // first releases.
      let secondResolved = false
      const secondAcquisition = second.acquireAdvisoryLock("tier-fifo-mysql").then((acquired) => {
        secondResolved = true

        return acquired
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(secondResolved).toBe(false)
      expect(second.statements).toHaveLength(0)

      expect(await first.releaseAdvisoryLock("tier-fifo-mysql")).toBe(true)

      expect(await secondAcquisition).toBe(true)
      expect(second.statements).toHaveLength(1)
      expect(second.statements[0]).toContain("GET_LOCK")
    } finally {
      await cleanup()
    }
  })

  it("serves two callers in one process FIFO on PostgreSQL without a native lock query while queued", async () => {
    const {configuration, cleanup} = await withGateConfiguration("pgsql-fifo")

    try {
      const first = new CapturingPgsqlDriver({}, configuration)
      const second = new CapturingPgsqlDriver({}, configuration)

      expect(await first.acquireAdvisoryLock("tier-fifo-pgsql")).toBe(true)
      expect(first.statements.some((statement) => statement.includes("pg_try_advisory_lock"))).toBe(true)

      let secondResolved = false
      const secondAcquisition = second.acquireAdvisoryLock("tier-fifo-pgsql").then((acquired) => {
        secondResolved = true

        return acquired
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(secondResolved).toBe(false)
      expect(second.statements).toHaveLength(0)

      expect(await first.releaseAdvisoryLock("tier-fifo-pgsql")).toBe(true)

      expect(await secondAcquisition).toBe(true)
      expect(second.statements.some((statement) => statement.includes("pg_try_advisory_lock"))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it("serves two callers in one process FIFO on SQLite without a native filesystem-tier attempt while queued", async () => {
    const {configuration, cleanup} = await withGateConfiguration("sqlite-fifo")

    try {
      const first = new GateSqliteDriver({type: "sqlite", name: "tier-fifo"}, configuration)
      const second = new GateSqliteDriver({type: "sqlite", name: "tier-fifo"}, configuration)

      expect(await first.acquireAdvisoryLock("tier-fifo-sqlite")).toBe(true)
      expect(first.nativeAttempts).toBe(1)

      let secondResolved = false
      const secondAcquisition = second.acquireAdvisoryLock("tier-fifo-sqlite").then((acquired) => {
        secondResolved = true

        return acquired
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(secondResolved).toBe(false)
      expect(second.nativeAttempts).toBe(0)

      expect(await first.releaseAdvisoryLock("tier-fifo-sqlite")).toBe(true)

      expect(await secondAcquisition).toBe(true)
      expect(second.nativeAttempts).toBe(1)
    } finally {
      await cleanup()
    }
  })

  it("never grants a lock on the process-local tier alone — the driver-native tier must confirm it", async () => {
    const {configuration, cleanup} = await withGateConfiguration("not-authority")

    try {
      const driver = new CapturingMysqlDriver({}, configuration)
      // A second process (simulated by the native tier reporting the name
      // held by another session) must still win over the free in-process
      // tier: the tier alone is never the authority.
      driver.nativeFree = false

      expect(await driver.tryAcquireAdvisoryLock("tier-not-authority")).toBe(false)
      expect(driver.statements.some((statement) => statement.includes("GET_LOCK"))).toBe(true)

      // The failed native check must have rolled the in-process tier back:
      // a fresh caller passes the tier and reaches the native tier instead
      // of being locked out by the ghost owner.
      const next = new CapturingMysqlDriver({}, configuration)

      next.nativeFree = false

      expect(await next.tryAcquireAdvisoryLock("tier-not-authority")).toBe(false)
      expect(next.statements.some((statement) => statement.includes("GET_LOCK"))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it("bounds the whole two-tier acquisition with the framework default on every driver", async () => {
    const {configuration, cleanup} = await withGateConfiguration("bounded")

    try {
      const holder = new GateSqliteDriver({type: "sqlite", name: "tier-bounded"}, configuration)

      expect(await holder.tryAcquireAdvisoryLock("tier-bounded")).toBe(true)

      const waiter = new GateSqliteDriver({type: "sqlite", name: "tier-bounded"}, configuration)

      // Queued waiter times out inside the process-local tier and never
      // touches the native tier.
      expect(await waiter.acquireAdvisoryLock("tier-bounded", {timeoutMs: 30})).toBe(false)
      expect(waiter.nativeAttempts).toBe(0)

      // A timed-out waiter must not leave a ghost entry in the queue.
      expect(await holder.releaseAdvisoryLock("tier-bounded")).toBe(true)

      const next = new GateSqliteDriver({type: "sqlite", name: "tier-bounded"}, configuration)

      expect(await next.tryAcquireAdvisoryLock("tier-bounded")).toBe(true)
      expect(next.nativeAttempts).toBe(1)
    } finally {
      await cleanup()
    }
  })

  it("keeps the tier per driver instance so a second session in the same process is not mistaken for cross-host exclusion", async () => {
    const {configuration, cleanup} = await withGateConfiguration("per-instance")

    try {
      const owner = new CapturingMysqlDriver({}, configuration)
      const sibling = new CapturingMysqlDriver({}, configuration)

      expect(await owner.tryAcquireAdvisoryLock("tier-per-instance")).toBe(true)

      // The sibling is a different session: the tier refuses it before any
      // native query, and the native tier (which is the real cross-session
      // authority) is only consulted for callers the tier admits.
      expect(await sibling.tryAcquireAdvisoryLock("tier-per-instance")).toBe(false)
      expect(sibling.statements).toHaveLength(0)

      expect(await owner.releaseAdvisoryLock("tier-per-instance")).toBe(true)

      // Now the sibling passes the tier and the native tier confirms it.
      expect(await sibling.tryAcquireAdvisoryLock("tier-per-instance")).toBe(true)
      expect(sibling.statements.some((statement) => statement.includes("GET_LOCK"))).toBe(true)
    } finally {
      await cleanup()
    }
  })
})
