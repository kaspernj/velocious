// @ts-check

import AdvisoryLockRunner from "../../src/database/advisory-lock-runner.js"
import AdvisoryLockTelemetryStubDriver from "../helpers/advisory-lock-telemetry-stub-driver.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {Record<string, unknown>} databaseArgs - Database configuration args.
 * @returns {Configuration} - Isolated configuration (no connections are opened by these specs).
 */
function testConfiguration(databaseArgs) {
  return new Configuration({
    database: {test: {default: databaseArgs}},
    directory: "/tmp/velocious-advisory-lock-defer-spec",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

describe("Advisory lock defer semantics", () => {
  it("returns a non-throwing contended defer result with zero exception traffic and no pinned connection", async () => {
    const configuration = testConfiguration({type: "mysql"})
    const driver = new AdvisoryLockTelemetryStubDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration, {acquireOutcome: "timeout"})
    const runner = new AdvisoryLockRunner({configuration, connectionProvider: () => driver, databaseIdentifier: "default"})
    /** @type {Error | undefined} */
    let thrown

    const outcome = await runner.withAdvisoryLockOrDefer("tensorbuzz-build-group-sync-42", async () => {
      throw new Error("Callback must not run when the lock is contended")
    }).catch((error) => {
      thrown = error

      return undefined
    })

    expect(thrown).toBe(undefined)
    expect(outcome).toEqual({acquired: false, reason: "contended", lockName: "tensorbuzz-build-group-sync-42"})
    // The defer probe is a single immediate try-acquire: nothing was acquired,
    // so the connection registry is empty and no lock connection was spawned.
    expect(driver._heldAdvisoryLocks.size).toBe(0)
  })

  it("runs the callback and reports its result when the try-acquire succeeds", async () => {
    const configuration = testConfiguration({type: "mysql"})
    const driver = new AdvisoryLockTelemetryStubDriver(/** @type {import("../../src/configuration-types.js").DatabaseConfigurationType} */ (configuration.getDatabaseConfiguration().default), configuration)
    const runner = new AdvisoryLockRunner({configuration, connectionProvider: () => driver, databaseIdentifier: "default"})

    const outcome = await runner.withAdvisoryLockOrDefer("free-lock", async () => "callback-value")

    expect(outcome).toEqual({acquired: true, result: "callback-value"})
    // The held path released the lock in `finally` as usual.
    expect(driver._heldAdvisoryLocks.size).toBe(0)
  })
})
