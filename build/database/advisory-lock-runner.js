// @ts-check

import timeout, {TimeoutError} from "awaitery/build/timeout.js"
import {DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS} from "./advisory-lock-bound.js"
import {
  AdvisoryLockBackendUnavailableError,
  resolveAdvisoryLockBackendPolicy,
  refuseAdvisoryLockTierBelowMinimum
} from "./advisory-lock-backend-policy.js"
import {
  AdvisoryLockLostError,
  AdvisoryLockServiceUnavailableError,
  advisoryLockBackendUnavailable
} from "./advisory-lock-errors.js"
import {emitAdvisoryLockFallbackReport} from "./advisory-lock-telemetry.js"

/**
 * Provenance of one advisory-lock acquisition (STC-210 design §3): every
 * held lock reports the tier that actually served it, so a fallback is
 * visible to the callback, in logs, and in `getAdvisoryLockBackendStatus()`.
 * @typedef {object} AdvisoryLockBackendProvenance
 * @property {import("./advisory-lock-backend-policy.js").AdvisoryLockTier} backend - Tier that served the acquisition.
 * @property {string} [driverType] - Database driver type when the driver tier served it.
 * @property {number} [epoch] - Fencing epoch when the serving tier issues one.
 * @property {boolean} fencingSupported - Whether this tier carries fencing tokens (design §8); the file tier reports false rather than pretending.
 * @property {string} [holderId] - Backend holder id for the file tier.
 * @property {string} [lockName] - Lock name this provenance belongs to.
 */

/**
 * Thrown when an advisory lock could not be acquired before `timeoutMs` elapsed.
 */
class AdvisoryLockTimeoutError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name that timed out.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockTimeoutError"
    this.lockName = name
  }
}

/**
 * Thrown when `withAdvisoryLockOrFail` finds the lock already held.
 */
class AdvisoryLockBusyError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name that was already held.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockBusyError"
    this.lockName = name
  }
}

/**
 * Thrown when a callback holds an advisory lock longer than `holdTimeoutMs`.
 */
class AdvisoryLockHoldTimeoutError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name whose hold timed out.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockHoldTimeoutError"
    this.lockName = name
  }
}

/**
 * Runs advisory locks on the caller connection by default, using a dedicated
 * lock connection when `dedicatedConnection` is requested or when a positive
 * hold timeout needs separate ownership.
 */
export default class AdvisoryLockRunner {
  /**
   * Creates an advisory-lock runner for one model database identifier.
   * @param {{configuration: import("../configuration.js").default, connectionProvider: () => import("./drivers/base.js").default, databaseIdentifier: string}} args - Runner dependencies.
   */
  constructor({configuration, connectionProvider, databaseIdentifier}) {
    this.configuration = configuration
    this.connectionProvider = connectionProvider
    this.databaseIdentifier = databaseIdentifier
  }

  /**
   * Runs a callback after acquiring the advisory lock, waiting up to `timeoutMs`.
   * When `dedicatedConnection` is true the lock is acquired on a spawned
   * connection that is released after the callback finishes, while the callback
   * itself still runs against the caller/model connection. When a `holdTimeoutMs`
   * is set the callback receives a `TimeoutControl` from awaitery for cooperative
   * cancellation (`control.check()`, `control.signal`, `control.timedOut`,
   * `control.remaining()`); a dedicated connection is also used so timeout
   * cleanup can release the lock even if callback database work is stuck.
   * @template T
   * @param {string} name - Lock name.
   * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback to invoke while the lock is held.
   * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Lock and hold timeout options.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withAdvisoryLock(name, callback, args = {}) {
    const lockServerResult = await this.attemptLockServer({args, callback, mode: "wait", name})

    // The wait mode never returns a deferred outcome, so the value member is present.
    if (lockServerResult) return /** @type {{value: T}} */ (lockServerResult).value

    const fileBackend = await this.fileBackendForName(name)

