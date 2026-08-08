// @ts-check

import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import {describe, expect, it} from "../../../src/testing/test.js"

class DiagnosticScanDriver extends DatabaseDriverBase {
  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /**
   * @param {string} _sql - SQL string.
   * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async _queryActual(_sql) {
    return []
  }
}

/** @returns {import("../../../src/configuration.js").default} - Configuration-shaped object. */
function buildConfiguration() {
  return /** @type {import("../../../src/configuration.js").default} */ ({
    getCurrentRequestTiming() {
      return undefined
    },
    getQueryLoggingEnabled() {
      return false
    }
  })
}

/**
 * Runs a callback while counting the total number of characters passed to the
 * most common String.prototype normalization methods. Used to prove that
 * diagnostic scans inspect only a bounded prefix of large statements.
 * @param {() => void} callback - Work that inspects a string.
 * @returns {number} - Total characters processed by patched methods.
 */
function countStringOperations(callback) {
  // Count the normalization methods that previously scanned the whole statement.
  // Slice is intentionally excluded: extracting a bounded prefix is the fix.
  const methods = ["replace", "trim", "toLowerCase"]
  /** @type {Record<string, Function>} */
  const originals = {}
  let processed = 0

  for (const method of methods) {
    originals[method] = String.prototype[method]
    String.prototype[method] = function (...args) {
      processed += String(this).length

      return originals[method].apply(this, args)
    }
  }

  try {
    callback()
  } finally {
    for (const method of methods) {
      String.prototype[method] = originals[method]
    }
  }

  return processed
}

/** @returns {string} - A 64 KiB non-DDL SELECT statement. */
function largeSelectSql() {
  const parts = ["SELECT 1"]

  while (parts.join("").length < 64 * 1024) {
    parts.push(", 1")
  }

  return parts.join("")
}

describe("Database drivers - SQL diagnostic scans", {databaseCleaning: {transaction: true}}, () => {
  describe("_debugSqlPreview", () => {
    it("returns the normalized start of a statement", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._debugSqlPreview("SELECT 1")).toEqual("SELECT 1")
      expect(driver._debugSqlPreview("  SELECT   1  ")).toEqual("SELECT 1")
      expect(driver._debugSqlPreview("SELECT\n\t1")).toEqual("SELECT 1")
    })

    it("treats a BOM as whitespace", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._debugSqlPreview("\ufeffSELECT 1")).toEqual("SELECT 1")
    })

    it("truncates previews to 500 characters", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())
      const longToken = "a".repeat(600)

      expect(driver._debugSqlPreview(longToken).length).toBe(500)
      expect(driver._debugSqlPreview(longToken)).toEqual("a".repeat(500))
    })

    it("includes a single space before the next token when truncation falls on whitespace", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._debugSqlPreview(`${"a".repeat(499)} ${"b".repeat(100)}`)).toEqual(`${"a".repeat(499)} `)
    })

    it("trims trailing whitespace from the full normalized statement", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._debugSqlPreview("SELECT 1   ")).toEqual("SELECT 1")
    })

    it("scans only a bounded prefix of large statements", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())
      const sql = largeSelectSql()
      const processed = countStringOperations(() => driver._debugSqlPreview(sql))

      expect(processed).toBeLessThan(sql.length / 2)
      expect(processed).toBeLessThanOrEqual(20000)
    })
  })

  describe("_schemaCacheInvalidatingSql", () => {
    it("returns false for non-DDL statements", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("SELECT 1")).toBe(false)
      expect(driver._schemaCacheInvalidatingSql("INSERT INTO tasks (name) VALUES ('x')")).toBe(false)
      expect(driver._schemaCacheInvalidatingSql("UPDATE tasks SET name = 'x'")).toBe(false)
      expect(driver._schemaCacheInvalidatingSql("DELETE FROM tasks")).toBe(false)
    })

    it("returns true for DDL statements", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("CREATE TABLE tasks (id int)")).toBe(true)
      expect(driver._schemaCacheInvalidatingSql("ALTER TABLE tasks ADD COLUMN name text")).toBe(true)
      expect(driver._schemaCacheInvalidatingSql("DROP TABLE tasks")).toBe(true)
      expect(driver._schemaCacheInvalidatingSql("RENAME TABLE tasks TO tasks_new")).toBe(true)
    })

    it("returns true for COMMENT ON statements", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("COMMENT ON COLUMN posts.title IS 'Visible title'")).toBe(true)
    })

    it("returns true for sp_rename via EXEC / EXECUTE", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("EXEC sp_rename 'tasks', 'tasks_new'")).toBe(true)
      expect(driver._schemaCacheInvalidatingSql("EXECUTE sp_rename 'tasks', 'tasks_new'")).toBe(true)
    })

    it("returns true for conditional DDL in T-SQL IF ... BEGIN blocks", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tasks') BEGIN CREATE TABLE tasks (id int) END")).toBe(true)
      expect(driver._schemaCacheInvalidatingSql("IF 1 = 1 BEGIN SELECT 1 END")).toBe(false)
    })

    it("returns true for BOM-prefixed DDL", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("\ufeffCREATE TABLE tasks (id int)")).toBe(true)
    })

    it("returns true for comment-prefixed DDL", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("/* migration */ CREATE TABLE tasks (id int)")).toBe(true)
      expect(driver._schemaCacheInvalidatingSql("-- migration\nCREATE TABLE tasks (id int)")).toBe(true)
    })

    it("does not treat DDL keywords inside comments as actual DDL", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())

      expect(driver._schemaCacheInvalidatingSql("/* CREATE TABLE */ SELECT 1")).toBe(false)
    })

    it("returns true for DDL after more than 8192 characters of leading whitespace/comment trivia", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())
      const trivia = `${" ".repeat(8192)}/* more */ -- line\n`

      expect(driver._schemaCacheInvalidatingSql(`${trivia}CREATE TABLE tasks (id int)`)).toBe(true)
    })

    it("returns true when the scan bound cuts off inside an unterminated block comment", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())
      const sql = `/* ${"x".repeat(10000)}CREATE TABLE tasks (id int)`

      expect(driver._schemaCacheInvalidatingSql(sql)).toBe(true)
    })

    it("returns false for ordinary large DML statements", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())
      const values = ", ('x')".repeat(4000)
      const sql = `INSERT INTO tasks (name) VALUES ${values}`

      expect(sql.length).toBeGreaterThan(8192)
      expect(driver._schemaCacheInvalidatingSql(sql)).toBe(false)
    })

    it("scans only a bounded prefix of large statements", async () => {
      const driver = new DiagnosticScanDriver({}, buildConfiguration())
      const sql = largeSelectSql()
      const processed = countStringOperations(() => driver._schemaCacheInvalidatingSql(sql))

      expect(processed).toBeLessThan(sql.length)
      expect(processed).toBeLessThanOrEqual(60000)
    })
  })
})
