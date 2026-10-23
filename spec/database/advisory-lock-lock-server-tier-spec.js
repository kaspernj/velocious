// @ts-check

import AdvisoryLockRunner from "../../src/database/advisory-lock-runner.js"
import {
  AdvisoryLockLostError,
  AdvisoryLockServiceUnavailableError
} from "../../src/database/advisory-lock-errors.js"
import {
  AdvisoryLockBackendUnavailableError,
  resolveAdvisoryLockBackendPolicy
} from "../../src/database/advisory-lock-backend-policy.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** Minimal error-channel double that records emitted reports. */
class FakeErrorEvents {
  constructor() {
    /** @type {{payload: Record<string, unknown>, type: string}[]} */
    this.events = []
  }

  /**
   * @param {string} type - Event name.
   * @param {Record<string, unknown>} payload - Event payload.
   * @returns {void}
   */
  emit(type, payload) {
    this.events.push({payload, type})
  }
}

/** Minimal telemetry emitter double (EventEmitter surface the reporter uses). */
class FakeTelemetryEvents {
  constructor() {
    /** @type {{payload: Record<string, unknown>, type: string}[]} */
    this.events = []
  }

  /**
   * @param {string} type - Event name.
   * @returns {number} - Listener count (always one: the double records everything).
   */
  listenerCount(type) {
    void type

    return 1
  }

  /**
   * @param {string} type - Event name.
   * @param {Record<string, unknown>} payload - Event payload.
   * @returns {void}
   */
  emit(type, payload) {
    this.events.push({payload, type})
  }
}

/** Configuration double exposing exactly the advisory-lock surface the runner uses. */
class FakeConfiguration {
  /**
   * @param {{backend: StubLockServerBackend | null, policy: import("../../src/database/advisory-lock-backend-policy.js").AdvisoryLockBackendPolicyEntry[]}} args - Doubles.
   */
  constructor({backend, policy}) {
    this.backend = backend
    this.policy = policy
    this.errorEvents = new FakeErrorEvents()
    this.telemetryEvents = new FakeTelemetryEvents()
    /** @type {{backend: string, fencingSupported: boolean, lockName: string}[]} */
    this.acquisitions = []
  }

  /** @returns {FakeErrorEvents} */
  getErrorEvents() {
    return this.errorEvents
  }

  /** @returns {FakeTelemetryEvents} */
  getTelemetryEvents() {
    return this.telemetryEvents
  }

  /** @returns {import("../../src/database/advisory-lock-backend-policy.js").AdvisoryLockBackendPolicyEntry[]} */
  getAdvisoryLockPolicy() {
    return this.policy
  }

  /**
   * @param {string} lockName - Lock name.
   * @returns {import("../../src/database/advisory-lock-backend-policy.js").ResolvedAdvisoryLockBackendPolicy}
   */
  resolveAdvisoryLockPolicy(lockName) {
    return resolveAdvisoryLockBackendPolicy(lockName, this.policy)
  }

  /** @returns {Promise<StubLockServerBackend | null>} */
  async getAdvisoryLockLockServerBackend() {
    return this.backend
  }

  /** @returns {Promise<undefined>} */
  async getAdvisoryLockFileBackend() {
    return undefined
  }

  /**
   * @param {{backend: string, fencingSupported: boolean, lockName: string}} record - Acquisition record.
   * @returns {void}
   */
  recordAdvisoryLockAcquisition(record) {
    this.acquisitions.push(record)
  }
}

/** Lock-server backend double. */
class StubLockServerBackend {
  /**
   * @param {{acquired?: boolean, failure?: Error, loss?: {currentEpoch: number | null, epoch: number | null} | null}} [args] - Behavior.
   */
  constructor({acquired = true, failure, loss = null} = {}) {
    this.acquired = acquired
    this.failure = failure
    this.loss = loss
    /** @type {string[]} */
    this.released = []
  }

  /** @returns {Promise<boolean>} */
  async acquire() {
    if (this.failure) throw this.failure

    return this.acquired
  }

  /** @returns {Promise<boolean>} */
  async tryAcquire() {
    if (this.failure) throw this.failure

    return this.acquired
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<void>}
   */
  async release(name) {
    this.released.push(name)
  }

  /** @returns {number} */
  getHoldEpoch() {
    return 11
  }

  /**
   * @param {string} name - Lock name.
   * @param {number | null} epoch - Held epoch.
   * @returns {{currentEpoch: number | null, epoch: number | null} | null}
   */
  takeLoss(name, epoch) {
    void name
    void epoch

    return this.loss
  }
}

/**
 * Driver-tier connection double.
 * @param {{events: string[]}} args - Recorder.
 * @returns {Record<string, unknown>} - Stub connection.
 */
function stubDriverConnection({events}) {
  return {
    acquireAdvisoryLock: async (/** @type {string} */ name) => {
      events.push(`driver acquire ${name}`)

      return true
    },
    advisoryLockBackendTier: () => "driver-native",
    getType: () => "mysql",
    releaseAdvisoryLock: async (/** @type {string} */ name) => {
      events.push(`driver release ${name}`)
    },
    tryAcquireAdvisoryLock: async (/** @type {string} */ name) => {
      events.push(`driver try ${name}`)

      return true
    }
  }
}

