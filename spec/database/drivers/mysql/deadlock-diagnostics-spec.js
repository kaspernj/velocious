// @ts-check

import Configuration from "../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import LoggerArrayOutput from "../../../../src/logger/outputs/array-output.js"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import { describe, expect, it } from "../../../../src/testing/test.js"

const SECRET_SQL = "UPDATE `accounts` SET `token` = 'secret-token-91827' WHERE `email` = 'owner@example.test' AND `balance` = 12345"

/**
 * @param {LoggerArrayOutput} [loggingOutput] - Optional captured logging output.
 * @returns {Configuration} - Test configuration.
 */
function configuration(loggingOutput) {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: loggingOutput
      ? {console: false, file: false, outputs: [{levels: ["warn"], output: loggingOutput}]}
      : undefined
  })
}

class DiagnosticMysqlDriver extends MysqlDriver {
  attempts = 0
  captureCalls = 0
  captureFailure = false
  clockMs = 100
  contentionCode = "ER_LOCK_DEADLOCK"
  diagnosticPipelineFailure = false
  failedAttempts = 1
  /** @type {Error | undefined} */
  lastQueryError
  parserFailure = false
  /** @type {Promise<string> | undefined} */
  statusCapturePromise
  status = `LATEST DETECTED DEADLOCK
*** (1) TRANSACTION:
TRANSACTION 123, ACTIVE 1 sec
${SECRET_SQL}
*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 8 page no 4 n bits 72 index \`email\` of table \`app\`.\`accounts\` trx id 123 lock_mode X waiting
Record lock, heap no 2 PHYSICAL RECORD: n_fields 2; compact format
 0: len 30; hex 7365637265742d746f6b656e2d3931383237; asc secret-token-91827;;
*** WE ROLL BACK TRANSACTION (1)
${"ignored status line\n".repeat(500)}`

  /** @returns {number} - Deterministic transaction-attempt clock. */
  _nowMs() {
    const current = this.clockMs

    this.clockMs += 17

    return current
  }

  /** @returns {Promise<void>} - Resolves without a real retry delay. */
  async _waitMs() {}

  /**
   * @param {import("../../../../src/database/drivers/base.js").DeadlockRetryDiagnosticSnapshot} snapshot - Immutable retry snapshot.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe diagnostic context.
   */
  async _deadlockDiagnosticContext(snapshot) {
    if (this.diagnosticPipelineFailure) throw new Error("simulated diagnostic pipeline failure")

    return await super._deadlockDiagnosticContext(snapshot)
  }

  /** @returns {Promise<import("../../../../src/database/drivers/base.js").QueryResultType>} - Query result. */
  async _queryActual(sql) {
    if (sql.endsWith("START TRANSACTION") || sql.endsWith("ROLLBACK") || sql.endsWith("COMMIT")) return []

    this.attempts++
    if (this.attempts <= this.failedAttempts) {
      const message = this.contentionCode == "ER_LOCK_WAIT_TIMEOUT"
        ? "Lock wait timeout exceeded; try restarting transaction"
        : "Deadlock found when trying to get lock"
      const mysqlError = new Error(message)
      // @ts-expect-error MySQL attaches its symbolic error code at runtime.
      mysqlError.code = this.contentionCode
      const queryError = new Error("Query failed", {cause: mysqlError})

      this.lastQueryError = queryError
      throw queryError
    }

    return []
  }

  /** @returns {Promise<string>} - Simulated InnoDB status. */
  async _captureInnodbDeadlockStatus() {
    this.captureCalls++
    if (this.captureFailure) throw new Error("diagnostic connection password=do-not-report")
    if (this.statusCapturePromise) return await this.statusCapturePromise

    return this.status
  }

  /**
   * @param {string} status - Simulated InnoDB status.
   * @returns {ReturnType<MysqlDriver["_innodbDeadlockSummary"]>} - Parsed summary.
   */
  _innodbDeadlockSummary(status) {
    if (this.parserFailure) throw new Error("simulated deadlock parser failure")

    return super._innodbDeadlockSummary(status)
  }
}

