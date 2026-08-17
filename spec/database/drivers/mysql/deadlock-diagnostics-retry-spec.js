// @ts-check

import LoggerArrayOutput from "../../../../src/logger/outputs/array-output.js"
import { describe, expect, it } from "../../../../src/testing/test.js"
import {
  configuration,
  DiagnosticMysqlDriver,
  SECRET_SQL
} from "../../../helpers/mysql-deadlock-diagnostics-test-helper.js"

describe("Database - drivers - mysql deadlock diagnostic retry behavior", () => {
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
    expect("databaseIdentifier" in diagnostics[0].context).toBeFalse()
    expect("databaseIdentityFingerprint" in diagnostics[0].context).toBeFalse()
    expect(diagnostics[0].context.innodbDeadlockSummary).toMatchObject({
      lockRecordsTruncated: false,
      sectionTruncated: false,
      transactionNodes: [{
        locks: [{lockMode: "X", state: "waiting"}],
        ordinal: 1
      }],
      transactionNodesTruncated: false,
      transactions: 1,
      victimTransaction: 1
    })
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

  it("retries lock-wait timeouts without capturing or attaching a stale deadlock graph", async () => {
    const loggingOutput = new LoggerArrayOutput()
    const appConfiguration = configuration(loggingOutput)
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnostics = []
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

    driver.contentionCode = "ER_LOCK_WAIT_TIMEOUT"
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await diagnosticReported

    expect(driver.attempts).toEqual(2)
    expect(driver.captureCalls).toEqual(0)
    expect(diagnostics[0].context.contentionKind).toEqual("lock-wait-timeout")
    expect(diagnostics[0].context.statusCapture).toEqual("not-applicable")
    expect("innodbDeadlockSummary" in diagnostics[0].context).toBeFalse()
    expect(loggingOutput.getLogs().some((log) => log.message.includes("lock-wait-timeout"))).toBeTrue()
    expect(loggingOutput.getLogs().some((log) => log.message.includes("after deadlock"))).toBeFalse()
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

  it("isolates a non-Promise driver diagnostic result without changing the retry result", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const frameworkErrors = []
    const allErrors = []
    const frameworkErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("framework-error", resolve))
    const allErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("all-error", resolve))

    driver.diagnosticReturnsNonPromise = true
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))
    appConfiguration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))

    const result = await driver.transaction(async () => {
      await driver.query(SECRET_SQL)

      return "retried-result"
    })

    await Promise.all([frameworkErrorReported, allErrorReported])

    expect(result).toEqual("retried-result")
    expect(driver.attempts).toEqual(2)
    expect(frameworkErrors.length).toEqual(1)
    expect(frameworkErrors[0].context.stage).toEqual("database-deadlock-retry-diagnostic")
    expect(allErrors.length).toEqual(1)
    expect(allErrors[0].errorType).toEqual("framework-error")
  })

  it("surfaces parser failures without stopping retries", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const frameworkErrors = []
    const frameworkErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("framework-error", resolve))

    driver.parserFailure = true
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await frameworkErrorReported

    expect(driver.attempts).toEqual(2)
    expect(frameworkErrors[0].error.message).toEqual("simulated deadlock parser failure")
  })

  it("isolates a diagnostic listener throw and still mirrors all-error without stopping retries", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const allErrors = []
    const allErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("all-error", resolve))

    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", () => { throw new Error("simulated listener failure") })
    appConfiguration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await allErrorReported

    expect(driver.attempts).toEqual(2)
    expect(allErrors.length).toEqual(1)
    expect(allErrors[0].errorType).toEqual("database-deadlock-retry")
  })

  it("does not emit a retry event when contention is exhausted and preserves the original error", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 1}, appConfiguration)
    const diagnostics = []
    const retryAllErrors = []
    /** @type {Error | undefined} */
    let transactionError

    driver.failedAttempts = 2
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))
    appConfiguration.getErrorEvents().on("all-error", (payload) => {
      if (payload.errorType == "database-deadlock-retry") retryAllErrors.push(payload)
    })

    try {
      await driver.transaction(async () => await driver.query(SECRET_SQL))
    } catch (error) {
      if (!(error instanceof Error)) throw error

      transactionError = error
    }

    await Promise.resolve()
    await Promise.resolve()

    expect(driver.attempts).toEqual(1)
    expect(transactionError).toBe(driver.lastQueryError)
    expect(diagnostics.length).toEqual(0)
    expect(retryAllErrors.length).toEqual(0)
  })
})
