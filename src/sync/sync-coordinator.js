// @ts-check

import restArgsError from "../utils/rest-args-error.js"

const COORDINATOR_STATES = new Set(["backoff", "conflicted", "failed", "idle", "offline", "pending", "stopped", "syncing"])
const DEFAULT_RETRY = Object.freeze({initialDelayMs: 1_000, maxAttempts: 4, maxDelayMs: 30_000})

/** Expected cooperative cancellation raised by a SyncCoordinator lifecycle transition. */
export class SyncCoordinatorLifecycleAbortError extends Error {
  /**
   * Creates a lifecycle cancellation error.
   * @param {string} message - Cancellation reason.
   */
  constructor(message) {
    super(message)
    this.name = "SyncCoordinatorLifecycleAbortError"
  }
}

/**
 * Reusable observable lifecycle around SyncClient. It serializes replay,
 * realtime subscription, and stable-cursor pull into one cycle; coalesces any
 * triggers received during that cycle into one rerun; owns bounded retry; and
 * generation-fences status updates after stop/restart.
 */
export default class SyncCoordinator {
  /**
   * Creates one reusable sync lifecycle owner.
   * @param {object} args - Coordinator dependencies.
   * @param {(error: Error) => {code: string, message?: string, retryable: boolean}} [args.classifyError] - Maps errors to safe retry/display metadata. Defaults to permanent `sync_failed` without persisting the error message.
   * @param {import("./sync-coordinator-types.js").SyncCoordinatorConnectivity} [args.connectivity] - Optional connectivity event source.
   * @param {() => Date} [args.now] - Injected clock.
   * @param {(args: {signal: AbortSignal, syncClient: import("./sync-client.js").default}) => Promise<(() => Promise<void> | void) | void> | (() => Promise<void> | void) | void} [args.prepare] - Activates scopes/acquires app-owned resources before the first cycle and returns their teardown.
   * @param {boolean} [args.realtime] - Whether cycles subscribe realtime before pulling. Defaults to true.
   * @param {{initialDelayMs?: number, maxAttempts?: number, maxDelayMs?: number}} [args.retry] - Bounded automatic retry policy.
   * @param {import("./sync-coordinator-types.js").SyncCoordinatorScheduler} [args.scheduler] - Injected timer owner.
   * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatusStore} [args.statusStore] - Optional privacy-safe durable status store.
   * @param {import("./sync-client.js").default} args.syncClient - SyncClient owning queue, scopes, cursors, apply, and realtime.
   */
  constructor({classifyError = defaultErrorClassification, connectivity, now = () => new Date(), prepare = () => undefined, realtime = true, retry = {}, scheduler = defaultScheduler(), statusStore, syncClient, ...restArgs}) {
    restArgsError(restArgs)
    requireCoordinatorClient(syncClient)
    requireFunction(classifyError, "classifyError")
    requireFunction(now, "now")
    requireFunction(prepare, "prepare")
    if (typeof realtime !== "boolean") throw new Error("SyncCoordinator realtime must be boolean")
    if (connectivity) requireFunction(connectivity.subscribe, "connectivity.subscribe")
    if (statusStore) {
      requireFunction(statusStore.load, "statusStore.load")
      requireFunction(statusStore.save, "statusStore.save")
    }
    requireFunction(scheduler.clearTimeout, "scheduler.clearTimeout")
    requireFunction(scheduler.setTimeout, "scheduler.setTimeout")

    this.syncClient = syncClient
    this.classifyError = classifyError
    this.connectivity = connectivity || null
    this.now = now
    this.prepare = prepare
    this.realtime = realtime
    this.retryPolicy = normalizeRetryPolicy(retry)
    this.scheduler = scheduler
    this.statusStore = statusStore || null

    this._active = false
    this._attempt = 0
    this._generation = 0
    this._lifecycleAbortController = new AbortController()
    /** @type {Set<(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void>} */
    this._listeners = new Set()
    /** @type {Array<() => Promise<void> | void>} */
    this._lifecycleCleanups = []
    /** @type {Promise<void> | null} */
    this._runPromise = null
    this._rerunRequested = false
    /** @type {unknown} */
    this._retryTimer = null
    /** @type {Promise<void> | null} */
    this._startPromise = null
    /** @type {Promise<void> | null} */
    this._stopPromise = null
    /** @type {import("./sync-coordinator-types.js").SyncCoordinatorStatus} */
    this._status = immutableStatus({
      conflicts: [],
      failure: null,
      lastSuccessAt: null,
      nextRetryAt: null,
      pendingCount: 0,
      rejectedCount: 0,
      state: "stopped"
    })
  }

