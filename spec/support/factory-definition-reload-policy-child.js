// @ts-check

import {
  getDefinitionReloadBudget,
  peekDefinitionReloadBudget,
  reserveDefinitionReloadBudget,
  setDefinitionReloadBudget
} from "../../src/testing/factory/node/definition-reload-policy.js"
import { loadDefinitions, reloadDefinitions } from "../../src/testing/factory/node/load-definitions.js"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createFactoryRegistry } from "../../src/testing/factory/index.js"
import os from "node:os"
import path from "node:path"

const REPORT_PREFIX = "__VELOCIOUS_FACTORY_RELOAD_POLICY__"
const scenario = process.argv[2]

/** Builds a definition file that registers one named factory. */
function namedDefinition(factoryName, value) {
  return `export default function(registry) {
  registry.define(({factory}) => factory("${factoryName}", class Model {}, ({attribute}) => attribute("name", "${value}")))
}
`
}

const COUNTER_DEFINITION = `let evaluationCount = 0
export default function(registry) {
  evaluationCount += 1
  registry.define(({factory}) => factory("evaluationCounter", class CounterModel {}, ({attribute}) => attribute("value", evaluationCount)))
}
`

const BROKEN_DEFINITION = "export const notDefault = 1\n"

/** Converts an expected thrown value into deterministic report fields. */
function errorReport(error) {
  if (!(error instanceof Error)) throw error

  const details = /** @type {Error & {budget?: number, current?: number, requested?: number, requestedBudget?: number}} */ (error)

  return {
    budget: details.budget,
    current: details.current,
    message: details.message,
    name: details.name,
    requested: details.requested,
    requestedBudget: details.requestedBudget
  }
}

/** Runs a callback and returns the expected error as report data. */
async function captureError(callback) {
  try {
    await callback()
  } catch (error) {
    return errorReport(error)
  }

  throw new Error("Expected callback to throw")
}

/** Writes two definition files into a directory. */
async function writePair(directory, names = ["widget", "gadget"], values = ["Loaded", "Gadget"]) {
  await writeFile(path.join(directory, `${names[0]}s.js`), namedDefinition(names[0], values[0]))
  await writeFile(path.join(directory, `${names[1]}s.js`), namedDefinition(names[1], values[1]))
}

