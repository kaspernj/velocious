// @ts-check

import AdvisoryLockRunner from "../../src/database/advisory-lock-runner.js"
import AdvisoryLockTelemetryStubDriver from "../helpers/advisory-lock-telemetry-stub-driver.js"
import {AdvisoryLockTimeoutError} from "../../src/database/advisory-lock-runner.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {Record<string, unknown>} databaseArgs - Database configuration args.
 * @returns {{configuration: Configuration, reports: Array<Record<string, unknown>>, errorReports: Array<Record<string, unknown>>}} - Configuration plus captured telemetry and framework-error payloads.
 */
function testConfigurationWithReports(databaseArgs) {
  const configuration = new Configuration({
    database: {test: {default: databaseArgs}},
    directory: "/tmp/velocious-advisory-lock-telemetry-spec",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
  /** @type {Array<Record<string, unknown>>} */
  const reports = []
  /** @type {Array<Record<string, unknown>>} */
  const errorReports = []

  configuration.getTelemetryEvents().on("telemetry", (payload) => reports.push(payload))
  configuration.getErrorEvents().on("framework-error", (payload) => errorReports.push(payload))
  configuration.getErrorEvents().on("all-error", (payload) => errorReports.push(payload))

  return {configuration, reports, errorReports}
}

describe("Advisory lock duration telemetry", () => {
  it("reports a slow acquire wait with the eventual outcome on the telemetry channel and never on the error channel", async () => {
    const {configuration, reports, errorReports} = testConfigurationWithReports({type: "mysql", advisoryLockTelemetry: {slowAcquireMs: 5}})
    const driver = new AdvisoryLockTelemetryStubDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration, {acquireDelayMs: 10})
    const runner = new AdvisoryLockRunner({configuration, connectionProvider: () => driver, databaseIdentifier: "default"})

    const result = await runner.withAdvisoryLock("slow-acquire-lock", async () => "done")

    expect(result).toBe("done")
    expect(reports.length).toBe(1)
    expect(reports[0].context).toBe("advisory-lock-telemetry")
    expect(reports[0].event).toBe("advisory-lock-slow-acquire")
    expect(reports[0].lockName).toBe("slow-acquire-lock")
    expect(reports[0].backendTier).toBe("driver-native")
    expect(reports[0].outcome).toBe("acquired")
    expect(Number(reports[0].durationMs) >= 5).toBe(true)
    expect(typeof reports[0].holderId).toBe("string")
    // A measurement must never reach a bug reporter subscribed to the error channel.
    expect(errorReports.length).toBe(0)
  })

  it("reports an acquire timeout with the holder identity captured at the event moment", async () => {
    const {configuration, reports} = testConfigurationWithReports({type: "mysql", advisoryLockAcquireTimeoutMs: 10, advisoryLockTelemetry: {slowAcquireMs: null}})
    const driver = new AdvisoryLockTelemetryStubDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration, {acquireOutcome: "timeout", holderConnectionId: "12345"})
    const runner = new AdvisoryLockRunner({configuration, connectionProvider: () => driver, databaseIdentifier: "default"})
    /** @type {Error | undefined} */
    let thrown

    await runner.withAdvisoryLock("timed-out-lock", async () => "done").catch((error) => {
      thrown = error
    })

    expect(thrown).toBeInstanceOf(AdvisoryLockTimeoutError)
    expect(reports.length).toBe(1)
    expect(reports[0].event).toBe("advisory-lock-acquire-timeout")
    expect(reports[0].lockName).toBe("timed-out-lock")
    expect(reports[0].outcome).toBe("timeout")
    expect(reports[0].timeoutMs).toBe(10)
    expect(reports[0].holderConnectionId).toBe("12345")
    expect(reports[0].holderLookupError).toBe(null)
  })

  it("records a failed holder lookup on the timeout report without changing the acquisition outcome", async () => {
    const {configuration, reports} = testConfigurationWithReports({type: "mysql", advisoryLockAcquireTimeoutMs: 10, advisoryLockTelemetry: {slowAcquireMs: null}})
    const driver = new AdvisoryLockTelemetryStubDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration, {acquireOutcome: "timeout", holderLookupError: "holder lookup boom"})
    const runner = new AdvisoryLockRunner({configuration, connectionProvider: () => driver, databaseIdentifier: "default"})
    /** @type {Error | undefined} */
    let thrown

    await runner.withAdvisoryLock("lookup-failed-lock", async () => "done").catch((error) => {
      thrown = error
    })

    expect(thrown).toBeInstanceOf(AdvisoryLockTimeoutError)
    expect(reports.length).toBe(1)
    expect(reports[0].event).toBe("advisory-lock-acquire-timeout")
    expect(reports[0].holderConnectionId).toBe(null)
    expect(reports[0].holderLookupError).toBe("holder lookup boom")
  })

  it("reports a hold that outlives the slow-hold threshold at release", async () => {
    const {configuration, reports} = testConfigurationWithReports({type: "mysql", advisoryLockTelemetry: {slowAcquireMs: null, slowHoldMs: 5}})
    const driver = new AdvisoryLockTelemetryStubDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration)
    const runner = new AdvisoryLockRunner({configuration, connectionProvider: () => driver, databaseIdentifier: "default"})

    await runner.withAdvisoryLockOrFail("long-hold-lock", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))

      return "done"
    })

    expect(reports.length).toBe(1)
    expect(reports[0].event).toBe("advisory-lock-slow-hold")
    expect(reports[0].lockName).toBe("long-hold-lock")
    expect(reports[0].backendTier).toBe("driver-native")
    expect(reports[0].outcome).toBe(null)
    expect(Number(reports[0].durationMs) >= 5).toBe(true)
  })

  it("stays silent below the thresholds and when a report is opted out with null", async () => {
    const {configuration, reports} = testConfigurationWithReports({type: "mysql", advisoryLockTelemetry: {slowAcquireMs: null, slowHoldMs: null}})
    const driver = new AdvisoryLockTelemetryStubDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration, {acquireDelayMs: 10})
    const runner = new AdvisoryLockRunner({configuration, connectionProvider: () => driver, databaseIdentifier: "default"})

    await runner.withAdvisoryLock("fast-lock", async () => "done")

    expect(reports.length).toBe(0)
  })

  it("maps the tier attribution per backend: process-local for the SQLite emulation", async () => {
    const {configuration} = testConfigurationWithReports({type: "sqlite"})
    const SqliteBaseDriver = (await import("../../src/database/drivers/sqlite/base.js")).default
    const driver = new SqliteBaseDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration)

    expect(driver.advisoryLockBackendTier()).toBe("process-local")

    expect(await driver.tryAcquireAdvisoryLock("sqlite-held-lock")).toBe(true)
    expect(await driver.advisoryLockHolderConnectionId("sqlite-held-lock")).toBe(driver.advisoryLockHolderId())

    await driver.releaseAdvisoryLock("sqlite-held-lock")
    expect(await driver.advisoryLockHolderConnectionId("sqlite-held-lock")).toBe(null)
  })
})