  /**
   * Installs local ownership and schedules the initial network cycle without
   * awaiting it, so cached reads never depend on network completion.
   * @returns {Promise<void>} - Resolves after local ownership is installed.
   */
  start() {
    if (this._active && !this._startPromise) return Promise.resolve()
    if (this._startPromise) return this._startPromise
    if (this._stopPromise) return this._stopPromise.then(async () => await this.start())

    this._active = true
    this._attempt = 0
    const generation = ++this._generation

    this._lifecycleAbortController = new AbortController()
    this._startPromise = this._start(generation).finally(() => {
      this._startPromise = null
    })

    return this._startPromise
  }

  /**
   * Starts one lifecycle generation with rollback on failure.
   * @param {number} generation - Owning generation.
   * @returns {Promise<void>} - Resolves after activation completes.
   */
  async _start(generation) {
    try {
      await this._activate(generation)
    } catch (error) {
      if (this.isLifecycleAbort(error) || !this._ownsGeneration(generation)) throw error

      await this._rollbackFailedStart(/** @type {Error} */ (error), generation)
    }
  }

  /**
   * Acquires coordinator, connectivity, client, and application resources.
   * @param {number} generation - Owning generation.
   * @returns {Promise<void>} - Resolves after every owner is active.
   */
  async _activate(generation) {
    if (this.statusStore) {
      const persistedStatus = await this.statusStore.load()

      this._assertActive(generation)
      if (persistedStatus) this._publish(restoredStatus(persistedStatus))
    }

    const detachCoordinator = this.syncClient.attachCoordinator(async (reason) => await this.trigger(reason))

    this._lifecycleCleanups.push(detachCoordinator)

    if (this.connectivity) {
      const unsubscribeConnectivity = this.connectivity.subscribe((online) => this._connectivityChanged({generation, online}))

      this._lifecycleCleanups.push(unsubscribeConnectivity)
    }

    this._assertActive(generation)
    await this.syncClient.start()
    this._assertActive(generation)

    const release = await this.prepare({signal: this._lifecycleAbortController.signal, syncClient: this.syncClient})

    if (release !== undefined) requireFunction(release, "prepare teardown")
    if (!this._ownsGeneration(generation)) {
      if (release) await release()
      throw new SyncCoordinatorLifecycleAbortError("Sync coordinator stopped during preparation")
    }
    if (release) this._lifecycleCleanups.push(release)

    this._rerunRequested = true
    void this._startRequestedRun()
  }

  /**
   * Releases every partially acquired owner after a failed start, publishes a
   * safe terminal failure, and rethrows the original error (or an aggregate if
   * teardown also failed).
   * @param {Error} error - Start failure.
   * @param {number} generation - Failed generation.
   * @returns {Promise<never>} - Always rejects with the start or aggregate error.
   */
  async _rollbackFailedStart(error, generation) {
    this._active = false
    this._generation += 1
    this._lifecycleAbortController.abort(new SyncCoordinatorLifecycleAbortError("Sync coordinator start failed"))
    this._rerunRequested = false
    this._clearRetryTimer()

    /** @type {unknown[]} */
    const teardownErrors = []
    const cleanups = this._lifecycleCleanups.splice(0).reverse()

    try {
      await this.syncClient.stop()
    } catch (stopError) {
      teardownErrors.push(stopError)
    }

    for (const cleanup of cleanups) {
      try {
        await cleanup()
      } catch (cleanupError) {
        teardownErrors.push(cleanupError)
      }
    }

    const classified = normalizeErrorClassification(this.classifyError(error))
    const failure = {
      attempt: 1,
      at: this._nowIso(),
      code: classified.code,
      ...(classified.message === undefined ? {} : {message: classified.message}),
      retryable: classified.retryable
    }

    this._attempt = 1
    this._publish({...this._status, failure, nextRetryAt: null, state: "failed"})

    if (this.statusStore) {
      try {
        await this.statusStore.save(this._status)
      } catch (persistenceError) {
        teardownErrors.push(persistenceError)
      }
    }

    if (teardownErrors.length > 0) throw new AggregateError([error, ...teardownErrors], `Sync coordinator generation ${generation} failed to start and tear down cleanly`)

    throw error
  }

