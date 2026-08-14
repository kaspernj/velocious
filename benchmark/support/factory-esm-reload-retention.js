// @ts-check

import fs from "node:fs/promises"
import path from "node:path"

/** Number of fixture definition files imported per reload. */
export const FIXTURE_FILE_COUNT = 3

/** Initial dependency tag written into the fixture. */
const INITIAL_DEPENDENCY_TAG = "dep-0"

/** Initial top-level tag written into the fixture. */
const INITIAL_TOP_LEVEL_TAG = "top-0"

/** Marker that prefixes a child JSON report on stdout. */
export const REPORT_PREFIX = "__VELOCIOUS_FACTORY_ESM_RELOAD_RETENTION__"

/** Expected benchmark matrix dimensions. */
const BENCHMARK_MODES = ["single", "supervised"]
const BENCHMARK_RELOAD_COUNTS = [100, 1000]
const BENCHMARK_SCENARIOS = ["unchanged", "edited"]

/**
 * Resolves the top-level definition tag in effect after a deterministic edit at
 * the given reload index. Top-level files are edited every third reload.
 * @param {number} editIndex - Global reload index.
 * @returns {string} - The tag currently written into the top-level file.
 */
export function topLevelTagAt(editIndex) {
  return `top-${3 * Math.floor(editIndex / 3)}`
}

/**
 * Resolves the dependency tag in effect after a deterministic edit at the given
 * reload index. Dependency files are edited every fourth reload.
 * @param {number} editIndex - Global reload index.
 * @returns {string} - The tag currently written into the dependency file.
 */
export function dependencyTagAt(editIndex) {
  return `dep-${4 * Math.floor(editIndex / 4)}`
}

/** Builds the helper module source, which doubles as a definition file. */
function helperSource(dependencyTag) {
  return `export const helperValue = "${dependencyTag}"
export default function(registry) {
  registry.define(({factory}) => {
    factory("helperMarker", class HelperMarker {}, ({attribute}) => attribute("value", helperValue))
  })
}
`
}

/** Builds the top-level definition source, importing the helper module. */
function widgetSource(topLevelTag) {
  return `import {helperValue} from "./a-helper.js"
export default function(registry) {
  registry.define(({factory}) => {
    factory("widget", class Widget {}, ({attribute}) => {
      attribute("name", "${topLevelTag}")
      attribute("depVersion", helperValue)
    })
  })
}
`
}

/** Builds the second definition file, independent of the dependency. */
function gadgetSource() {
  return `export default function(registry) {
  registry.define(({factory}) => {
    factory("gadget", class Gadget {}, ({attribute}) => attribute("count", 1))
  })
}
`
}

/**
 * Writes the fixture definition files into an existing directory.
 * @param {string} directory - Existing directory to write into.
 * @param {object} [args] - Options.
 * @param {string} [args.dependencyTag] - Initial dependency tag.
 * @param {string} [args.topLevelTag] - Initial top-level tag.
 * @returns {Promise<void>} - Resolves when the fixture is written.
 */
export async function writeFixture(directory, {dependencyTag = INITIAL_DEPENDENCY_TAG, topLevelTag = INITIAL_TOP_LEVEL_TAG} = {}) {
  await fs.writeFile(path.join(directory, "a-helper.js"), helperSource(dependencyTag))
  await fs.writeFile(path.join(directory, "b-definitions.js"), widgetSource(topLevelTag))
  await fs.writeFile(path.join(directory, "z-definitions.js"), gadgetSource())
}

/**
 * Applies the deterministic edit for a global reload index. Top-level edits
 * rewrite the definition file; dependency edits rewrite the helper module while
 * the top-level file stays untouched.
 * @param {object} args - Options.
 * @param {string} args.directory - Fixture directory.
 * @param {number} args.editIndex - Global reload index used to derive the edit.
 * @returns {Promise<Array<"dependency" | "topLevel">>} - The applied edits, in order.
 */
export async function applyEdit({directory, editIndex}) {
  /** @type {Array<"dependency" | "topLevel">} */
  const edits = []

  if (editIndex % 3 === 0) {
    await fs.writeFile(path.join(directory, "b-definitions.js"), widgetSource(`top-${editIndex}`))
    edits.push("topLevel")
  }

  if (editIndex % 4 === 0) {
    await fs.writeFile(path.join(directory, "a-helper.js"), helperSource(`dep-${editIndex}`))
    edits.push("dependency")
  }

  return edits
}

/**
 * Plans deterministic child-epoch reload counts for a supervised recycle run.
 * Every epoch but the last runs exactly at capacity so the following reload
 * attempt trips the recycle boundary; the final epoch completes the remainder.
 * @param {object} args - Options.
 * @param {number} args.totalReloads - Total logical reloads to complete.
 * @param {number} args.capacity - Maximum reloads one child process can perform before exhausting its import budget.
 * @returns {number[]} - Per-epoch reload counts.
 */
