// @ts-check

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  FIXTURE_FILE_COUNT,
  childCompletedSuccessfully,
  dependencyTagAt,
  parseChildReport,
  planEpochs,
  topLevelTagAt,
  validateBenchmarkRows,
  writeFixture
} from "./support/factory-esm-reload-retention.js"

/**
 * @typedef {object} ChildResult
 * @property {boolean} ok - Whether the child exited cleanly with one valid report.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} report - Parsed child report.
 */

const __filename = fileURLToPath(import.meta.url)
const benchmarkDirectory = path.dirname(__filename)
const childPath = path.join(benchmarkDirectory, "support", "factory-esm-reload-retention-child.js")

/** Default supervised import budget per child epoch. */
const DEFAULT_SUPERVISED_BUDGET = 300

/**
 * Spawns a child epoch process and accepts its report only when the child exits
 * with code zero and no signal. Timeout and native failures remain terminal.
 * @param {string[]} args - Child arguments.
 * @param {number} timeoutMs - Hard timeout before the child is killed.
 * @returns {Promise<ChildResult>} - The child outcome.
 */
function runChild(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--expose-gc", childPath, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"]
    })
    let stdout = ""
    let settled = false
    let timedOut = false

    const finish = (ok, report = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, report })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.on("error", () => finish(false))
    child.on("close", (code, signal) => {
      const report = parseChildReport(stdout)
      const ok = !timedOut && childCompletedSuccessfully({ code, report, signal })

      finish(ok, report)
    })
  })
}

/** Runs the single-process baseline row. */
function runSingleBaseline({ fixture, reloads, scenario }) {
  const sampleEvery = Math.max(10, Math.floor(reloads / 20))

  return runChild([
    "--fixture", fixture,
    "--scenario", scenario,
    "--max-reloads", String(reloads),
    "--sample-every", String(sampleEvery),
    "--file-count", String(FIXTURE_FILE_COUNT)
  ], 300_000)
}

/** Returns the highest numeric field from a child report and its samples. */
function peakMemory(report, field) {
  const samples = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (report.samples || [])
  const values = [Number(report.baseline[field]), Number(report.final[field]), ...samples.map((sample) => Number(sample[field]))]

  return Math.max(...values)
}

/** Throws when an epoch report violates deterministic process-budget behavior. */
function validateEpochReport({ budget, capacity, count, lastEpoch, report, scenario, startEditIndex }) {
  const completed = Number(report.completedReloads)
  const expectedRecycle = !lastEpoch
  const counts = /** @type {Record<string, ReturnType<typeof JSON.parse>> | null} */ (report.recycleErrorCounts)

  if (report.reportKind !== "factory-esm-reload-retention" || report.epoch !== true || report.scenario !== scenario) {
    throw new Error(`Malformed supervised epoch report at reload ${startEditIndex}`)
  }
  if (completed !== count || Number(report.importAttempts) !== count * FIXTURE_FILE_COUNT) {
    throw new Error(`Supervised epoch at reload ${startEditIndex} completed an unexpected import count`)
  }
  if (completed > capacity || Number(report.importAttempts) > budget) {
    throw new Error(`Supervised epoch at reload ${startEditIndex} exceeded its import budget`)
  }
  if (Boolean(report.recycleRequired) !== expectedRecycle) {
    throw new Error(`Supervised epoch at reload ${startEditIndex} reported an unexpected recycle boundary`)
  }
  if (expectedRecycle && (!counts || Number(counts.current) !== capacity * FIXTURE_FILE_COUNT || Number(counts.budget) !== budget || Number(counts.requested) !== FIXTURE_FILE_COUNT)) {
    throw new Error(`Supervised epoch at reload ${startEditIndex} reported invalid recycle counts`)
  }
}

/**
 * Runs a supervised row across whole child-process epochs.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Aggregated row data.
 */
async function runSupervised({ budget, fixture, reloads, scenario }) {
  const capacity = Math.floor(budget / FIXTURE_FILE_COUNT)
  const epochCounts = planEpochs({ totalReloads: reloads, capacity })
  const epochs = []
  let completed = 0
  let dependencyVisibilityAcrossBoundaries = true

  for (let epochIndex = 0; epochIndex < epochCounts.length; epochIndex += 1) {
    const count = epochCounts[epochIndex]
    const lastEpoch = epochIndex === epochCounts.length - 1
    const maxReloads = lastEpoch ? count : count + 1
    const result = await runChild([
      "--epoch",
      "--fixture", fixture,
      "--policy-budget", String(budget),
      "--scenario", scenario,
      "--start-edit-index", String(completed),
      "--max-reloads", String(maxReloads),
      "--sample-every", String(Math.max(10, Math.ceil(count / 20))),
      "--file-count", String(FIXTURE_FILE_COUNT)
    ], 300_000)
    const report = result.report

    if (!result.ok || !report) throw new Error(`Factory ESM reload benchmark child ${epochIndex} failed`)

    validateEpochReport({ budget, capacity, count, lastEpoch, report, scenario, startEditIndex: completed })

    if (scenario === "edited" && epochIndex > 0 && report.initialDependencyTag !== dependencyTagAt(completed)) {
      dependencyVisibilityAcrossBoundaries = false
    }

    const rssDelta = Number(report.final.rss) - Number(report.baseline.rss)
    const heapDelta = Number(report.final.heapUsed) - Number(report.baseline.heapUsed)

    epochs.push({
      completedReloads: Number(report.completedReloads),
      dependencyEditCount: Number(report.dependencyEditCount),
      dependencyEditVisibleWithinProcess: Number(report.dependencyEditVisible),
      epochIndex,
      heapDelta,
      importAttempts: Number(report.importAttempts),
      maxReloads,
      peakRss: peakMemory(report, "rss"),
      recycleRequired: Boolean(report.recycleRequired),
      rssAfter: Number(report.final.rss),
      rssDelta,
      topLevelEditCount: Number(report.topLevelEditCount),
      topLevelEditVisible: Number(report.topLevelEditVisible)
    })
    completed += Number(report.completedReloads)
  }

  return {
    completedReloads: completed,
    dependencyVisibilityAcrossBoundaries,
    epochs,
    epochsWithinBudget: epochs.every((epoch) => Number(epoch.importAttempts) <= budget),
    importAttempts: epochs.reduce((total, epoch) => total + Number(epoch.importAttempts), 0),
    peakRss: Math.max(...epochs.map((epoch) => Number(epoch.peakRss))),
    rssDelta: Math.max(...epochs.map((epoch) => Number(epoch.rssDelta))),
    topLevelEditCount: epochs.reduce((total, epoch) => total + Number(epoch.topLevelEditCount), 0),
    topLevelEditVisible: epochs.reduce((total, epoch) => total + Number(epoch.topLevelEditVisible), 0)
  }
}