  /**
   * Stops current work, clears timers/listeners, drains SyncClient, and releases
   * app-owned resources exactly once.
   * @returns {Promise<void>} - Resolves after the lifecycle is fully stopped.
   */
  stop() {
    if (this._stopPromise) return this._stopPromise
    if (!this._active && !this._startPromise && !this._runPromise) {
      if (this._status.state !== "stopped") this._publish({...this._status, nextRetryAt: null, state: "stopped"})

      return Promise.resolve()
    }

    this._active = false
    this._generation += 1
    this._lifecycleAbortController.abort(new SyncCoordinatorLifecycleAbortError("Sync coordinator was stopped"))
    this._rerunRequested = false
    this._clearRetryTimer()

    const cleanups = this._lifecycleCleanups.splice(0).reverse()
    const startPromise = this._startPromise
    const runPromise = this._runPromise

    this._stopPromise = this._stop({cleanups, runPromise, startPromise}).finally(() => {
      this._stopPromise = null
    })

    return this._stopPromise
  }

  /**
   * Drains captured lifecycle resources after a stop transition.
   * @param {{cleanups: Array<() => Promise<void> | void>, runPromise: Promise<void> | null, startPromise: Promise<void> | null}} args - Captured generation resources.
   * @returns {Promise<void>} - Resolves after teardown completes.
   */
  async _stop({cleanups, runPromise, startPromise}) {
    /** @type {unknown[]} */
    const errors = []

    try {
      await this.syncClient.stop()
    } catch (error) {
      errors.push(error)
    }

    for (const promise of [startPromise, runPromise]) {
      if (!promise) continue

      try {
        await promise
      } catch (error) {
        if (!this.isLifecycleAbort(error)) errors.push(error)
      }
    }

    for (const cleanup of cleanups) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }

