// @ts-check

import BaseDriver from "../../../src/database/drivers/base.js"
import BasePool from "../../../src/database/pool/base.js"
import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../../src/testing/test.js"

class IdentityDriver extends BaseDriver {
  /** @returns {Promise<void>} - No-op connection. */
  async connect() {}

  /** @returns {string} - Test driver type. */
  getType() { return "mysql" }

  /** @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Empty query result. */
  async _queryActual() { return [] }
}

function configuration() {
  return new Configuration({
    database: {
      test: {
        tenantData: {
          database: "tenant_alpha_database",
          driver: IdentityDriver,
          host: "tenant-alpha.internal",
          password: "alpha-password-secret",
          type: "mysql",
          username: "tenant_alpha_user"
        }
      }
    },
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("database - pool - diagnostic identity", () => {
  it("stamps ordinary and captured tenant connections with one logical identifier and distinct opaque physical identities", async () => {
    const appConfiguration = configuration()
    const pool = new BasePool({configuration: appConfiguration, identifier: "tenantData"})
    const ordinaryConnection = await pool.spawnConnection()
    const capturedConfiguration = {
      ...pool.getConfiguration(),
      database: "tenant_beta_database",
      host: "tenant-beta.internal",
      name: "tenant-beta-locator",
      password: "beta-password-secret",
      username: "tenant_beta_user"
    }
    const capturedConnection = await pool.spawnConnectionForConfiguration(capturedConfiguration)
    const repeatedCapturedConnection = await pool.spawnConnectionForConfiguration({...capturedConfiguration})

    try {
      expect(ordinaryConnection._databaseIdentifier).toEqual("tenantData")
      expect(capturedConnection._databaseIdentifier).toEqual("tenantData")
      expect(ordinaryConnection._poolDiagnosticIdentityContext().databaseIdentifier).toEqual("[REDACTED]")
      expect(ordinaryConnection._poolDiagnosticIdentityContext().databaseIdentifierFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(capturedConnection._poolDiagnosticIdentityContext().databaseIdentifierFingerprint).toEqual(ordinaryConnection._poolDiagnosticIdentityContext().databaseIdentifierFingerprint)
      expect(ordinaryConnection._databaseIdentityFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(capturedConnection._databaseIdentityFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(ordinaryConnection._databaseIdentityFingerprint).not.toEqual(capturedConnection._databaseIdentityFingerprint)
      expect(repeatedCapturedConnection._databaseIdentityFingerprint).toEqual(capturedConnection._databaseIdentityFingerprint)

      const serializedIdentities = JSON.stringify({
        ordinary: ordinaryConnection._databaseIdentityFingerprint,
        captured: capturedConnection._databaseIdentityFingerprint
      })

      for (const unsafeValue of [
        "tenant_alpha_database",
        "tenant-alpha.internal",
        "tenant_alpha_user",
        "alpha-password-secret",
        "tenant_beta_database",
        "tenant-beta.internal",
        "tenant_beta_user",
        "tenant-beta-locator",
        "beta-password-secret"
      ]) {
        expect(serializedIdentities).not.toContain(unsafeValue)
      }
    } finally {
      await ordinaryConnection.close()
      await capturedConnection.close()
      await repeatedCapturedConnection.close()
    }
  })

  it("redacts unsafe logical identifiers while retaining opaque physical identity", async () => {
    const appConfiguration = configuration()

    for (const unsafeIdentifier of [
      "tenant@example.test",
      "password=pool-secret-91827",
      "AKIAIOSFODNN7EXAMPLE",
      "Acme",
      "productionsecret",
      "tenant".repeat(40)
    ]) {
      const pool = new BasePool({configuration: appConfiguration, identifier: unsafeIdentifier})
      const connection = await pool.spawnConnectionForConfiguration(appConfiguration.resolveDatabaseConfiguration("tenantData"))

      try {
        const identityContext = connection._poolDiagnosticIdentityContext()

        expect(identityContext.databaseIdentifier).toEqual("[REDACTED]")
        expect(identityContext.databaseIdentifierFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(identityContext.databaseIdentityFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(JSON.stringify(identityContext)).not.toContain(unsafeIdentifier)
      } finally {
        await connection.close()
      }
    }
  })

  it("fingerprints complete logical identifiers instead of a shared bounded prefix", async () => {
    const appConfiguration = configuration()
    const sharedPrefix = "tenant".repeat(300)
    const firstIdentifier = `${sharedPrefix}alpha`
    const secondIdentifier = `${sharedPrefix}beta`
    const firstPool = new BasePool({configuration: appConfiguration, identifier: firstIdentifier})
    const secondPool = new BasePool({configuration: appConfiguration, identifier: secondIdentifier})
    const databaseConfiguration = appConfiguration.resolveDatabaseConfiguration("tenantData")
    const firstConnection = await firstPool.spawnConnectionForConfiguration(databaseConfiguration)
    const secondConnection = await secondPool.spawnConnectionForConfiguration(databaseConfiguration)

    try {
      const firstContext = firstConnection._poolDiagnosticIdentityContext()
      const secondContext = secondConnection._poolDiagnosticIdentityContext()

      expect(firstContext.databaseIdentifier).toEqual("[REDACTED]")
      expect(secondContext.databaseIdentifier).toEqual("[REDACTED]")
      expect(firstContext.databaseIdentifierFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(secondContext.databaseIdentifierFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(firstContext.databaseIdentifierFingerprint).not.toEqual(secondContext.databaseIdentifierFingerprint)
      expect(JSON.stringify({firstContext, secondContext})).not.toContain(sharedPrefix)
    } finally {
      await firstConnection.close()
      await secondConnection.close()
    }
  })
})
