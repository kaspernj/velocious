// @ts-check

import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "../../../src/testing/test.js"

const execFileAsync = promisify(execFile)
const childPath = fileURLToPath(new URL("../../support/factory-definition-reload-policy-child.js", import.meta.url))
const REPORT_PREFIX = "__VELOCIOUS_FACTORY_RELOAD_POLICY__"

/**
 * Runs one policy scenario in a fresh Node process so retained ESM modules and
 * process-global reservation accounting are never reset inside the test runner.
 * @param {string} scenario - Child scenario name.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Scenario report.
 */
async function runScenario(scenario) {
  const {stdout} = await execFileAsync(process.execPath, [childPath, scenario], {
    timeout: 30_000
  })
  const line = stdout
    .split("\n")
    .find((entry) => entry.startsWith(REPORT_PREFIX))

  if (!line) throw new Error(`Policy child did not report scenario ${scenario}`)

  return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(line.slice(REPORT_PREFIX.length)))
}

describe("Factory reload process-global import budget (Node)", () => {
  it("seals configuration before rejecting a first over-budget reservation", async () => {
    const report = await runScenario("over-budget-first-reservation-seals")

    expect(report.reservationError.name).toEqual("DefinitionRecycleRequiredError")
    expect(report.reservationError).toEqual(expect.objectContaining({budget: 4096, current: 0, requested: 4097}))
    expect(report.before).toEqual({budget: 4096, reserved: 0})
    expect(report.configurationError.name).toEqual("DefinitionReloadConfigurationError")
    expect(report.configurationError.message).toMatch(/reservation was already attempted/)
    expect(report.after).toEqual(report.before)
  })

  it("rejects malformed reservation counts without sealing or corrupting accounting", async () => {
    const report = await runScenario("malformed-reservation-counts")

    expect(report.errors.map(({label}) => label)).toEqual([
      "negative",
      "fractional",
      "nan",
      "positive-infinity",
      "negative-infinity",
      "string",
      "boolean",
      "null",
      "undefined",
      "bigint",
      "symbol"
    ])
    expect(report.errors.every(({message, name}) => name === "TypeError" && /non-negative integer/.test(message))).toEqual(true)
    expect(report.beforeConfiguration).toEqual({budget: 4096, reserved: 0})
    expect(report.afterValidReservation).toEqual({budget: 7, reserved: 2})
  })

  it("allows one explicit configuration before the first reservation", async () => {
    const report = await runScenario("configure-once")

    expect(report.defaultBudget).toBeGreaterThan(0)
    expect(report.invalidIntegerError).toMatch(/positive integer/)
    expect(report.invalidZeroError).toMatch(/positive integer/)
    expect(report.configuredBudget).toEqual(5)
    expect(report.reserved).toEqual(0)
    expect(report.secondConfiguration.name).toEqual("DefinitionReloadConfigurationError")
    expect(report.secondConfiguration.message).toMatch(/already configured/)
  })

  it("rejects configuration after the first reservation without resetting accounting", async () => {
    const report = await runScenario("configure-after-reservation")

    expect(report.before).toEqual({budget: 4096, reserved: 1})
    expect(report.error.name).toEqual("DefinitionReloadConfigurationError")
    expect(report.error.current).toEqual(1)
    expect(report.error.budget).toEqual(4096)
    expect(report.error.requestedBudget).toEqual(5)
    expect(report.after).toEqual(report.before)
  })

  it("locks configuration after reserving an empty discovered batch", async () => {
    const report = await runScenario("configure-after-empty-reservation")

    expect(report.before).toEqual({ budget: 4096, reserved: 0 })
    expect(report.error.name).toEqual("DefinitionReloadConfigurationError")
    expect(report.error.current).toEqual(0)
    expect(report.after).toEqual(report.before)
  })

  it("does not reserve a budget for plain loads", async () => {
    const report = await runScenario("plain-load")

    expect(report.reserved).toEqual(0)
  })

  it("reserves the complete discovered batch per reload", async () => {
    const report = await runScenario("batch-reservation")

    expect(report.reserved).toEqual(2)
  })

  it("fails with typed counts at budget exhaustion and preserves the loaded registry", async () => {
    const report = await runScenario("exhaustion-preserves-registry")

    expect(report.error.name).toEqual("DefinitionRecycleRequiredError")
    expect(report.error).toEqual(expect.objectContaining({budget: 4, current: 4, requested: 2}))
    expect(report.error.message).toMatch(/recycle/i)
    expect(report.reserved).toEqual(4)
    expect(report.widget).toEqual({name: "Loaded"})
    expect(report.gadget).toEqual({name: "Gadget"})
  })

  it("shares one reservation budget across registries and targets", async () => {
    const report = await runScenario("process-global")

    expect(report.error.name).toEqual("DefinitionRecycleRequiredError")
    expect(report.reserved).toEqual(4)
    expect(report.widget).toEqual({name: "Loaded"})
    expect(report.plan).toEqual({name: "Plan"})
  })

  it("cannot be raced past by concurrent reloads", async () => {
    const report = await runScenario("concurrent")

    expect(report.fulfilled).toEqual(1)
    expect(report.rejected).toEqual(1)
    expect(report.rejectionName).toEqual("DefinitionRecycleRequiredError")
    expect(report.reserved).toEqual(2)
    expect(report.rejectedRegistryAttributes).toBeTruthy()
  })

  it("keeps the conservative complete-batch reservation when an import fails", async () => {
    const report = await runScenario("failed-import")

    expect(report.firstError).toMatch(/must default-export a \(registry\) => void function/)
    expect(report.secondError).toMatch(/must default-export a \(registry\) => void function/)
    expect(report.reservations).toEqual([2, 4])
    expect(report.exhaustionName).toEqual("DefinitionRecycleRequiredError")
  })

  it("freshly executes unchanged top-level modules on every reload", async () => {
    const report = await runScenario("fresh-top-level")

    expect(report.values).toEqual([1, 1, 1])
  })

  it("keeps deterministic order and exposes edited top-level definitions", async () => {
    const report = await runScenario("edited-top-level")

    expect(report.firstFiles).toEqual(["a-widgets.js", "b-gadgets.js"])
    expect(report.reloadedFiles).toEqual(["a-widgets.js", "b-gadgets.js"])
    expect(report.widget).toEqual({name: "After"})
  })
})