    this._attempt = 0
    this._publish({...this._status, failure: null, nextRetryAt: null, state: "stopped"})

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Sync coordinator teardown failed")
  }

  /**
   * Requests a cycle. Overlapping requests share the active flight and produce
   * at most one queued rerun.
   * @param {string} [reason] - Diagnostic trigger label (never persisted).
   * @returns {Promise<void>} - Resolves after the current or queued cycle drains.
   */
  trigger(reason = "manual") {
    void reason
    if (!this._active) return Promise.resolve()

    this._rerunRequested = true
    if (this._startPromise) {
      return this._startPromise.then(
        async () => await this._startRequestedRun(),
        () => undefined
      )
    }

    return this._startRequestedRun()
  }

  /**
   * Starts requested work only after lifecycle preparation has completed.
   * @returns {Promise<void>} - Current or newly started coordinator flight.
   */
  _startRequestedRun() {
    if (!this._active) return Promise.resolve()
    if (this._retryTimer !== null) return this._runPromise || Promise.resolve()
    if (!this._runPromise) {
      const generation = this._generation

      this._runPromise = this._drain(generation).finally(() => {
        this._runPromise = null
      })
    }

    return this._runPromise
  }

  /**
   * Clears backoff and requests one single-flight user retry.
   * @returns {Promise<void>} - Resolves after the retry cycle drains.
   */
  retry() {
    if (!this._active) throw new Error("Cannot retry a stopped SyncCoordinator")

    this._clearRetryTimer()
    this._attempt = 0

    return this.trigger("manual-retry")
  }

  /**
   * Resolves one durable conflict through SyncClient, then refreshes status and
   * replays retry-local intent through the same cycle.
   * @param {{recordId: string, resolution: "keep-server" | "retry-local", resourceType: string}} args - Explicit resolution.
   * @returns {Promise<void>} - Resolves after resolution state is refreshed.
   */
  async resolveConflict(args) {
    if (!this._active) throw new Error("Cannot resolve a conflict on a stopped SyncCoordinator")

    await this.syncClient.resolveConflict(args)
    this._clearRetryTimer()
    this._attempt = 0
    if (args.resolution === "retry-local") {
      await this.syncClient.waitForScheduledReplay()
    } else {
      await this.trigger("conflict-resolution")
    }
  }

  /**
   * Drains requested work serially for one lifecycle generation.
   * @param {number} generation - Owning generation.
   * @returns {Promise<void>} - Resolves when no immediate rerun remains.
   */
  async _drain(generation) {
    while (this._rerunRequested && this._ownsGeneration(generation)) {
      this._rerunRequested = false
      const completed = await this._runCycle(generation)

      if (!completed) this._rerunRequested = false
    }
  }

  /**
   * Runs one replay, realtime-subscribe, and pull cycle.
   * @param {number} generation - Owning generation.
   * @returns {Promise<boolean>} - Whether an immediate queued rerun may proceed.
   */
  async _runCycle(generation) {
    try {
      const online = await this.syncClient.isOnline()

      this._assertActive(generation)
      if (!online) {
        const inspection = await this.syncClient.inspectSyncState()

        this._assertActive(generation)
        this._publish({...this._status, ...inspection, failure: null, nextRetryAt: null, state: "offline"})
        await this._persistStatus(generation)

        return false
      }

      this._publish({...this._status, nextRetryAt: null, state: "syncing"})
      await this.syncClient.replayPending()
      this._assertActive(generation)
      if (this.realtime) {
        await this.syncClient.subscribeRealtime()
        this._assertActive(generation)
      }
      await this.syncClient.pull()
      this._assertActive(generation)

      const inspection = await this.syncClient.inspectSyncState()

      this._assertActive(generation)
      this._publish({
        ...this._status,
        ...inspection,
        failure: null,
        lastSuccessAt: this._nowIso(),
        nextRetryAt: null,
        state: inspectionState(inspection)
      })
      await this._persistStatus(generation)
      this._attempt = 0

      return true
    } catch (error) {
      if (!this._ownsGeneration(generation) || this.isLifecycleAbort(error) || this.syncClient.isLifecycleAbort(error)) return false

      await this._handleFailure(/** @type {Error} */ (error), generation)

      return false
    }
  }

  /**
   * Publishes a classified failure and owns its bounded retry timer.
   * @param {Error} error - Cycle failure.
   * @param {number} generation - Owning generation.
   * @returns {Promise<void>} - Resolves after status persistence and scheduling.
   */
  async _handleFailure(error, generation) {
    this._attempt += 1
    let classified = normalizeErrorClassification(this.classifyError(error))
    const failedAt = this._nowIso()
    let failureStatus = failureStatusFor({attempt: this._attempt, classified, failedAt, retryPolicy: this.retryPolicy, status: this._status})

    this._publish(failureStatus.status)

    if (this.statusStore) {
      try {
        await this.statusStore.save(this._status)
        this._assertActive(generation)
      } catch (persistenceError) {
        this._assertActive(generation)
        classified = normalizeErrorClassification(this.classifyError(/** @type {Error} */ (persistenceError)))
        failureStatus = failureStatusFor({attempt: this._attempt, classified, failedAt, retryPolicy: this.retryPolicy, status: this._status})
        this._publish(failureStatus.status)
      }
    }

    if (failureStatus.delayMs !== null) {
      this._assertActive(generation)
      this._retryTimer = this.scheduler.setTimeout(() => {
        this._retryTimer = null
        if (!this._ownsGeneration(generation)) return

        void this.trigger("automatic-retry")
      }, failureStatus.delayMs)
    }

    this.syncClient.reportError(error)
  }

  /**
   * Persists the current safe status for an active generation.
   * @param {number} generation - Owning generation.
   * @returns {Promise<void>} - Resolves after persistence.
   */
  async _persistStatus(generation) {
    if (this.statusStore) await this.statusStore.save(this._status)
    this._assertActive(generation)
  }

  /**
   * Coalesces one connectivity change into the coordinator cycle.
   * @param {{generation: number, online: boolean}} args - Connectivity event.
   * @returns {void}
   */
  _connectivityChanged({generation, online}) {
    if (!this._ownsGeneration(generation)) return

    this._clearRetryTimer()
    if (online) this._attempt = 0
    void this.trigger(online ? "connectivity-online" : "connectivity-offline")
  }

  /**
   * Clears the currently owned retry timer, if present.
   * @returns {void}
   */
  _clearRetryTimer() {
    if (this._retryTimer === null) return

    this.scheduler.clearTimeout(this._retryTimer)
    this._retryTimer = null
  }

  /**
   * Checks whether a lifecycle generation still owns state updates.
   * @param {number} generation - Expected generation.
   * @returns {boolean} - Whether the generation is current and active.
   */
  _ownsGeneration(generation) {
    return this._active && this._generation === generation
  }

  /**
   * Fails when work no longer belongs to the active generation.
   * @param {number} generation - Expected generation.
   * @returns {void}
   */
  _assertActive(generation) {
    if (this._ownsGeneration(generation)) return

    throw new SyncCoordinatorLifecycleAbortError("Sync coordinator work belongs to an inactive generation")
  }

  /**
   * Identifies coordinator-owned cooperative cancellation.
   * @param {unknown} error - Candidate error.
   * @returns {boolean} - Whether this coordinator created the abort error.
   */
  isLifecycleAbort(error) {
    return error instanceof SyncCoordinatorLifecycleAbortError
  }

  /**
   * Reads and validates the injected clock.
   * @returns {string} - Valid ISO clock value.
   */
  _nowIso() {
    const value = this.now()

    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("SyncCoordinator now() must return a valid Date")

    return value.toISOString()
  }

  /**
   * Freezes and publishes a new observable snapshot.
   * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatus} status - New status.
   * @returns {void}
   */
  _publish(status) {
    this._status = immutableStatus(status)

    for (const listener of this._listeners) listener(this._status)
  }

  /**
   * Returns the current observable snapshot.
   * @returns {import("./sync-coordinator-types.js").SyncCoordinatorStatus} - Current immutable snapshot.
   */
  status() {
    return this._status
  }

  /**
   * Observes status and receives the current snapshot immediately.
   * @param {(status: import("./sync-coordinator-types.js").SyncCoordinatorStatus) => void} listener - Observer.
   * @returns {() => void} - Idempotent unsubscribe.
   */
  subscribe(listener) {
    requireFunction(listener, "status listener")
    this._listeners.add(listener)
    listener(this._status)

    return () => this._listeners.delete(listener)
  }

  /**
   * Awaits only the active or queued cycle, not a future backoff timer.
   * @returns {Promise<void>} - Resolves when current work drains.
   */
  async waitForCurrentRun() {
    while (this._runPromise) await this._runPromise
  }
}

