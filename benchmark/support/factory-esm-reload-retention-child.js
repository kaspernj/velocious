// @ts-check
// fallow-ignore-file unused-file

import { createFactoryRegistry } from "../../src/testing/factory/index.js"
import { loadDefinitions, reloadDefinitions } from "../../src/testing/factory/node/load-definitions.js"
import { REPORT_PREFIX, applyEdit, dependencyTagAt, topLevelTagAt } from "./factory-esm-reload-retention.js"

/**
 * @typedef {object} ChildOptions
 * @property {boolean} epoch - Whether to run a supervised epoch (policy budget armed).
 * @property {string} fixture - Fixture directory.
 * @property {number} fileCount - Number of fixture files imported per reload.
 * @property {number} maxReloads - Maximum reloads to perform; 0 means unbounded.
 * @property {number} policyBudget - Import budget to arm when in epoch mode.
 * @property {boolean} probe - Whether to only load once and report observed tags.
 * @property {number} sampleEvery - Reload cadence for memory samples.
 * @property {string} scenario - "unchanged" or "edited".
 * @property {number} startEditIndex - Global reload index this epoch begins at.
 */

/**
 * Parses child command-line options.
 * @returns {ChildOptions} - Parsed options.
 */
function parseOptions() {
  const args = process.argv.slice(2)
  /** @type {ChildOptions} */
  const options = {
    epoch: false,
    fileCount: 3,
    fixture: "",
    maxReloads: 0,
    policyBudget: 0,
    probe: false,
    sampleEvery: 25,
    scenario: "unchanged",
    startEditIndex: 0
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]

    if (arg === "--epoch") options.epoch = true
    else if (arg === "--file-count") options.fileCount = Number(value)
    else if (arg === "--fixture") options.fixture = value
    else if (arg === "--max-reloads") options.maxReloads = Number(value)
    else if (arg === "--policy-budget") options.policyBudget = Number(value)
    else if (arg === "--probe") options.probe = true
    else if (arg === "--sample-every") options.sampleEvery = Number(value)
    else if (arg === "--scenario") options.scenario = value
    else if (arg === "--start-edit-index") options.startEditIndex = Number(value)
  }

  return options
}

/**
 * Reads a memory snapshot.
 * @returns {{heapTotal: number, heapUsed: number, rss: number}} - Snapshot.
 */
function memorySnapshot() {
  const memory = process.memoryUsage()

  return {heapTotal: memory.heapTotal, heapUsed: memory.heapUsed, rss: memory.rss}
}

/**
 * Prints the child JSON report.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} report - Report payload.
 * @returns {void} - No return value.
 */
function printReport(report) {
  console.log(`${REPORT_PREFIX} ${JSON.stringify(report)}`)
}

/**
 * Runs the child. Exits the process with 0 on success and 1 on unexpected failure.
 * @returns {Promise<void>} - Resolves when the process is ready to exit.
 */
async function main() {
  const options = parseOptions()

  if (options.epoch && options.policyBudget > 0) {
    const {setDefinitionReloadBudget} = await import("../../src/testing/factory/node/definition-reload-policy.js")
    setDefinitionReloadBudget(options.policyBudget)
  }

  const registry = createFactoryRegistry()
  await loadDefinitions(registry, options.fixture)
  const observed = await registry.attributesFor("widget")

  if (options.probe) {
    printReport({
      dependencyTag: observed.depVersion,
      reportKind: "factory-esm-reload-retention",
      topLevelTag: observed.name
    })
    return
  }

  if (typeof globalThis.gc === "function") globalThis.gc()

  const baseline = memorySnapshot()
  let completedReloads = 0
  let recycleRequired = false
  /** @type {ReturnType<typeof JSON.parse> | null} */
  let recycleErrorCounts = null
  let dependencyEditCount = 0
  let dependencyEditVisible = 0
  let topLevelEditCount = 0
  let topLevelEditVisible = 0
  /** @type {Array<ReturnType<typeof JSON.parse>>} */
  const samples = []

  while (options.maxReloads === 0 || completedReloads < options.maxReloads) {
    const editIndex = options.startEditIndex + completedReloads
    /** @type {Array<"dependency" | "topLevel">} */
    let edits = []

    if (options.scenario === "edited") {
      edits = await applyEdit({directory: options.fixture, editIndex})
    }

    try {
      await reloadDefinitions(registry, options.fixture)
      completedReloads += 1

      for (const edit of edits) {
        if (edit === "topLevel") topLevelEditCount += 1
        else dependencyEditCount += 1
      }

      const reloaded = await registry.attributesFor("widget")

      if (edits.includes("topLevel") && reloaded.name === topLevelTagAt(editIndex)) topLevelEditVisible += 1

      if (edits.includes("dependency") && reloaded.depVersion === dependencyTagAt(editIndex)) dependencyEditVisible += 1
    } catch (error) {
      const typedError = /** @type {{name?: string, current?: number, budget?: number, requested?: number}} */ (error)

      if (options.epoch && typedError?.name === "DefinitionRecycleRequiredError") {
        recycleRequired = true
        recycleErrorCounts = {current: typedError.current, budget: typedError.budget, requested: typedError.requested}
        break
      }

      throw error
    }

    if (completedReloads % options.sampleEvery === 0) {
      if (typeof globalThis.gc === "function") globalThis.gc()

      samples.push({completedReloads, ...memorySnapshot()})
    }
  }

  printReport({
    baseline,
    budget: options.policyBudget > 0 ? options.policyBudget : null,
    completedReloads,
    dependencyEditCount,
    dependencyEditVisible,
    epoch: options.epoch,
    fileCount: options.fileCount,
    final: memorySnapshot(),
    importAttempts: completedReloads * options.fileCount,
    initialDependencyTag: observed.depVersion,
    initialTopLevelTag: observed.name,
    recycleErrorCounts,
    recycleRequired,
    reportKind: "factory-esm-reload-retention",
    samples,
    scenario: options.scenario,
    startEditIndex: options.startEditIndex,
    topLevelEditCount,
    topLevelEditVisible
  })
}

main().then(() => {
  process.exitCode = 0
}, (error) => {
  console.error(error)
  process.exitCode = 1
})
