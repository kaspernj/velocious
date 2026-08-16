// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import TestProfiler from "../../../src/testing/test-profiler.js"

class ProfileMetricsDriver extends DatabaseDriverBase {
  /** @returns {string} - Driver type. */
  getType() { return "profile-test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async _queryActual(sql) {
    if (sql.includes("FAIL_PROFILE_QUERY")) throw new Error("secret database failure text")

    return []
  }

  /** @returns {Promise<number>} - Simulated affected rows. */
  async _affectedRowsActual() { return 1 }
}

describe("test profiler database metrics", () => {
  it("allowlists serialized SQL operations without exposing arbitrary leading tokens", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const profiler = new TestProfiler({configuration, projectDirectory: process.cwd()})
    const filePath = `${process.cwd()}/spec/database/profile-operation-example-spec.js`
    const attempt = profiler.startAttempt({
      attemptNumber: 1,
      descriptions: ["database profile operations"],
      testData: {args: {}, filePath, line: 8, ownerFilePath: filePath, function: async () => {}},
      testDescription: "records safe operations"
    })
    const driver = new ProfileMetricsDriver({}, configuration)

    await profiler.runAttempt(attempt, async () => {
      await driver.query("SensitiveTenantValue malformed profile query")
      await driver.query("SELECT 1")
      await driver.query("INSERT INTO profile_values(id) VALUES (1)")
      await driver.query("WITH profile_value AS (SELECT 1) SELECT * FROM profile_value")
    })
    profiler.finishAttempt(attempt, "passed")

    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })
    const serialized = JSON.stringify(profile)
    const operations = profile.database.fingerprints.map((fingerprint) => fingerprint.operation)

    expect(operations).toEqual(["INSERT", "SELECT", "UNKNOWN", "WITH"])
    expect(serialized.includes("SENSITIVETENANTVALUE")).toBe(false)
    expect(serialized.includes("SensitiveTenantValue")).toBe(false)
  })

  it("records physical query attempts and transaction actions without retaining sensitive values", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const profiler = new TestProfiler({configuration, projectDirectory: process.cwd()})
    const filePath = `${process.cwd()}/spec/database/profile-example-spec.js`
    const attempt = profiler.startAttempt({
      attemptNumber: 1,
      descriptions: ["database profile"],
      testData: {args: {}, filePath, line: 12, ownerFilePath: filePath, function: async () => {}},
      testDescription: "does database work"
    })
    const driver = new ProfileMetricsDriver({}, configuration)

    await profiler.runAttempt(attempt, async () => {
      await profiler.runSpan({phase: "test body"}, async () => {
        await driver.query("SELECT * FROM accounts WHERE token = 'super-secret-tenant'")
        await driver.affectedRows("DELETE FROM accounts WHERE token = 'super-secret-tenant'")

        try {
          await driver.query("UPDATE accounts SET token = 'super-secret-tenant' /* FAIL_PROFILE_QUERY */", {retry: false})
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
        }

        await driver.transaction(async () => {})

        try {
          await driver.transaction(async () => { throw new Error("secret callback failure") })
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
        }

        for (let index = 0; index < 55; index++) {
          await driver.query(`SELECT profile_column_${index} FROM profile_table_${index}`)
        }
      })
    })
    profiler.finishAttempt(attempt, "passed")

    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })
    const serialized = JSON.stringify(profile)

    expect(profile.database.queryCount).toBe(62)
    expect(profile.database.failedQueryCount).toBe(1)
    expect(profile.database.fingerprints.length).toBe(50)
    expect(profile.database.transactions.start.count).toBe(2)
    expect(profile.database.transactions.commit.count).toBe(1)
    expect(profile.database.transactions.rollback.count).toBe(1)
    expect(profile.database.totalMs).toBeGreaterThanOrEqual(0)
    expect(profile.database.maxMs).toBeGreaterThanOrEqual(0)
    expect(serialized.includes("super-secret-tenant")).toBe(false)
    expect(serialized.includes("secret database failure text")).toBe(false)
    expect(profile.tests[0].attempts[0].spans[0].database.queryCount).toBe(62)
  })
})