/**
 * Builds the default global timer adapter.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorScheduler} - Global timer adapter.
 */
function defaultScheduler() {
  return {
    clearTimeout: (timer) => globalThis.clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
  }
}

/**
 * Validates and fills retry policy defaults.
 * @param {Record<string, number>} retry - Retry overrides.
 * @returns {{initialDelayMs: number, maxAttempts: number, maxDelayMs: number}} - Complete policy.
 */
function normalizeRetryPolicy(retry) {
  const policy = {...DEFAULT_RETRY, ...retry}

  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`SyncCoordinator retry.${name} must be a positive integer`)
  }
  if (policy.maxDelayMs < policy.initialDelayMs) throw new Error("SyncCoordinator retry.maxDelayMs must be greater than or equal to initialDelayMs")

  return policy
}

/**
 * Classifies unknown errors as permanent without exposing their messages.
 * @param {Error} _error - Unclassified error.
 * @returns {{code: string, retryable: boolean}} - Safe default classification.
 */
function defaultErrorClassification(_error) {
  return {code: "sync_failed", retryable: false}
}

/**
 * Validates application-provided safe error metadata.
 * @param {ReturnType<typeof defaultErrorClassification> & {message?: string}} classification - Raw classification.
 * @returns {{code: string, message?: string, retryable: boolean}} - Validated classification.
 */
function normalizeErrorClassification(classification) {
  if (!classification || typeof classification !== "object" || Array.isArray(classification)) throw new Error("SyncCoordinator classifyError must return an object")
  if (typeof classification.code !== "string" || classification.code.length === 0) throw new Error("SyncCoordinator error classification code must be a non-empty string")
  if (typeof classification.retryable !== "boolean") throw new Error("SyncCoordinator error classification retryable must be boolean")
  if (classification.message !== undefined && typeof classification.message !== "string") throw new Error("SyncCoordinator error classification message must be a string")

  return classification
}