class NonPromiseDiagnosticMysqlDriver extends DiagnosticMysqlDriver {
  /** @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Deliberately malformed diagnostic result. */
  _deadlockDiagnosticContext() {
    // @ts-expect-error Simulates a runtime subclass that violates the documented Promise contract.
    return {statusCapture: "malformed-non-promise"}
  }
}

describe("Database - drivers - mysql deadlock diagnostics", () => {
  it("snapshots true-deadlock attempt timing and operation context", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))
    const allErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("all-error", resolve))
    let diagnostic
    let retryAllError

    driver._connectionCheckoutName = "Import billing batch"
    driver.setPoolDiagnosticIdentity({
      databaseIdentifier: "primary",
      databaseIdentityFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().once("database-deadlock-retry", (payload) => { diagnostic = payload })
    appConfiguration.getErrorEvents().once("all-error", (payload) => { retryAllError = payload })

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await Promise.all([diagnosticReported, allErrorReported])

    expect(diagnostic.context).toMatchObject({
      contentionKind: "deadlock",
      databaseIdentifier: "[REDACTED]",
      databaseIdentityFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationName: "[REDACTED]",
      sqlOperation: "UPDATE",
      transactionAttemptDurationMs: 17
    })
    expect(diagnostic.context.databaseIdentifierFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(diagnostic.context.operationNameFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(diagnostic.context.sqlFingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(JSON.stringify({diagnostic, retryAllError})).not.toContain("Import billing batch")
    expect(JSON.stringify({diagnostic, retryAllError})).not.toContain("primary")
  })

  it("bounds and redacts unsafe operation names while retaining only an opaque correlation fingerprint", async () => {
    for (const unsafeOperation of [
      "Import access_token=operation-token-91827",
      "Import refresh_token=operation-token-82719",
      "Sync client_secret=operation-secret-82719",
      "Sync session_token=operation-token-71829",
      "Load private_key=operation-key-61728",
      "Load credential=operation-credential-51627",
      "Export Authorization: Bearer operation-token-91827",
      "Bearer secretvalue",
      "Password correct horse battery staple",
      "Import Acme",
      "Acme",
      "Stripe sk_live_51ReviewerSecret91827",
      "AWS AKIAIOSFODNN7EXAMPLE",
      "Import tenant@example.test",
      "Fetch https://tenant.example.test/import",
      "Verify JWT eyJhbGciOiJIUzI1NiJ9.eyJ0ZW5hbnQiOiIxMjMifQ.signature",
      "Import tenant 91827",
      "bounded-operation-name".repeat(300)
    ]) {
      const appConfiguration = configuration()
      const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
      const diagnostics = []
      const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))
      const allErrors = []
      const allErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("all-error", resolve))

      driver._connectionCheckoutName = unsafeOperation
      driver.setDesiredSessionTimeZone(null)
      appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))
      appConfiguration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))

      await driver.transaction(async () => await driver.query(SECRET_SQL))
      await Promise.all([diagnosticReported, allErrorReported])

      expect(diagnostics[0].context.operationName).toEqual("[REDACTED]")
      expect(diagnostics[0].context.operationNameFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(JSON.stringify({diagnostics, allErrors}).length < 10000).toBeTrue()
      expect(JSON.stringify({diagnostics, allErrors})).not.toContain(unsafeOperation)
      expect(JSON.stringify({diagnostics, allErrors})).not.toContain("operation-token-91827")
    }
  })

  it("redacts static-looking operation prose without trusted provenance", async () => {
    for (const operationName of ["Import billing batch", "Background jobs store", "Refresh token cache metadata"]) {
      const appConfiguration = configuration()
      const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
      const diagnostics = []
      const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

      driver._connectionCheckoutName = operationName
      driver.setDesiredSessionTimeZone(null)
      appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

      await driver.transaction(async () => await driver.query(SECRET_SQL))
      await diagnosticReported

      expect(diagnostics[0].context.operationName).toEqual("[REDACTED]")
      expect(diagnostics[0].context.operationNameFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(JSON.stringify(diagnostics[0])).not.toContain(operationName)
    }
  })

  it("redacts unsafe logical database identifiers without losing opaque physical identity", async () => {
    for (const unsafeIdentifier of [
      "tenant@example.test",
      "password=database-secret-91827",
      "AKIAIOSFODNN7EXAMPLE",
      "Acme",
      "productionsecret",
      "tenant".repeat(40)
    ]) {
      const appConfiguration = configuration()
      const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
      const diagnostics = []
      const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))
      const allErrors = []
      const allErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("all-error", resolve))

      driver.setPoolDiagnosticIdentity({
        databaseIdentifier: unsafeIdentifier,
        databaseIdentityFingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      })
      driver.setDesiredSessionTimeZone(null)
      appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))
      appConfiguration.getErrorEvents().on("all-error", (payload) => allErrors.push(payload))

      await driver.transaction(async () => await driver.query(SECRET_SQL))
      await Promise.all([diagnosticReported, allErrorReported])

      expect(diagnostics[0].context.databaseIdentifier).toEqual("[REDACTED]")
      expect(diagnostics[0].context.databaseIdentifierFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(diagnostics[0].context.databaseIdentityFingerprint).toEqual("sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd")
      expect(JSON.stringify({diagnostics, allErrors})).not.toContain(unsafeIdentifier)
    }
  })

  it("retains the original immutable identity and operation after delayed capture and connection reuse", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))
    let diagnostic
    /** @type {(status: string) => void} */
    let resolveCapture = () => { throw new Error("Capture resolver was not installed") }

    driver.statusCapturePromise = new Promise((resolve) => { resolveCapture = resolve })
    driver._connectionCheckoutName = "Original tenant import"
    driver.setPoolDiagnosticIdentity({
      databaseIdentifier: "tenantData",
      databaseIdentityFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    })
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().once("database-deadlock-retry", (payload) => { diagnostic = payload })

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    driver._connectionCheckoutName = undefined
    driver.setPoolDiagnosticIdentity({
      databaseIdentifier: "reusedDatabase",
      databaseIdentityFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    })
    resolveCapture(driver.status)
    await diagnosticReported

    expect(diagnostic.context).toMatchObject({
      databaseIdentifier: "[REDACTED]",
      databaseIdentityFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      operationName: "[REDACTED]"
    })
    expect(diagnostic.context.databaseIdentifierFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(diagnostic.context.operationNameFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(diagnostic)).not.toContain("tenantData")
    expect(JSON.stringify(diagnostic)).not.toContain("Original tenant import")
  })

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

  it("emits only bounded structural lock-cycle nodes from fixed-format status", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnostics = []
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

    driver.status = `LATEST DETECTED DEADLOCK
*** (1) TRANSACTION:
TRANSACTION 998877, ACTIVE 3 sec
UPDATE secret_accounts SET api_key = 'literal-api-secret' WHERE customer_id = 778899
*** (1) HOLDS THE LOCK(S):
RECORD LOCKS space id 7 page no 8 n bits 64 index \`tenant_index_secret\` of table \`private_db\`.\`secret_accounts\` trx id 998877 lock_mode S
*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 7 page no 9 n bits 64 index PRIMARY of table \`private_db\`.\`secret_accounts\` trx id 998877 lock_mode X waiting
Record lock, heap no 7 PHYSICAL RECORD: n_fields 3; compact format
 0: len 16; hex 6c69746572616c2d6170692d736563726574; asc literal-api-secret;;
*** (2) TRANSACTION:
TRANSACTION 112233, ACTIVE 2 sec
DELETE FROM customer_secrets WHERE token = 'second-secret'
*** (2) HOLDS THE LOCK(S):
RECORD LOCKS space id 7 page no 9 n bits 64 index PRIMARY of table \`private_db\`.\`secret_accounts\` trx id 112233 lock_mode X
*** (2) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 7 page no 8 n bits 64 index \`tenant_index_secret\` of table \`private_db\`.\`secret_accounts\` trx id 112233 lock_mode S waiting
*** WE ROLL BACK TRANSACTION (2)
------------
TRANSACTIONS
------------
stale raw status must not be scanned`
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await diagnosticReported

    const summary = diagnostics[0].context.innodbDeadlockSummary

    expect(summary).toMatchObject({transactions: 2, victimTransaction: 2})
    expect(summary.transactionNodes).toMatchObject([
      {conflictingLocks: [], locks: [{lockMode: "S", state: "held"}, {lockMode: "X", state: "waiting"}], ordinal: 1},
      {conflictingLocks: [], locks: [{lockMode: "X", state: "held"}, {lockMode: "S", state: "waiting"}], ordinal: 2}
    ])

    for (const transactionNode of summary.transactionNodes) {
      for (const lock of transactionNode.locks) {
        expect(Object.keys(lock).sort()).toEqual(["indexFingerprint", "lockMode", "state", "tableFingerprint"])
        expect(lock.indexFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(lock.tableFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      }
    }

    const serialized = JSON.stringify(diagnostics[0])

    for (const unsafeValue of [
      "private_db",
      "secret_accounts",
      "tenant_index_secret",
      "UPDATE secret_accounts",
      "literal-api-secret",
      "second-secret",
      "998877",
      "112233",
      "6c69746572616c",
      "PHYSICAL RECORD",
      "stale raw status"
    ]) {
      expect(serialized).not.toContain(unsafeValue)
    }
  })

  it("parses MariaDB unnumbered waiting and conflicting lock sections with bounded transaction IDs", async () => {
    const appConfiguration = configuration()
    const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const diagnostics = []
    const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))
    const conflictingLockLines = Array.from({length: 10}, (_, lockIndex) => `RECORD LOCKS space id 7 page no ${9 + lockIndex} n bits 64 index \`maria_conflict_index_${lockIndex}\` of table \`raw_tenant\`.\`raw_orders\` trx id ${700000 + lockIndex} lock_mode S`).join("\n")

    driver.status = `LATEST DETECTED DEADLOCK
*** (1) TRANSACTION:
TRANSACTION 991122, ACTIVE 2 sec
UPDATE maria_secret_orders SET token = 'maria-secret-literal'
*** WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 7 page no 8 n bits 64 index \`maria_wait_index\` of table \`raw_tenant\`.\`raw_orders\` trx id 991122 334455 lock_mode X waiting
*** CONFLICTING WITH:
${conflictingLockLines}
*** (2) TRANSACTION:
TRANSACTION 556677, ACTIVE 1 sec
DELETE FROM maria_secret_orders WHERE token = 'other-secret-literal'
*** WE ROLL BACK TRANSACTION (2)`
    driver.setDesiredSessionTimeZone(null)
    appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

    await driver.transaction(async () => await driver.query(SECRET_SQL))
    await diagnosticReported

    const summary = diagnostics[0].context.innodbDeadlockSummary

    expect(summary).toMatchObject({lockRecordsTruncated: true, transactions: 2, victimTransaction: 2})
    expect(summary.transactionNodes).toMatchObject([
      {
        conflictingLocks: Array.from({length: 7}, () => ({lockMode: "S", state: "conflicting"})),
        locks: [{lockMode: "X", state: "waiting"}],
        ordinal: 1
      },
      {conflictingLocks: [], locks: [], ordinal: 2}
    ])
    expect(summary.transactionNodes[0].locks.some((lock) => lock.state == "held")).toBeFalse()

    for (const conflict of summary.transactionNodes[0].conflictingLocks) {
      expect(Object.keys(conflict).sort()).toEqual(["indexFingerprint", "lockMode", "state", "tableFingerprint"])
      expect(conflict.indexFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(conflict.tableFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    }

    const serialized = JSON.stringify(diagnostics[0])

    for (const unsafeValue of [
      "maria_wait_index",
      "maria_conflict_index",
      "raw_tenant",
      "raw_orders",
      "maria_secret_orders",
      "maria-secret-literal",
      "other-secret-literal",
      "991122",
      "334455",
      "556677",
      "700000"
    ]) {
      expect(serialized).not.toContain(unsafeValue)
    }
  })

  it("bounds oversized and malformed status without masking the retry", async () => {
    const oversizedTransactions = Array.from({length: 40}, (_, transactionIndex) => `*** (${transactionIndex + 1}) TRANSACTION:
*** (${transactionIndex + 1}) WAITING FOR THIS LOCK TO BE GRANTED:
${Array.from({length: 10}, (_, lockIndex) => `RECORD LOCKS space id 7 page no 8 n bits 64 index \`sensitive_index_${transactionIndex}_${lockIndex}\` of table \`secret_db\`.\`sensitive_table_${transactionIndex}\` trx id ${900000 + transactionIndex} lock_mode X waiting`).join("\n")}`).join("\n")

    for (const [status, structurallyOversized] of [
      [`LATEST DETECTED DEADLOCK\n${oversizedTransactions}`, true],
      [`malformed password=oversized-secret\n${"x".repeat(70000)}`, false]
    ]) {
      const appConfiguration = configuration()
      const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
      const diagnostics = []
      const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

      driver.status = status
      driver.setDesiredSessionTimeZone(null)
      appConfiguration.getErrorEvents().on("database-deadlock-retry", (payload) => diagnostics.push(payload))

      await driver.transaction(async () => await driver.query(SECRET_SQL))
      await diagnosticReported

      expect(driver.attempts).toEqual(2)
      expect(JSON.stringify(diagnostics[0]).length < 12000).toBeTrue()
      expect(JSON.stringify(diagnostics[0])).not.toContain("oversized-secret")
      expect(JSON.stringify(diagnostics[0])).not.toContain("sensitive_table")

      if (structurallyOversized) {
        const summary = diagnostics[0].context.innodbDeadlockSummary
        const emittedLockCount = summary.transactionNodes.reduce((count, transactionNode) => count + transactionNode.locks.length, 0)

        expect(summary.transactionNodes.length).toEqual(8)
        expect(emittedLockCount).toEqual(32)
        expect(summary.lockRecordsTruncated).toBeTrue()
        expect(summary.sectionTruncated).toBeTrue()
        expect(summary.transactionNodesTruncated).toBeTrue()
      }
    }
  })

  it("normalizes comment markers inside quoted literals before fingerprinting", async () => {
    const fingerprints = []
    const operations = []

    for (const token of ["alpha--suffix#one", "beta--suffix#two"]) {
      const appConfiguration = configuration()
      const driver = new DiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
      const diagnosticReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("database-deadlock-retry", resolve))

      driver.setDesiredSessionTimeZone(null)
      appConfiguration.getErrorEvents().once("database-deadlock-retry", (payload) => {
        fingerprints.push(payload.context.sqlFingerprint)
        operations.push(payload.context.sqlOperation)
      })
      await driver.transaction(async () => await driver.query(`/* application query */ UPDATE accounts SET token = '${token}' WHERE id = 42`))
      await diagnosticReported
    }

    expect(fingerprints.length).toEqual(2)
    expect(fingerprints[0]).toEqual(fingerprints[1])
    expect(operations).toEqual(["UPDATE", "UPDATE"])
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
    const driver = new NonPromiseDiagnosticMysqlDriver({deadlockBaseWaitMs: 1, deadlockMaxRetries: 2}, appConfiguration)
    const frameworkErrors = []
    const allErrors = []
    const frameworkErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("framework-error", resolve))
    const allErrorReported = new Promise((resolve) => appConfiguration.getErrorEvents().once("all-error", resolve))

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
