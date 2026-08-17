// @ts-check

import {deferred} from "awaitery"
import LocalBackgroundJobsAdapter from "../../src/background-jobs/local-adapter.js"
import VelociousJob from "../../src/background-jobs/platform-job.js"
import Configuration from "../../src/configuration.js"

/** Deterministic clock for local dispatcher specs. */
export class ManualBackgroundJobsClock {
  /** @type {number} */
  currentMs
  /** @type {number} */
  nextTimerId = 1
  /** @type {Map<number, {callback: () => void, scheduledAtMs: number}>} */
  timers = new Map()

  /** @param {number} [currentMs] - Initial epoch milliseconds. */
  constructor(currentMs = 1_000) {
    this.currentMs = currentMs
  }

  /** @returns {number} - Current epoch milliseconds. */
  now() { return this.currentMs }

  /**
   * @param {() => void} callback - Timer callback.
   * @param {number} delayMs - Timer delay.
   * @returns {number} - Timer identifier.
   */
  // Injected through the structural clock contract; Fallow cannot trace that call.
  // fallow-ignore-next-line unused-class-member
  setTimeout(callback, delayMs) {
    const timerId = this.nextTimerId++

    this.timers.set(timerId, {callback, scheduledAtMs: this.currentMs + delayMs})
    return timerId
  }

  /** @param {number} timerId - Timer identifier. @returns {void} - No return value. */
  // Injected through the structural clock contract; Fallow cannot trace that call.
  // fallow-ignore-next-line unused-class-member
  clearTimeout(timerId) { this.timers.delete(timerId) }

  /**
   * Advances time and runs every timer now due in stable order.
   * @param {number} delayMs - Milliseconds to advance.
   * @returns {Promise<void>} - Resolves after due callbacks have run.
   */
  async advance(delayMs) {
    this.currentMs += delayMs

    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.scheduledAtMs <= this.currentMs)
        .sort((left, right) => left[1].scheduledAtMs - right[1].scheduledAtMs || left[0] - right[0])
      const next = due[0]

      if (!next) break

      this.timers.delete(next[0])
      next[1].callback()
      await Promise.resolve()
    }
  }
}

/** Records successful local performances. */
export class RecordingLocalJob extends VelociousJob {
  // Read reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  static databaseIdentifiers = []
  /** @type {Array<Array<ReturnType<typeof JSON.parse>>>} */
  static performances = []

  /** @param {...ReturnType<typeof JSON.parse>} args - Serialized arguments. @returns {Promise<void>} - Resolves after recording. */
  // Called reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  async perform(...args) { RecordingLocalJob.performances.push(args) }
}

/** Holds named jobs until their test-controlled gate resolves. */
export class GatedLocalJob extends VelociousJob {
  // Read reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  static databaseIdentifiers = []
  /** @type {Map<string, Promise<void>>} */
  static gates = new Map()
  /** @type {Map<string, () => void>} */
  static startedCallbacks = new Map()

  /** @param {string} name - Gate name. @returns {Promise<void>} - Resolves after release. */
  // Called reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  async perform(name) {
    const startedCallback = GatedLocalJob.startedCallbacks.get(name)
    const gate = GatedLocalJob.gates.get(name)

    if (!startedCallback || !gate) throw new Error(`Missing local background-job gate: ${name}`)

    startedCallback()
    await gate
  }
}

/** Fails a configured number of attempts before succeeding. */
export class RetryingLocalJob extends VelociousJob {
  // Read reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  static databaseIdentifiers = []
  /** @type {Map<string, number>} */
  static attempts = new Map()

  /**
   * @param {string} name - Attempt identity.
   * @param {number} failures - Failures before success.
   * @returns {Promise<void>} - Resolves after a successful attempt.
   */
  // Called reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  async perform(name, failures) {
    const attempts = (RetryingLocalJob.attempts.get(name) || 0) + 1

    RetryingLocalJob.attempts.set(name, attempts)
    if (attempts <= failures) throw new Error(`planned local failure ${attempts}`)
  }
}

/** Reschedules once without consuming a retry. */
export class ReschedulingLocalJob extends VelociousJob {
  // Read reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  static databaseIdentifiers = []
  static attempts = 0

  /** @returns {Promise<void>} - Resolves on the second performance. */
  // Called reflectively by performBackgroundJob; Fallow cannot trace that framework contract.
  // fallow-ignore-next-line unused-class-member
  async perform() {
    ReschedulingLocalJob.attempts++
    if (ReschedulingLocalJob.attempts === 1) this.rescheduleIn(500)
  }
}

/**
 * Installs one configuration-owned local adapter for a focused spec.
 * @param {object} [args] - Harness options.
 * @param {ManualBackgroundJobsClock} [args.clock] - Dispatcher clock.
 * @param {Array<typeof VelociousJob>} [args.jobClasses] - Registered jobs.
 * @param {number} [args.maxConcurrentInlineJobs] - Local dispatcher capacity.
 * @param {Record<string, {maxConcurrent?: number, priority?: number}>} [args.queues] - Queue settings.
 * @returns {Promise<{adapter: LocalBackgroundJobsAdapter, clock: ManualBackgroundJobsClock, configuration: Configuration}>} - Ready harness.
 */
export async function localBackgroundJobsHarness({clock = new ManualBackgroundJobsClock(), jobClasses = [RecordingLocalJob], maxConcurrentInlineJobs = 4, queues = {}} = {}) {
  const configuration = Configuration.current()

  await configuration.closeBackgroundJobsAdapter()
  configuration.setBackgroundJobsConfig({
    adapter: ({configuration: adapterConfiguration}) => new LocalBackgroundJobsAdapter({configuration: adapterConfiguration, clock}),
    databaseIdentifier: "default",
    jobClasses,
    maxConcurrentInlineJobs,
    mode: "background",
    queues
  })
  configuration.setCurrent()

  const adapter = await configuration.acquireReadyBackgroundJobsAdapter()

  if (!(adapter instanceof LocalBackgroundJobsAdapter)) throw new Error("Expected local background-jobs adapter")

  return {adapter, clock, configuration}
}

/**
 * Creates a deterministic performance gate.
 * @param {string} name - Gate name.
 * @returns {{release: () => void, started: Promise<void>}} - Gate controls.
 */
export function gateLocalJob(name) {
  const gate = deferred()
  const started = deferred()

  GatedLocalJob.gates.set(name, gate.promise)
  GatedLocalJob.startedCallbacks.set(name, () => started.resolve(undefined))

  return {release: () => gate.resolve(undefined), started: started.promise}
}

/** Resets mutable test job state. @returns {void} - No return value. */
export function resetLocalBackgroundJobClasses() {
  GatedLocalJob.gates.clear()
  GatedLocalJob.startedCallbacks.clear()
  RecordingLocalJob.performances = []
  ReschedulingLocalJob.attempts = 0
  RetryingLocalJob.attempts.clear()
}