export function planEpochs({totalReloads, capacity}) {
  /** @type {number[]} */
  const epochs = []
  let remaining = totalReloads

  while (remaining > 0) {
    const count = Math.min(remaining, capacity)
    epochs.push(count)
    remaining -= count
  }

  return epochs
}

/**
 * Extracts the child report object from raw stdout lines.
 * @param {string} output - Raw child stdout.
 * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Parsed report, or null when absent.
 */
export function parseChildReport(output) {
  const reportLines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(REPORT_PREFIX))

  if (reportLines.length !== 1) return null

  try {
    const report = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(reportLines[0].slice(REPORT_PREFIX.length)))

    if (!report || Array.isArray(report) || report.reportKind !== "factory-esm-reload-retention") return null

    return report
  } catch {
    return null
  }
}

/**
 * Validates the complete child-process completion boundary.
 * @param {object} args - Child completion data.
 * @param {number | null} args.code - Child exit code.
 * @param {Record<string, ReturnType<typeof JSON.parse>> | null} args.report - Parsed report.
 * @param {string | null} args.signal - Child termination signal.
 * @returns {boolean} - Whether the child completed successfully.
 */
export function childCompletedSuccessfully({code, report, signal}) {
  return code === 0 && signal === null && report !== null
}

/** Builds the canonical identity for one matrix row. */
function rowKey(row) {
  return `${row.mode}/${row.scenario}/${row.reloads}`
}

/** Returns the number of deterministic top-level edits for a row. */
function expectedTopLevelEdits({reloads, scenario}) {
  if (scenario === "unchanged") return 0

  return Math.floor((reloads - 1) / 3) + 1
}

/**
 * Validates the complete 2 x 2 x 2 benchmark matrix and its deterministic
 * correctness invariants. Throws on every logical failure so the CLI exits
 * nonzero instead of publishing a plausible-looking partial report.
 * @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} rows - Matrix rows.
 * @returns {{dependencyVisibilityAcrossRecycle: boolean, supervisedWithinBudget: boolean}} - Validated summary.
 */
export function validateBenchmarkRows(rows) {
  if (rows.length !== 8) throw new Error(`Factory ESM reload benchmark must emit exactly 8 rows, got ${rows.length}`)

  const expectedKeys = new Set(BENCHMARK_MODES.flatMap((mode) => (
    BENCHMARK_SCENARIOS.flatMap((scenario) => (
      BENCHMARK_RELOAD_COUNTS.map((reloads) => `${mode}/${scenario}/${reloads}`)
    ))
  )))
  const seenKeys = new Set()

  for (const row of rows) {
    const key = rowKey(row)

    if (!expectedKeys.has(key)) throw new Error(`Factory ESM reload benchmark emitted unexpected row ${key}`)
    if (seenKeys.has(key)) throw new Error(`Factory ESM reload benchmark emitted duplicate row ${key}`)
    seenKeys.add(key)

    const reloads = Number(row.reloads)
    const expectedImports = reloads * FIXTURE_FILE_COUNT
    const expectedEdits = expectedTopLevelEdits({reloads, scenario: String(row.scenario)})

    if (row.ok !== true) throw new Error(`Factory ESM reload benchmark row ${key} reported a logical failure`)
    if (Number(row.completedReloads) !== reloads) {
      throw new Error(`Factory ESM reload benchmark row ${key} completed reloads ${row.completedReloads}, expected ${reloads}`)
    }
    if (Number(row.importAttempts) !== expectedImports) {
      throw new Error(`Factory ESM reload benchmark row ${key} attempted ${row.importAttempts} imports, expected ${expectedImports}`)
    }
    if (Number(row.topLevelEditCount) !== expectedEdits || Number(row.topLevelEditVisible) !== expectedEdits) {
      throw new Error(`Factory ESM reload benchmark row ${key} did not expose every edited top-level definition`)
    }

    const supervised = row.mode === "supervised"

    if (Boolean(row.supervised) !== supervised) throw new Error(`Factory ESM reload benchmark row ${key} has inconsistent mode metadata`)
    if (supervised && row.epochsWithinBudget !== true) throw new Error(`Factory ESM reload benchmark row ${key} exceeded its supervised import budget`)
    if (supervised && row.scenario === "edited" && row.dependencyVisibilityAcrossRecycle !== true) {
      throw new Error(`Factory ESM reload benchmark row ${key} missed edited dependency visibility across a recycle boundary`)
    }
  }

  if (seenKeys.size !== expectedKeys.size) throw new Error("Factory ESM reload benchmark matrix has missing rows")

  return {dependencyVisibilityAcrossRecycle: true, supervisedWithinBudget: true}
}
