// @ts-check

import Configuration from "../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import { describe, expect, it } from "../../../../src/testing/test.js"

const SECRET_SQL = "UPDATE `accounts` SET `token` = 'secret-token-91827' WHERE `email` = 'owner@example.test' AND `balance` = 12345"

function configuration() {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

class DiagnosticMysqlDriver extends MysqlDriver {
  attempts = 0
  captureFailure = false
  diagnosticPipelineFailure = false

  /** @returns {Promise<void>} - Resolves without a real retry delay. */
  async _waitMs() {}

  /** @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe diagnostic context. */
  async _deadlockDiagnosticContext() {
    if (this.diagnosticPipelineFailure) throw new Error("simulated diagnostic pipeline failure")

    return await super._deadlockDiagnosticContext()
  }

  /** @returns {Promise<import("../../../../src/database/drivers/base.js").QueryResultType>} - Query result. */
  async _queryActual(sql) {
    if (sql == "START TRANSACTION" || sql == "ROLLBACK" || sql == "COMMIT") return []

    this.attempts++
    if (this.attempts == 1) {
      const mysqlError = new Error("Deadlock found when trying to get lock")
      // @ts-expect-error MySQL attaches its symbolic error code at runtime.
      mysqlError.code = "ER_LOCK_DEADLOCK"
      throw new Error("Query failed", {cause: mysqlError})
    }

    return []
  }

  /** @returns {Promise<string>} - Simulated InnoDB status. */
  async _captureInnodbDeadlockStatus() {
    if (this.captureFailure) throw new Error("diagnostic connection password=do-not-report")

    return `LATEST DETECTED DEADLOCK
*** (1) TRANSACTION:
TRANSACTION 123, ACTIVE 1 sec
${SECRET_SQL}
*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 8 page no 4 n bits 72 index \`email\` of table \`app\`.\`accounts\` trx id 123 lock_mode X waiting
Record lock, heap no 2 PHYSICAL RECORD: n_fields 2; compact format
 0: len 30; hex 7365637265742d746f6b656e2d3931383237; asc secret-token-91827;;
*** WE ROLL BACK TRANSACTION (1)
${"ignored status line\n".repeat(500)}`
  }
}

describe("Database - drivers - mysql deadlock diagnostics", () => {
  it("reports bounded redacted context without changing the retry budget", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnostics = []
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await diagnosticReported

    expect(driver.attempts).toEqual(2)
    expect(diagnostics.length).toEqual(1)
    expect(diagnostics[0].context).toMatchObject({
      attempt: 1,
      driverType: "mysql",
      maxAttempts: 2,
      stage: "database-deadlock-retry",
      statusCapture: "captured",
      willRetry: true
    })
    expect(diagnostics[0].context.sqlFingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(diagnostics[0].context.sqlOperation).toEqual("UPDATE")
    expect(diagnostics[0].context.innodbDeadlockSummary).toEqual({transactions: 1, victimTransaction: 1})
    expect(JSON.stringify(diagnostics[0])).not.toContain("secret-token-91827")
    expect(JSON.stringify(diagnostics[0])).not.toContain("owner@example.test")
    expect(JSON.stringify(diagnostics[0])).not.toContain("12345")
    expect(JSON.stringify(diagnostics[0])).not.toContain("736563726574")
  })

  it("keeps retrying when best-effort InnoDB status capture fails", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnostics = []
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

    driver.captureFailure = true
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await diagnosticReported

    expect(driver.attempts).toEqual(2)
    expect(diagnostics.length).toEqual(1)
    expect(diagnostics[0].context.statusCapture).toEqual("failed")
    expect(JSON.stringify(diagnostics[0])).not.toContain("do-not-report")
  })

  it("normalizes comment markers inside quoted literals before fingerprinting", async () => {
    const fingerprints = []

    for (const token of ["alpha--suffix#one", "beta--suffix#two"]) {
      const appConfiguration = configuration()
      const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
      const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

      driver.setDesiredSessionTimeZone(null)
      appConfiguration.getErrorEvents().once("database-deadlock-retry", (payload) => fingerprints.push(payload.context.sqlFingerprint))
      await driver.transaction(async () => await driver.query(`UPDATE accounts SET token = '${token}' WHERE id = 42`))
      await diagnosticReported
    }

    expect(fingerprints.length).toEqual(2)
    expect(fingerprints[0]).toEqual(fingerprints[1])
  })

  it("surfaces unexpected diagnostic pipeline failures without stopping retries", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const frameworkErrors = []
    const frameworkErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("framework-error", resolve))

    driver.diagnosticPipelineFailure = true
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await frameworkErrorReported

    expect(driver.attempts).toEqual(2)
    expect(frameworkErrors.length).toEqual(1)
    expect(frameworkErrors[0].context.stage).toEqual("database-deadlock-retry-diagnostic")
    expect(frameworkErrors[0].error.message).toEqual("simulated diagnostic pipeline failure")
  })
})
