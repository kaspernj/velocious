// @ts-check

import {performance} from "node:perf_hooks"

/**
 * @typedef {object} Measurement
 * @property {string} name - Benchmark name.
 * @property {number} operations - Number of invocations per sample.
 * @property {number} samples - Number of samples taken.
 * @property {number} medianUs - Median time per operation in microseconds.
 * @property {number} p95Us - 95th percentile time per operation in microseconds.
 * @property {number} minUs - Minimum time per operation in microseconds.
 */

const SAMPLES = 9
const WARMUPS = 3

/**
 * Measures a function with warmups and multiple samples, reporting median, p95 and min.
 * @param {string} name - Benchmark name.
 * @param {() => Promise<unknown> | unknown} fn - Function to measure.
 * @param {number} operations - Invocations per sample.
 * @returns {Promise<Measurement>} - Measurement.
 */
async function measure(name, fn, operations) {
  for (let i = 0; i < WARMUPS; i += 1) {
    for (let j = 0; j < operations; j += 1) {
      await fn()
    }
  }

  if (global.gc) {
    global.gc()
  }

  /** @type {number[]} */
  const perOpUs = []

  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const startedAtMs = performance.now()

    for (let j = 0; j < operations; j += 1) {
      await fn()
    }

    const totalMs = performance.now() - startedAtMs
    perOpUs.push((totalMs * 1000) / operations)
  }

  const sorted = [...perOpUs].sort((left, right) => left - right)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]

  return {
    medianUs: median,
    minUs: sorted[0],
    name,
    operations,
    p95Us: p95,
    samples: SAMPLES
  }
}

/** @param {Measurement[]} measurements - Measurements to print. */
function printTable(measurements) {
  console.log("path\toperations\tsamples\tmedian us/op\tp95 us/op\tmin us/op")

  for (const measurement of measurements) {
    console.log(
      `${measurement.name}\t${measurement.operations}\t${measurement.samples}\t`
      + `${measurement.medianUs.toFixed(2)}\t${measurement.p95Us.toFixed(2)}\t${measurement.minUs.toFixed(2)}`
    )
  }
}

const noopCallback = async () => "result"

const stackString = [
  "Error",
  "    at VelociousConfiguration.withDatabaseIdentifierConnections (/app/src/configuration.js:3171:19)",
  "    at VelociousConfiguration.ensureConnections (/app/src/configuration.js:3315:12)",
  "    at TestRunner.runTests (/app/src/testing/test-runner.js:1060:14)"
].join("\n")

// ---------------------------------------------------------------------------
// Tracked-stack: measure the no-op wrapper path BEFORE the async-hooks global is
// installed, then install the Node async-hooks implementation and measure the
// enabled scope path plus the failure-time annotation path.
// ---------------------------------------------------------------------------
const {withTrackedStack: browserSafeWithTrackedStack} = await import("../src/utils/with-tracked-stack.js")
const noopTrackedScope = await measure("tracked-stack scope (no-op)", () => {
  return browserSafeWithTrackedStack(noopCallback)
}, 20000)

await import("../src/utils/with-tracked-stack-async-hooks.js")
const {addTrackedStackToError, withTrackedStack} = await import("../src/utils/with-tracked-stack-async-hooks.js")

const enabledTrackedScope = await measure("tracked-stack scope (enabled, stack provided)", () => {
  return withTrackedStack(stackString, noopCallback)
}, 20000)

const enabledTrackedAnnotation = await measure("tracked-stack error annotation (enabled)", () => {
  return addTrackedStackToError(new Error("annotated"))
}, 20000)

// ---------------------------------------------------------------------------
// Database annotations: measure the no-op getter BEFORE installing the Node
// async-hooks implementation, then the enabled getter, scope and query-comment
// path with and without an active annotation context.
// ---------------------------------------------------------------------------
const {getDatabaseAnnotations, withDatabaseAnnotation} = await import("../src/database/annotations.js")
const noopAnnotationsGetter = await measure("annotations getter (no-op)", () => {
  return getDatabaseAnnotations()
}, 50000)