/** Runs the requested scenario inside one temporary fixture boundary. */
async function runScenario() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "factory-policy-child-"))

  try {
    if (scenario === "over-budget-first-reservation-seals") {
      const defaultBudget = getDefinitionReloadBudget()
      const reservationError = await captureError(async () => reserveDefinitionReloadBudget(defaultBudget + 1))
      const before = {budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget()}
      const configurationError = await captureError(async () => setDefinitionReloadBudget(defaultBudget + 2))
      const after = {budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget()}

      return {after, before, configurationError, reservationError}
    }

    if (scenario === "malformed-reservation-counts") {
      const malformedRequests = [
        {label: "negative", value: -1},
        {label: "fractional", value: 1.5},
        {label: "nan", value: Number.NaN},
        {label: "positive-infinity", value: Number.POSITIVE_INFINITY},
        {label: "negative-infinity", value: Number.NEGATIVE_INFINITY},
        {label: "string", value: "1"},
        {label: "boolean", value: true},
        {label: "null", value: null},
        {label: "undefined", value: undefined},
        {label: "bigint", value: 1n},
        {label: "symbol", value: Symbol("one")}
      ]
      const errors = []

      for (const {label, value} of malformedRequests) {
        const error = await captureError(async () => Reflect.apply(reserveDefinitionReloadBudget, undefined, [value]))
        errors.push({label, message: error.message, name: error.name})
      }

      const beforeConfiguration = {budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget()}
      setDefinitionReloadBudget(7)
      reserveDefinitionReloadBudget(2)

      return {
        afterValidReservation: {budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget()},
        beforeConfiguration,
        errors
      }
    }

    if (scenario === "configure-once") {
      const defaultBudget = getDefinitionReloadBudget()
      const invalidZeroError = (await captureError(async () => setDefinitionReloadBudget(0))).message
      const invalidIntegerError = (await captureError(async () => setDefinitionReloadBudget(1.5))).message
      setDefinitionReloadBudget(5)
      const secondConfiguration = await captureError(async () => setDefinitionReloadBudget(6))

      return {configuredBudget: getDefinitionReloadBudget(), defaultBudget, invalidIntegerError, invalidZeroError, reserved: peekDefinitionReloadBudget(), secondConfiguration}
    }

    if (scenario === "configure-after-reservation") {
      await writeFile(path.join(directory, "widgets.js"), namedDefinition("widget", "Loaded"))
      const registry = createFactoryRegistry()
      await loadDefinitions(registry, directory)
      await reloadDefinitions(registry, directory)
      const before = {budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget()}
      const error = await captureError(async () => setDefinitionReloadBudget(5))
      const after = {budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget()}

      return {after, before, error}
    }

    if (scenario === "configure-after-empty-reservation") {
      await reloadDefinitions(createFactoryRegistry(), directory)
      const before = { budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget() }
      const error = await captureError(async () => setDefinitionReloadBudget(5))
      const after = { budget: getDefinitionReloadBudget(), reserved: peekDefinitionReloadBudget() }

      return { after, before, error }
    }

    if (scenario === "plain-load") {
      setDefinitionReloadBudget(5)
      await writeFile(path.join(directory, "widgets.js"), namedDefinition("widget", "Loaded"))
      await loadDefinitions(createFactoryRegistry(), directory)
      await loadDefinitions(createFactoryRegistry(), directory)

      return {reserved: peekDefinitionReloadBudget()}
    }

    if (scenario === "batch-reservation") {
      setDefinitionReloadBudget(10)
      await writePair(directory)
      const registry = createFactoryRegistry()
      await loadDefinitions(registry, directory)
      await reloadDefinitions(registry, directory)

      return {reserved: peekDefinitionReloadBudget()}
    }

    if (scenario === "exhaustion-preserves-registry") {
      setDefinitionReloadBudget(4)
      await writePair(directory)
      const registry = createFactoryRegistry()
      await loadDefinitions(registry, directory)
      await reloadDefinitions(registry, directory)
      await reloadDefinitions(registry, directory)
      const error = await captureError(async () => reloadDefinitions(registry, directory))

      return {
        error,
        gadget: await registry.attributesFor("gadget"),
        reserved: peekDefinitionReloadBudget(),
        widget: await registry.attributesFor("widget")
      }
    }

    if (scenario === "process-global") {
      setDefinitionReloadBudget(4)
      await writePair(directory)
      const otherDirectory = await mkdtemp(path.join(os.tmpdir(), "factory-policy-other-"))

      try {
        await writePair(otherDirectory, ["plan", "note"], ["Plan", "Note"])
        const firstRegistry = createFactoryRegistry()
        const secondRegistry = createFactoryRegistry()
        await loadDefinitions(firstRegistry, directory)
        await loadDefinitions(secondRegistry, otherDirectory)
        await reloadDefinitions(firstRegistry, directory)
        await reloadDefinitions(secondRegistry, otherDirectory)
        const error = await captureError(async () => reloadDefinitions(firstRegistry, directory))

        return {
          error,
          plan: await secondRegistry.attributesFor("plan"),
          reserved: peekDefinitionReloadBudget(),
          widget: await firstRegistry.attributesFor("widget")
        }
      } finally {
        await rm(otherDirectory, {force: true, recursive: true})
      }
    }

    if (scenario === "concurrent") {
      setDefinitionReloadBudget(3)
      await writePair(directory)
      const otherDirectory = await mkdtemp(path.join(os.tmpdir(), "factory-policy-concurrent-"))

      try {
        await writePair(otherDirectory, ["plan", "note"], ["Plan", "Note"])
        const firstRegistry = createFactoryRegistry()
        const secondRegistry = createFactoryRegistry()
        await loadDefinitions(firstRegistry, directory)
        await loadDefinitions(secondRegistry, otherDirectory)
        const settled = await Promise.allSettled([
          reloadDefinitions(firstRegistry, directory),
          reloadDefinitions(secondRegistry, otherDirectory)
        ])
        const rejectionIndex = settled.findIndex((outcome) => outcome.status === "rejected")
        const rejection = settled[rejectionIndex]
        const rejectedRegistry = rejectionIndex === 0 ? firstRegistry : secondRegistry
        const rejectedFactory = rejectionIndex === 0 ? "widget" : "plan"

        return {
          fulfilled: settled.filter((outcome) => outcome.status === "fulfilled").length,
          rejected: settled.filter((outcome) => outcome.status === "rejected").length,
          rejectedRegistryAttributes: await rejectedRegistry.attributesFor(rejectedFactory),
          rejectionName: rejection.status === "rejected" ? errorReport(rejection.reason).name : null,
          reserved: peekDefinitionReloadBudget()
        }
      } finally {
        await rm(otherDirectory, {force: true, recursive: true})
      }
    }

    if (scenario === "failed-import") {
      setDefinitionReloadBudget(4)
      await writeFile(path.join(directory, "widgets.js"), namedDefinition("widget", "Loaded"))
      await writeFile(path.join(directory, "broken.js"), BROKEN_DEFINITION)
      const registry = createFactoryRegistry()
      await loadDefinitions(registry, path.join(directory, "widgets.js"))
      const firstError = (await captureError(async () => reloadDefinitions(registry, directory))).message
      const firstReservation = peekDefinitionReloadBudget()
      const secondError = (await captureError(async () => reloadDefinitions(registry, directory))).message
      const secondReservation = peekDefinitionReloadBudget()
      const exhaustionName = (await captureError(async () => reloadDefinitions(registry, directory))).name

      return {exhaustionName, firstError, reservations: [firstReservation, secondReservation], secondError}
    }

    if (scenario === "fresh-top-level") {
      setDefinitionReloadBudget(10)
      await writeFile(path.join(directory, "counter.js"), COUNTER_DEFINITION)
      const registry = createFactoryRegistry()
      await loadDefinitions(registry, directory)
      const values = [(await registry.attributesFor("evaluationCounter")).value]
      await reloadDefinitions(registry, directory)
      values.push((await registry.attributesFor("evaluationCounter")).value)
      await reloadDefinitions(registry, directory)
      values.push((await registry.attributesFor("evaluationCounter")).value)

      return {values}
    }

    if (scenario === "edited-top-level") {
      setDefinitionReloadBudget(10)
      await writeFile(path.join(directory, "a-widgets.js"), namedDefinition("widget", "Before"))
      await writeFile(path.join(directory, "b-gadgets.js"), namedDefinition("gadget", "Gadget"))
      const registry = createFactoryRegistry()
      const firstFiles = await loadDefinitions(registry, directory)
      await writeFile(path.join(directory, "a-widgets.js"), namedDefinition("widget", "After"))
      const reloadedFiles = await reloadDefinitions(registry, directory)

      return {
        firstFiles: firstFiles.map((entry) => path.basename(entry)),
        reloadedFiles: reloadedFiles.map((entry) => path.basename(entry)),
        widget: await registry.attributesFor("widget")
      }
    }

    throw new Error(`Unknown policy child scenario: ${scenario}`)
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

runScenario().then((report) => {
  console.log(`${REPORT_PREFIX}${JSON.stringify(report)}`)
}, (error) => {
  console.error(error)
  process.exitCode = 1
})