    if (fileBackend) {
      const acquired = await fileBackend.acquire(name, {timeoutMs: this.acquireTimeoutMs(args)})

      if (!acquired) {
        throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)} on the file tier`, {name})
      }

      const lockBackend = this.fileProvenance(fileBackend, name)

      this.configuration.recordAdvisoryLockAcquisition({backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name})

      return await this.runLockedCallback({callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await fileBackend.release(name)})
    }

    return await this.withLockConnection(args, async (connection) => {
      const lockBackend = this.driverProvenance(connection)

      this.assertDriverTierEligible(name, lockBackend)

      const acquired = await connection.acquireAdvisoryLock(name, args)

      if (!acquired) {
        throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)}`, {name})
      }

      this.configuration.recordAdvisoryLockAcquisition({backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name})

      return await this.runLockedCallback({callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await connection.releaseAdvisoryLock(name)})
    })
  }

  /**
   * Runs a callback only if the advisory lock can be acquired immediately.
   * When `dedicatedConnection` is true the lock is acquired on a spawned
   * connection that is released after the callback finishes, while the callback
   * itself still runs against the caller/model connection. When a `holdTimeoutMs`
   * is set the callback receives a `TimeoutControl` from awaitery for cooperative
   * cancellation.
   * @template T
   * @param {string} name - Lock name.
   * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback to invoke while the lock is held.
   * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Hold timeout options.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withAdvisoryLockOrFail(name, callback, args = {}) {
    const lockServerResult = await this.attemptLockServer({args, callback, mode: "or-fail", name})

    // The or-fail mode throws on contention, so the value member is present.
    if (lockServerResult) return /** @type {{value: T}} */ (lockServerResult).value

    const fileBackend = await this.fileBackendForName(name)

    if (fileBackend) {
      const acquired = await fileBackend.tryAcquire(name)

      if (!acquired) {
        throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held on the file tier`, {name})
      }

      const lockBackend = this.fileProvenance(fileBackend, name)

      this.configuration.recordAdvisoryLockAcquisition({backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name})

      return await this.runLockedCallback({callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await fileBackend.release(name)})
    }

    return await this.withLockConnection(args, async (connection) => {
      const lockBackend = this.driverProvenance(connection)

      this.assertDriverTierEligible(name, lockBackend)

      const acquired = await connection.tryAcquireAdvisoryLock(name)

      if (!acquired) {
        throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held`, {name})
      }

      this.configuration.recordAdvisoryLockAcquisition({backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name})

      return await this.runLockedCallback({callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await connection.releaseAdvisoryLock(name)})
    })
  }

  /**
  /**
   * Runs a callback if the advisory lock can be acquired without waiting;
   * otherwise returns a `{acquired: false}` defer result instead of throwing.
   *
   * This is the non-throwing counterpart of `withAdvisoryLockOrFail` for hot
   * paths: "holder busy, defer me" is a first-class outcome, so a contended
   * lock produces zero exception traffic and — because the probe is a single
   * immediate try-acquire — zero pinned connections. Callers reschedule via
   * their own event-driven retry machinery. The result form is identical
   * across tiers: the driver's `tryAcquireAdvisoryLock` maps per-tier (MySQL
   * `GET_LOCK(name, 0)`, PostgreSQL `pg_try_advisory_lock`, SQL Server
   * `sp_getapplock @LockTimeout = 0`, SQLite process-local queue, SQLite Node
   * file lock), so a caller never branches on the backend.
   * @template T
   * @param {string} name - Lock name.
   * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback to invoke while the lock is held.
   * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Hold timeout options.
   * @returns {Promise<{acquired: true, result: T} | {acquired: false, reason: "contended", lockName: string}>} - Either the held-callback result or the defer outcome.
   */
  async withAdvisoryLockOrDefer(name, callback, args = {}) {
    const lockServerResult = await this.attemptLockServer({args, callback, mode: "defer", name})

    if (lockServerResult) {
      if ("deferred" in lockServerResult) return lockServerResult.deferred

      return {acquired: true, result: /** @type {{value: T}} */ (lockServerResult).value}
    }

    const fileBackend = await this.fileBackendForName(name)

    if (fileBackend) {
      const acquired = await fileBackend.acquire(name, {timeoutMs: 0})

      if (!acquired) return {acquired: false, reason: "contended", lockName: name}

      const lockBackend = this.fileProvenance(fileBackend, name)

      this.configuration.recordAdvisoryLockAcquisition({backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name})

      const result = await this.runLockedCallback({callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await fileBackend.release(name)})

      return {acquired: true, result}
    }

    return await this.withLockConnection(args, async (connection) => {
      const acquired = await connection.tryAcquireAdvisoryLock(name)

      if (!acquired) return {acquired: false, reason: "contended", lockName: name}

      const lockBackend = this.driverProvenance(connection)

      this.assertDriverTierEligible(name, lockBackend)

      this.configuration.recordAdvisoryLockAcquisition({backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name})

      const result = await this.runLockedCallback({callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await connection.releaseAdvisoryLock(name)})

      return {acquired: true, result}
    })
  }

  /**
   * Runs the lock holder callback and releases the lock from its owning backend.
   * @template T
   * @param {{callback: (args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>, holdTimeoutMs?: number | null, lockBackend: AdvisoryLockBackendProvenance, name: string, release: () => Promise<unknown>}} args - Locked callback args.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async runLockedCallback({callback, holdTimeoutMs, lockBackend, name, release}) {
    try {
      return await AdvisoryLockRunner.runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs, lockBackend)
    } finally {
      await release()
    }
  }

  /**
   * Serves one acquisition on the lock-server tier when the lock name prefers
   * it (design §1/§9), falling *upward* to the driver path when the server is
   * unreachable and the name's minimum tier permits a DB-native hold.
   *
   * `null` means "this tier did not serve the acquisition — continue with the
   * next eligible tier". A returned value means the lock-server tier answered,
   * including a definitive busy/timeout outcome.
   * @template T
   * @param {{args: {holdTimeoutMs?: number | null, timeoutMs?: number | null}, callback: (args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>, mode: "wait" | "or-fail" | "defer", name: string}} request - Acquisition request.
   * @returns {Promise<{deferred: {acquired: false, reason: "contended", lockName: string}} | {value: T} | null>} - Result when this tier served it, otherwise null.
   */
  async attemptLockServer({args, callback, mode, name}) {
    const policy = resolveAdvisoryLockBackendPolicy(name, this.configuration.getAdvisoryLockPolicy())

    if (policy.preferredTier !== "lock-server") return null
    if (!policy.allowedTiers.includes("lock-server")) return null

    const backend = await this.configuration.getAdvisoryLockLockServerBackend()

    if (!backend) {
      this.reportAdvisoryLockFallback({reason: "lock-server tier is not enabled in configuration", servedBy: "driver-native", lockName: name})

      return null
    }

    /** @type {boolean} */
    let acquired

    try {
      if (mode === "wait") {
        acquired = await backend.acquire(name, {timeoutMs: this.acquireTimeoutMs(args)})
      } else {
        acquired = await backend.tryAcquire(name)
      }
    } catch (error) {
      if (!(error instanceof AdvisoryLockServiceUnavailableError)) throw error

      if (policy.minTier === "lock-server") {
        throw advisoryLockBackendUnavailable({
          lockName: name,
          minTier: policy.minTier,
          reasons: [`lock-server unavailable: ${error.message}`]
        })
      }

      this.reportAdvisoryLockFallback({reason: error.message, servedBy: "driver-native", lockName: name})

      return null
    }

    if (!acquired) {
      if (mode === "defer") return {deferred: {acquired: false, reason: "contended", lockName: name}}
      if (mode === "or-fail") throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held`, {name})

      throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)}`, {name})
    }

    const epoch = backend.getHoldEpoch(name)
    const lockBackend = /** @type {AdvisoryLockBackendProvenance} */ ({
      backend: "lock-server",
      epoch: epoch ?? undefined,
      fencingSupported: true,
      lockName: name
    })

    this.configuration.recordAdvisoryLockAcquisition({backend: "lock-server", fencingSupported: true, lockName: name})

        const value = await this.runLockServerHold({
      backend,
      callback,
      holdTimeoutMs: args.holdTimeoutMs,
      lockBackend,
      name
    })

    return {value}
  }

  /**
   * Runs the critical section under a lock-server lease and surfaces a fenced
   * lease as `AdvisoryLockLostError` (design §8): the section may have
   * overlapped another holder, so its outcome must not be trusted as exclusive.
   * @template T
   * @param {{backend: import("./advisory-lock-lock-server-backend.js").default, callback: (args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>, holdTimeoutMs?: number | null, lockBackend: AdvisoryLockBackendProvenance, name: string}} args - Hold request.
   * @returns {Promise<T>} - Callback result.
   */
  async runLockServerHold({backend, callback, holdTimeoutMs, lockBackend, name}) {
    /** @type {T | undefined} */
    let value
    /** @type {unknown} */
    let callbackError
    let failed = false

    try {
      value = await this.runLockedCallback({
        callback,
        holdTimeoutMs,
        lockBackend,
        name,
        release: async () => await backend.release(name)
      })
    } catch (error) {
      failed = true
      callbackError = error
    }

    const loss = backend.takeLoss(name, lockBackend.epoch ?? null)

    if (loss) {
      throw new AdvisoryLockLostError(
        `Lost the lease for advisory lock ${JSON.stringify(name)} while the critical section was running`,
        {
          cause: callbackError instanceof Error ? callbackError : undefined,
          currentEpoch: loss.currentEpoch,
          epoch: lockBackend.epoch ?? null,
          lockName: name
        }
      )
    }

    if (failed) throw callbackError

    return /** @type {T} */ (value)
  }

  /**
   * Reports an acquisition served below the lock name's preferred tier
   * (design §3): every fallback is visible on the framework-error channel, so a
   * silent downgrade is impossible.
   * @param {{lockName: string, reason: string, servedBy: import("./advisory-lock-backend-policy.js").AdvisoryLockTier}} args - Fallback details.
   * @returns {void}
   */
  reportAdvisoryLockFallback({lockName, reason, servedBy}) {
    const policy = resolveAdvisoryLockBackendPolicy(lockName, this.configuration.getAdvisoryLockPolicy())
    emitAdvisoryLockFallbackReport(this.configuration, {
      lockName,
      preferredTier: policy.preferredTier,
      reason,
      servedBy
    })
  }

  /**
   * Resolves the backend policy for one lock name and returns the file
   * backend when the name explicitly opts into the file tier
   * (`preferredTier: "file"` plus `advisoryLocks.backends.file.enabled: true`).
   * A name whose declared minimum tier is cross-host is refused loudly
   * (`AdvisoryLockMinTierRefusedError`) before any contact with the file
   * tier. A name that prefers the file tier while the backend is disabled
   * moves to the driver path (a stronger-or-equal tier), never the other way
   * around. Nothing here ever auto-enables the file tier.
   * @param {string} name - Lock name.
   * @returns {Promise<import("./advisory-lock-file-backend.js").default | null>} - Resolves with the file backend serving this name, or null for the driver path.
   */
  async fileBackendForName(name) {
    const policy = resolveAdvisoryLockBackendPolicy(name, this.configuration.getAdvisoryLockPolicy())

    if (policy.preferredTier !== "file") return null

    if (!advisoryLockPolicyAllowsFileTier(policy)) {
      refuseAdvisoryLockTierBelowMinimum({
        configuration: this.configuration,
        lockName: name,
        minTier: policy.minTier,
        requestedBackend: "file"
      })
    }

    const backend = await this.configuration.getAdvisoryLockFileBackend()

    if (!backend) {
      // Preferred tier unavailable: fail *upward* to the driver path (a
      // stronger-or-equal tier), never downward. If the driver cannot satisfy
      // the minimum either, `assertDriverTierEligible` throws
      // `AdvisoryLockBackendUnavailableError` on the driver path.
      return null
    }

    return backend
  }

  /**
   * Fail-closed check on the driver path (design §9): an undeclared lock name
   * keeps today's behavior (any driver serves it — full backward
   * compatibility), but a name with an explicit policy entry is refused with
   * `AdvisoryLockBackendUnavailableError` when the configured driver cannot
   * satisfy its minimum tier (e.g. `minTier: "driver-native"` on a SQLite
   * driver, which has no native advisory-lock primitive).
   * @param {string} name - Lock name.
   * @param {AdvisoryLockBackendProvenance} lockBackend - Tier the driver path would serve with.
   * @returns {void}
   */
  assertDriverTierEligible(name, lockBackend) {
    const policy = resolveAdvisoryLockBackendPolicy(name, this.configuration.getAdvisoryLockPolicy())

    if (!policy.entry) return

    const tier = lockBackend.backend

    if (tier === "process-local" && !policy.allowedTiers.includes("process-local")) {
      throw new AdvisoryLockBackendUnavailableError(
        `Advisory lock ${JSON.stringify(name)} requires minimum tier ${JSON.stringify(policy.minTier)} but the configured driver (${String(lockBackend.driverType)}) only offers the process-local tier`,
        {lockName: name, minTier: policy.minTier, reasons: [`driver tier ${tier} below minTier ${policy.minTier}`]}
      )
    }
  }

  /**
   * Resolves the wait bound for a file-tier acquisition: an explicit caller
   * `timeoutMs` (including an explicit `null` opt-out) wins, otherwise the
   * same framework default that bounds driver acquisitions applies.
   * @param {{timeoutMs?: number | null}} args - Lock options.
   * @returns {number | null} - Wait bound in milliseconds, or `null` for an indefinite wait.
   */
  acquireTimeoutMs(args) {
    if (args.timeoutMs !== undefined) return args.timeoutMs

    return DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS
  }

  /**
   * Builds the acquisition provenance for a file-tier hold. The file tier
   * cannot carry fencing tokens, so the limitation is reported on every
   * acquisition rather than silently pretended away (design §8).
   * @param {import("./advisory-lock-file-backend.js").default} backend - Backend that served the acquisition.
   * @param {string} name - Lock name.
   * @returns {AdvisoryLockBackendProvenance} - Acquisition provenance.
   */
  fileProvenance(backend, name) {
    return {backend: "file", fencingSupported: false, holderId: backend.holderId, lockName: name}
  }

  /**
   * Builds the acquisition provenance for a driver-served hold. SQLite has no
   * native advisory-lock primitive, so its emulation tier is reported as
   * `process-local` rather than pretending to be database-native.
   * @param {import("./drivers/base.js").default} connection - Connection that served the acquisition.
   * @returns {AdvisoryLockBackendProvenance} - Acquisition provenance.
   */
  driverProvenance(connection) {
    let driverType = null

    try {
      driverType = connection.getType()
    } catch {
      // Test stub drivers may not implement getType(); the tier alone identifies the backend.
    }

    const tier = typeof connection.advisoryLockBackendTier === "function"
      ? connection.advisoryLockBackendTier()
      : (driverType === "sqlite" ? "process-local" : "driver-native")

    return {
      backend: /** @type {import("./advisory-lock-backend-policy.js").AdvisoryLockTier} */ (tier),
      driverType: driverType ?? undefined,
      fencingSupported: tier === "driver-native"
    }
  }

  /**
   * Runs lock work on the caller connection unless `dedicatedConnection` is
   * requested or a positive hold timeout needs its own lock connection.
   * @template T
   * @param {{dedicatedConnection?: boolean, holdTimeoutMs?: number | null}} args - Lock connection options.
   * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback receiving the connection that owns the advisory lock.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withLockConnection(args, callback) {
    const holdTimeoutMs = args.holdTimeoutMs

    if (args.dedicatedConnection || (holdTimeoutMs && holdTimeoutMs > 0)) {
      return await this.withDedicatedConnection(callback)
    }

    return await callback(this.connectionProvider())
  }

  /**
   * Spawns a dedicated lock connection and closes it after lock work completes
   * when the spawned driver owns the underlying physical connection.
   * @template T
   * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback that receives the dedicated lock connection.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withDedicatedConnection(callback) {
    const connection = await this.configuration.getDatabasePool(this.databaseIdentifier).spawnConnection()

    // The spawned driver owns its physical connection unless it borrows a shared one
    // via `getConnection`. An owned connection lives outside the pools' tracked sets,
    // so register it while the lock is held: a shutdown then closes it (releasing the
    // lock) instead of orphaning a half-open session until the DB `wait_timeout`.
    const ownsConnection = !connection.getArgs().getConnection

    if (ownsConnection) this.configuration.registerAdvisoryLockConnection(connection)

    try {
      return await callback(connection)
    } finally {
      if (ownsConnection) {
        this.configuration.unregisterAdvisoryLockConnection(connection)
        await connection.close()
      } else {
        await connection.releaseHeldAdvisoryLocks()
      }
    }
  }

  /**
   * Runs `callback`, rejecting with `AdvisoryLockHoldTimeoutError` if it has
   * not settled within `holdTimeoutMs`. The callback is not cancelled; callers
   * use a dedicated advisory-lock connection so the lock can still be released.
   *
   * The callback receives a `TimeoutControl` from awaitery, enabling cooperative
   * cancellation via `control.check()`, `control.signal`, `control.timedOut`,
   * and `control.remaining()`, plus `lockBackend` provenance for the tier that
   * served the acquisition.
   * @template T
   * @param {string} name - Lock name (for the error message).
   * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback holding the lock.
   * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
   * @param {AdvisoryLockBackendProvenance} [lockBackend] - Provenance of the acquisition serving this hold.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  static async runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs, lockBackend) {
    if (!holdTimeoutMs || holdTimeoutMs <= 0) {
      return await callback({lockBackend: lockBackend ?? AdvisoryLockRunner.unknownBackendProvenance()})
    }

    let callbackSettled = false

    try {
      return await timeout({timeout: holdTimeoutMs}, async ({control}) => {
        try {
          return await callback({control, lockBackend: lockBackend ?? AdvisoryLockRunner.unknownBackendProvenance()})
        } finally {
          callbackSettled = true
        }
      })
    } catch (error) {
      if (!callbackSettled || error instanceof TimeoutError) {
        throw new AdvisoryLockHoldTimeoutError(`Advisory lock ${JSON.stringify(name)} held longer than ${holdTimeoutMs}ms`, {name})
      }

      throw error
    }
  }

  /**
   * Neutral provenance for direct `runWithAdvisoryLockHoldTimeout` callers that
   * hold a lock acquired outside this runner.
   * @returns {AdvisoryLockBackendProvenance} - Provenance with an unknown tier.
   */
  static unknownBackendProvenance() {
    return {backend: "process-local", fencingSupported: false}
  }
}

/**
 * Runs advisory lock policy allows file tier.
 * @param {import("./advisory-lock-backend-policy.js").ResolvedAdvisoryLockBackendPolicy} policy - Resolved policy.
 * @returns {boolean} - Whether the file tier may serve this name.
 */
function advisoryLockPolicyAllowsFileTier(policy) {
  return policy.allowedTiers.includes("file")
}

export {AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError}
export {AdvisoryLockBackendUnavailableError, AdvisoryLockMinTierRefusedError} from "./advisory-lock-backend-policy.js"
export {AdvisoryLockLostError, AdvisoryLockServiceUnavailableError} from "./advisory-lock-errors.js"