/**
 * Builds a runner wired to the doubles.
 * @param {{backend: StubLockServerBackend | null, events?: string[], policy: import("../../src/database/advisory-lock-backend-policy.js").AdvisoryLockBackendPolicyEntry[]}} args - Wiring.
 * @returns {{configuration: FakeConfiguration, runner: AdvisoryLockRunner}} - Runner and its configuration double.
 */
function buildRunner({backend, events = [], policy}) {
  const configuration = new FakeConfiguration({backend, policy})
  const runner = new AdvisoryLockRunner({
    configuration: /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ (configuration)),
    connectionProvider: () => /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ (stubDriverConnection({events}))),
    databaseIdentifier: "default"
  })

  return {configuration, runner}
}

describe("AdvisoryLockRunner - lock-server tier", () => {
  it("serves a preferred name from the lock server and releases the lease", async () => {
    const backend = new StubLockServerBackend()
    const {configuration, runner} = buildRunner({
      backend,
      events: [],
      policy: [{allowedTiers: ["lock-server", "driver-native"], minTier: "driver-native", name: "unit-pref*", preferredTier: "lock-server"}]
    })
    /** @type {unknown} */
    let seenLockBackend

    const result = await runner.withAdvisoryLock("unit-pref-a", async (args) => {
      seenLockBackend = args?.lockBackend

      return "done"
    })

    expect(result).toEqual("done")
    expect(/** @type {{backend: string, epoch: number}} */ (seenLockBackend).backend).toEqual("lock-server")
    expect(/** @type {{backend: string, epoch: number}} */ (seenLockBackend).epoch).toEqual(11)
    expect(backend.released).toEqual(["unit-pref-a"])
    expect(configuration.acquisitions).toEqual([{backend: "lock-server", fencingSupported: true, lockName: "unit-pref-a"}])
    expect(configuration.errorEvents.events).toEqual([])
  })

  it("falls up to the driver tier and reports the fallback when the server is unreachable", async () => {
    const events = []
    const failure = new AdvisoryLockServiceUnavailableError("lock server down", {lockName: "unit-pref-b", reason: "connect-failed"})
    const {configuration, runner} = buildRunner({
      backend: new StubLockServerBackend({failure}),
      events,
      policy: [{minTier: "driver-native", name: "unit-pref*", preferredTier: "lock-server"}]
    })

    const result = await runner.withAdvisoryLock("unit-pref-b", async () => "driver-result")

    expect(result).toEqual("driver-result")
    expect(events).toEqual(["driver acquire unit-pref-b", "driver release unit-pref-b"])
    expect(configuration.acquisitions).toEqual([{backend: "driver-native", fencingSupported: true, lockName: "unit-pref-b"}])

    const fallback = configuration.telemetryEvents.events.find((event) => event.payload.context === "advisory-lock-fallback")

    expect(fallback).toBeTruthy()
    expect(fallback?.type).toEqual("telemetry")
    expect(fallback?.payload).toMatchObject({lockName: "unit-pref-b", preferredTier: "lock-server", servedBy: "driver-native"})
    // A fallback is a measurement, not a failure: it must never reach the
    // framework-error channel and its bug reporters.
    expect(configuration.errorEvents.events).toEqual([])
  })

  it("refuses loudly when the name requires the lock-server tier and the server is down", async () => {
    const failure = new AdvisoryLockServiceUnavailableError("lock server down", {lockName: "unit-strict", reason: "connect-failed"})
    const {runner} = buildRunner({
      backend: new StubLockServerBackend({failure}),
      policy: [{minTier: "lock-server", name: "unit-strict", preferredTier: "lock-server"}]
    })
    /** @type {unknown} */
    let thrown

    try {
      await runner.withAdvisoryLock("unit-strict", async () => "never")
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AdvisoryLockBackendUnavailableError)
    expect(/** @type {AdvisoryLockBackendUnavailableError} */ (thrown).minTier).toEqual("lock-server")
  })

  it("defers instead of throwing when the preferred lock-server name is contended", async () => {
    const {runner} = buildRunner({
      backend: new StubLockServerBackend({acquired: false}),
      policy: [{minTier: "driver-native", name: "unit-defer*", preferredTier: "lock-server"}]
    })

    const result = await runner.withAdvisoryLockOrDefer("unit-defer-a", async () => "never")

    expect(result).toEqual({acquired: false, lockName: "unit-defer-a", reason: "contended"})
  })

  it("surfaces a fenced lease as AdvisoryLockLostError", async () => {
    const backend = new StubLockServerBackend({loss: {currentEpoch: 12, epoch: 11}})
    const {runner} = buildRunner({
      backend,
      policy: [{minTier: "driver-native", name: "unit-fence*", preferredTier: "lock-server"}]
    })
    /** @type {unknown} */
    let thrown

    try {
      await runner.withAdvisoryLock("unit-fence-a", async () => "ran anyway")
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AdvisoryLockLostError)
    expect(/** @type {AdvisoryLockLostError} */ (thrown).currentEpoch).toEqual(12)
    expect(backend.released).toEqual(["unit-fence-a"])
  })

  it("keeps undeclared names on the driver tier", async () => {
    const events = []
    const {configuration, runner} = buildRunner({backend: new StubLockServerBackend(), events, policy: []})

    await runner.withAdvisoryLock("undeclared-name", async () => "ok")

    expect(events).toEqual(["driver acquire undeclared-name", "driver release undeclared-name"])
    expect(configuration.errorEvents.events).toEqual([])
  })
})
