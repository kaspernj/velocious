// @ts-check

import { describe, expect, it } from "../../../../src/testing/test.js"
import { configuration, DiagnosticMysqlDriver, SECRET_SQL } from "../../../helpers/mysql-deadlock-diagnostics-test-helper.js"

describe("Database - drivers - mysql deadlock diagnostic context", () => {
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
})