await import("../src/database/annotations-async-hooks.js")

const enabledAnnotationsGetter = await measure("annotations getter (enabled, empty)", () => {
  return getDatabaseAnnotations()
}, 50000)

const enabledAnnotationScope = await measure("annotation scope (enabled)", () => {
  return withDatabaseAnnotation("report export", noopCallback)
}, 20000)

// ---------------------------------------------------------------------------
// Query-comment path: the driver's process-list comment builder with and without
// an active annotation context. Both go through the same enabled getter; the
// annotated variant additionally carries a scope and an annotations part.
// ---------------------------------------------------------------------------
const {default: DatabaseDriverBase} = await import("../src/database/drivers/base.js")

class BenchmarkDriver extends DatabaseDriverBase {
  /** @type {string | undefined} */
  lastQuerySql = undefined

  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /** @returns {string} - Query SQL. */
  queryToSql() { return "" }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async _queryActual(sql) {
    this.lastQuerySql = sql
    return []
  }

  async _logQuery() {}
}

const benchmarkDriver = new BenchmarkDriver({}, {
  getCurrentRequestTiming() {
    return undefined
  },
  getQueryLoggingEnabled() {
    return false
  }
})

const commentNoAnnotations = await measure("query-comment (no annotations)", () => {
  return benchmarkDriver._querySqlWithProcessListComment("SELECT 1", {})
}, 50000)

const commentWithAnnotations = await measure("query-comment (annotation active)", () => {
  return withDatabaseAnnotation("report export", () => {
    return benchmarkDriver._querySqlWithProcessListComment("SELECT 1", {})
  })
}, 20000)

// ---------------------------------------------------------------------------
// Console capture: measure the per-attempt lifecycle for quiet and logging tests.
// The runner captures for every attempt, then discards the output for successes.
// ---------------------------------------------------------------------------
const {default: TestRunner} = await import("../src/testing/test-runner.js")
const testRunner = new TestRunner({configuration: {}, testFiles: []})
const startConsoleCapture = testRunner.startConsoleCapture.bind(testRunner)

/** @param {number} count - Number of lines. */
function logLines(count) {
  for (let i = 0; i < count; i += 1) {
    console.log(`benchmark console line ${i}`)
  }
}

const quietCaptureLifecycle = await measure("console capture lifecycle (quiet test)", () => {
  const stopCapture = startConsoleCapture({passthrough: false})
  const output = stopCapture()
  return output
}, 20000)

const loggingCaptureLifecycle = await measure("console capture lifecycle (10 logging lines)", () => {
  const stopCapture = startConsoleCapture({passthrough: false})
  logLines(10)
  const output = stopCapture()
  return output
}, 2000)

// ---------------------------------------------------------------------------
// Query source stack: prove the current conditional behavior — no stack capture
// when query logging is off, stack capture when on.
// ---------------------------------------------------------------------------
const queryLoggingOff = await measure("driver.query (logQuery off)", () => {
  return benchmarkDriver.query("SELECT 1", {logQuery: false})
}, 5000)

const queryLoggingOn = await measure("driver.query (logQuery on)", () => {
  return benchmarkDriver.query("SELECT 1", {logQuery: true})
}, 5000)

const rawStackCapture = await measure("Error().stack capture (reference)", () => {
  return new Error().stack
}, 5000)

console.log("")
printTable([
  noopTrackedScope,
  enabledTrackedScope,
  enabledTrackedAnnotation,
  noopAnnotationsGetter,
  enabledAnnotationsGetter,
  enabledAnnotationScope,
  commentNoAnnotations,
  commentWithAnnotations,
  quietCaptureLifecycle,
  loggingCaptureLifecycle,
  queryLoggingOff,
  queryLoggingOn,
  rawStackCapture
])