/** Probes edited top-level and dependency tags after a whole-process recycle. */
async function probeEditedVisibility({ fixture, lastEditIndex }) {
  const result = await runChild(["--probe", "--fixture", fixture], 60_000)
  const report = result.report

  if (!result.ok || !report) return { dependency: false, topLevel: false }

  return {
    dependency: report.dependencyTag === dependencyTagAt(lastEditIndex),
    topLevel: report.topLevelTag === topLevelTagAt(lastEditIndex)
  }
}

/** Runs one matrix row inside a disposable fixture directory. */
async function runRow({ budget, mode, reloads, scenario }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "esm-reload-retention-"))
  const fixture = path.join(root, "fixture")
  await fs.mkdir(fixture)
  await writeFixture(fixture)

  try {
    if (mode === "single") {
      const result = await runSingleBaseline({ fixture, reloads, scenario })
      const report = result.report || {}

      return {
        ...report,
        dependencyVisibilityAcrossRecycle: null,
        epochsWithinBudget: null,
        mode,
        ok: result.ok,
        peakRss: result.ok ? peakMemory(report, "rss") : null,
        reloads,
        rssDelta: result.ok ? Number(report.final.rss) - Number(report.baseline.rss) : null,
        scenario,
        supervised: false
      }
    }

    const supervised = await runSupervised({ budget, fixture, reloads, scenario })
    const visibility = scenario === "edited"
      ? await probeEditedVisibility({ fixture, lastEditIndex: reloads - 1 })
      : { dependency: true, topLevel: true }

    return {
      budget,
      childCount: supervised.epochs.length,
      completedReloads: supervised.completedReloads,
      dependencyVisibilityAcrossRecycle: supervised.dependencyVisibilityAcrossBoundaries && visibility.dependency,
      epochs: supervised.epochs,
      epochsWithinBudget: supervised.epochsWithinBudget,
      importAttempts: supervised.importAttempts,
      mode,
      ok: visibility.topLevel,
      peakRss: supervised.peakRss,
      reloads,
      rssDelta: supervised.rssDelta,
      scenario,
      supervised: true,
      topLevelEditCount: supervised.topLevelEditCount,
      topLevelEditVisible: supervised.topLevelEditVisible,
      topLevelVisibilityAcrossRecycle: visibility.topLevel
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

/** Reads the optional supervised epoch budget. */
function parseBudget() {
  const budgetIndex = process.argv.indexOf("--budget")
  const budget = budgetIndex === -1 ? DEFAULT_SUPERVISED_BUDGET : Number(process.argv[budgetIndex + 1])

  if (!Number.isInteger(budget) || budget < FIXTURE_FILE_COUNT) {
    throw new TypeError(`Benchmark budget must be an integer of at least ${FIXTURE_FILE_COUNT}, got ${JSON.stringify(budget)}`)
  }

  return budget
}

/** Runs and validates the canonical eight-row matrix. */
async function main() {
  const budget = parseBudget()
  const rows = []

  for (const mode of ["single", "supervised"]) {
    for (const scenario of ["unchanged", "edited"]) {
      for (const reloads of [100, 1000]) {
        rows.push(await runRow({ budget, mode, reloads, scenario }))
      }
    }
  }

  const summary = validateBenchmarkRows(rows)

  console.log("mode\tscenario\treloads\tok\tepochs\tcompleted\trss delta\tpeak rss")

  for (const row of rows) {
    console.log(`${row.mode}\t${row.scenario}\t${row.reloads}\t${row.ok}\t${row.supervised ? row.childCount : "n/a"}\t${row.completedReloads}\t${row.rssDelta}\t${row.peakRss}`)
  }

  console.log(`__FACTORY_ESM_RELOAD_RETENTION_RESULT__ ${JSON.stringify({ ...summary, rowCount: rows.length, rows })}`)
}

main().then(() => {
  process.exitCode = 0
}, (error) => {
  console.error(error)
  process.exitCode = 1
})