/**
 * Builds one failure snapshot and its optional automatic-retry delay.
 * @param {{attempt: number, classified: {code: string, message?: string, retryable: boolean}, failedAt: string, retryPolicy: {initialDelayMs: number, maxAttempts: number, maxDelayMs: number}, status: import("./sync-coordinator-types.js").SyncCoordinatorStatus}} args - Failure state.
 * @returns {{delayMs: number | null, status: import("./sync-coordinator-types.js").SyncCoordinatorStatus}} - Failure snapshot and retry delay.
 */
function failureStatusFor({attempt, classified, failedAt, retryPolicy, status}) {
  const retryable = classified.retryable && attempt < retryPolicy.maxAttempts
  const delayMs = retryable ? Math.min(retryPolicy.initialDelayMs * (2 ** (attempt - 1)), retryPolicy.maxDelayMs) : null
  const failure = {
    attempt,
    at: failedAt,
    code: classified.code,
    ...(classified.message === undefined ? {} : {message: classified.message}),
    retryable: classified.retryable
  }
  const nextRetryAt = delayMs === null ? null : new Date(new Date(failedAt).getTime() + delayMs).toISOString()

  return {
    delayMs,
    status: immutableStatus({...status, failure, nextRetryAt, state: retryable ? "backoff" : "failed"})
  }
}

/**
 * Maps durable queue state to an observable resting state.
 * @param {import("./sync-coordinator-types.js").SyncClientInspection} inspection - Durable inspection.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorState} - Resting state.
 */
function inspectionState(inspection) {
  if (inspection.conflicts.length > 0) return "conflicted"
  if (inspection.rejectedCount > 0) return "failed"
  if (inspection.pendingCount > 0) return "pending"

  return "idle"
}

/**
 * Removes stale in-flight timing from a restored status snapshot.
 * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatus} status - Stored status.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorStatus} - Restored observable status.
 */
function restoredStatus(status) {
  if (!COORDINATOR_STATES.has(status.state)) throw new Error(`Unknown persisted SyncCoordinator state: ${String(status.state)}`)

  return {
    conflicts: status.conflicts,
    failure: status.failure,
    lastSuccessAt: status.lastSuccessAt,
    nextRetryAt: null,
    pendingCount: status.pendingCount,
    rejectedCount: status.rejectedCount,
    state: status.state === "syncing" || status.state === "backoff" ? inspectionState(status) : status.state
  }
}

/**
 * Deep-freezes the status-owned diagnostic collections.
 * @param {import("./sync-coordinator-types.js").SyncCoordinatorStatus} status - Snapshot.
 * @returns {import("./sync-coordinator-types.js").SyncCoordinatorStatus} - Immutable snapshot.
 */
function immutableStatus(status) {
  const conflicts = status.conflicts.map((conflict) => Object.freeze({...conflict}))
  const failure = status.failure ? Object.freeze({...status.failure}) : null

  return Object.freeze({...status, conflicts: Object.freeze(conflicts), failure})
}

/**
 * Validates one required callback.
 * @param {unknown} value - Function candidate.
 * @param {string} label - Contract label.
 * @returns {void} - Validates the function candidate.
 */
function requireFunction(value, label) {
  if (typeof value !== "function") throw new Error(`SyncCoordinator ${label} must be a function`)
}

/**
 * Validates the SyncClient surface required by the coordinator.
 * @param {import("./sync-client.js").default} client - Client.
 * @returns {void}
 */
function requireCoordinatorClient(client) {
  if (!client) throw new Error("SyncCoordinator requires a SyncClient")

  requireFunction(client.attachCoordinator, "syncClient.attachCoordinator")
  requireFunction(client.inspectSyncState, "syncClient.inspectSyncState")
  requireFunction(client.isLifecycleAbort, "syncClient.isLifecycleAbort")
  requireFunction(client.isOnline, "syncClient.isOnline")
  requireFunction(client.pull, "syncClient.pull")
  requireFunction(client.reportError, "syncClient.reportError")
  requireFunction(client.replayPending, "syncClient.replayPending")
  requireFunction(client.resolveConflict, "syncClient.resolveConflict")
  requireFunction(client.start, "syncClient.start")
  requireFunction(client.stop, "syncClient.stop")
  requireFunction(client.subscribeRealtime, "syncClient.subscribeRealtime")
  requireFunction(client.waitForScheduledReplay, "syncClient.waitForScheduledReplay")
}
