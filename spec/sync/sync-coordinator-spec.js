// @ts-check

import {deferred} from "awaitery"
import {describe, expect, it} from "../../src/testing/test.js"
import SyncCoordinator from "../../src/sync/sync-coordinator.js"

/** Flushes microtasks until a condition holds. @param {() => boolean} condition - Condition. @returns {Promise<void>} */
async function flushUntil(condition) {
  for (let iteration = 0; iteration < 100; iteration++) {
    if (condition()) return

    await Promise.resolve()
  }

  throw new Error("Condition never became true while flushing microtasks")
}

/** Builds an injected deterministic timer scheduler. @returns {ReturnType<typeof JSON.parse>} Scheduler harness. */
function buildScheduler() {
  let nextId = 1
  const timers = new Map()

  return {
    clearTimeout: (id) => timers.delete(id),
    delays: () => [...timers.values()].map((timer) => timer.delay),
    runNext: () => {
      const entry = timers.entries().next().value

      if (!entry) throw new Error("No scheduled coordinator timer")

      const [id, timer] = entry

      timers.delete(id)
      timer.callback()
    },
    setTimeout: (callback, delay) => {
      const id = nextId++

      timers.set(id, {callback, delay})

      return id
    },
    size: () => timers.size
  }
}

/** Builds a coordinator harness with explicit fake owners. @param {Record<string, ReturnType<typeof JSON.parse>>} [options] - Overrides. @returns {ReturnType<typeof JSON.parse>} Harness. */
function buildHarness(options = {}) {
  const calls = []
  const reports = []
  const scheduler = buildScheduler()
  const connectivity = {
    listener: null,
    online: options.online ?? true,
    subscribe(listener) {
      calls.push("connectivity:subscribe")
      this.listener = listener

      return () => {
        calls.push("connectivity:unsubscribe")
        this.listener = null
      }
    }
  }
  const syncState = options.syncState || {conflicts: [], pendingCount: 0, rejectedCount: 0}
  const replayErrors = [...(options.replayErrors || [])]
  const client = {
    coordinatorTrigger: null,
    attachCoordinator(trigger) {
      calls.push("client:attach")
      this.coordinatorTrigger = trigger

      return () => {
        calls.push("client:detach")
        this.coordinatorTrigger = null
      }
    },
    inspectSyncState: async () => syncState,
    isLifecycleAbort: () => false,
    isOnline: async () => options.onlineCheck ? await options.onlineCheck() : connectivity.online,
    pull: async () => { calls.push("client:pull") },
    replayPending: async () => {
      calls.push("client:replay")
      const error = replayErrors.shift()

      if (error) throw error
      if (options.replay) await options.replay()
    },
    reportError: (error) => { reports.push(error) },
    resolveConflict: async (args) => {
      calls.push({args, method: "client:resolveConflict"})
      if (args.resolution === "retry-local") client.scheduledReplay = client.coordinatorTrigger("mutation")
    },
    scheduledReplay: null,
    start: async () => { calls.push("client:start") },
    stop: async () => { calls.push("client:stop") },
    subscribeRealtime: async () => { calls.push("client:subscribeRealtime") },
    waitForScheduledReplay: async () => {
      if (client.scheduledReplay) await client.scheduledReplay
    }
  }
  const persisted = []
  const statusStore = options.statusStore || {
    load: async () => options.persistedStatus || null,
    save: async (status) => { persisted.push(status) }
  }
  const nowValues = options.nowValues || ["2026-09-20T10:00:00.000Z"]
  let nowIndex = 0
  const prepare = options.prepare || (async () => {
    calls.push("prepare")

    return () => { calls.push("release") }
  })
  const coordinator = new SyncCoordinator({
    classifyError: options.classifyError || (() => ({code: "sync_failed", retryable: false})),
    connectivity,
    now: () => new Date(nowValues[nowIndex++] || nowValues.at(-1)),
    prepare,
    realtime: options.realtime ?? true,
    retry: options.retry,
    scheduler,
    statusStore,
    syncClient: client
  })

  return {calls, client, connectivity, coordinator, persisted, reports, scheduler, syncState}
}

describe("sync coordinator", () => {
  it("defers triggered network work until lifecycle preparation completes", async () => {
    const prepareStarted = deferred()
    const prepareGate = deferred()
    const harness = buildHarness({
      prepare: async () => {
        prepareStarted.resolve()
        await prepareGate.promise
      }
    })
    const startPromise = harness.coordinator.start()

    await prepareStarted.promise
    const triggerPromise = harness.coordinator.trigger("manual-during-start")

    for (let iteration = 0; iteration < 10; iteration++) await Promise.resolve()

    expect(harness.calls).not.toContain("client:replay")

    prepareGate.resolve()
    await startPromise
    await triggerPromise
    await harness.coordinator.waitForCurrentRun()

    expect(harness.calls.filter((call) => call === "client:replay")).toHaveLength(1)
  })

  it("starts cached-state ownership without awaiting the network cycle and runs replay, realtime, then pull", async () => {
    const replayGate = deferred()
    const harness = buildHarness({replay: async () => await replayGate.promise})

    await harness.coordinator.start()
    await flushUntil(() => harness.calls.includes("client:replay"))

    expect(harness.calls).toEqual([
      "client:attach",
      "connectivity:subscribe",
      "client:start",
      "prepare",
      "client:replay"
    ])
    expect(harness.coordinator.status().state).toEqual("syncing")

    replayGate.resolve()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.calls.slice(-3)).toEqual(["client:replay", "client:subscribeRealtime", "client:pull"])
    expect(harness.coordinator.status().state).toEqual("idle")
  })

  it("runs one cycle at a time and collapses overlapping triggers into one queued rerun", async () => {
    const firstReplay = deferred()
    let replayCount = 0
    const harness = buildHarness({
      replay: async () => {
        replayCount++
        if (replayCount === 1) await firstReplay.promise
      }
    })

    await harness.coordinator.start()
    await flushUntil(() => replayCount === 1)
    const firstTrigger = harness.coordinator.trigger("manual")
    const secondTrigger = harness.coordinator.trigger("realtime")

    expect(replayCount).toEqual(1)

    firstReplay.resolve()
    await Promise.all([firstTrigger, secondTrigger, harness.coordinator.waitForCurrentRun()])

    expect(replayCount).toEqual(2)
  })

  it("publishes offline state immediately and catches up when connectivity returns", async () => {
    const harness = buildHarness({online: false, syncState: {conflicts: [], pendingCount: 2, rejectedCount: 0}})

    await harness.coordinator.start()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.coordinator.status().state).toEqual("offline")
    expect(harness.coordinator.status().pendingCount).toEqual(2)
    expect(harness.calls).not.toContain("client:replay")
    expect(harness.reports).toEqual([])

    harness.connectivity.online = true
    harness.connectivity.listener(true)
    await harness.coordinator.waitForCurrentRun()

    expect(harness.calls).toContain("client:replay")
    expect(harness.calls).toContain("client:pull")
  })

  it("preserves one manual rerun requested before an offline cycle drains", async () => {
    const firstOnlineCheck = deferred()
    const firstOnlineCheckStarted = deferred()
    let onlineCheckCount = 0
    const harness = buildHarness({
      onlineCheck: async () => {
        onlineCheckCount += 1
        if (onlineCheckCount === 1) {
          firstOnlineCheckStarted.resolve()

          return await firstOnlineCheck.promise
        }

        return true
      }
    })

    await harness.coordinator.start()
    await firstOnlineCheckStarted.promise
    const retry = harness.coordinator.retry()

    firstOnlineCheck.resolve(false)
    await retry

    expect(onlineCheckCount).toEqual(2)
    expect(harness.calls.filter((call) => call === "client:replay")).toHaveLength(1)
    expect(harness.coordinator.status().state).toEqual("idle")
  })

  it("uses bounded exponential retry for transient failures", async () => {
    const harness = buildHarness({
      classifyError: () => ({code: "temporarily_unavailable", retryable: true}),
      replayErrors: [new Error("first"), new Error("second"), new Error("third")],
      retry: {initialDelayMs: 100, maxDelayMs: 250, maxAttempts: 3}
    })

    await harness.coordinator.start()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.coordinator.status().state).toEqual("backoff")
    expect(harness.coordinator.status().failure).toEqual({
      attempt: 1,
      at: "2026-09-20T10:00:00.000Z",
      code: "temporarily_unavailable",
      retryable: true
    })
    expect(harness.scheduler.delays()).toEqual([100])

    harness.scheduler.runNext()
    await harness.coordinator.waitForCurrentRun()
    expect(harness.scheduler.delays()).toEqual([200])

    harness.scheduler.runNext()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.coordinator.status().state).toEqual("failed")
    expect(harness.coordinator.status().failure.attempt).toEqual(3)
    expect(harness.scheduler.size()).toEqual(0)
  })

  it("does not automatically retry permanent failures and allows one single-flight manual retry", async () => {
    const retryGate = deferred()
    let replayCount = 0
    const harness = buildHarness({
      classifyError: () => ({code: "permission_denied", retryable: false}),
      replay: async () => {
        replayCount++
        if (replayCount === 1) throw new Error("denied")
        await retryGate.promise
      }
    })

    await harness.coordinator.start()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.coordinator.status().state).toEqual("failed")
    expect(harness.scheduler.size()).toEqual(0)

    const firstRetry = harness.coordinator.retry()
    const secondRetry = harness.coordinator.retry()

    await flushUntil(() => replayCount === 2)
    expect(replayCount).toEqual(2)

    retryGate.resolve()
    await Promise.all([firstRetry, secondRetry])

    expect(harness.coordinator.status().state).toEqual("idle")
  })

  it("gives retry-local one immediate cycle owner while keep-server refreshes status", async () => {
    const harness = buildHarness()

    await harness.coordinator.start()
    await harness.coordinator.waitForCurrentRun()

    await harness.coordinator.resolveConflict({recordId: "log-1", resourceType: "Item", resolution: "keep-server"})

    await harness.coordinator.resolveConflict({recordId: "log-1", resourceType: "Item", resolution: "retry-local"})

    expect(harness.scheduler.size()).toEqual(0)
    expect(harness.calls.filter((call) => call === "client:replay")).toHaveLength(3)
    expect(harness.coordinator.status().state).toEqual("idle")
  })

  it("reports an unexpected cycle failure exactly once after publishing its classified status", async () => {
    const failure = new Error("database invariant failed")
    const harness = buildHarness({replayErrors: [failure]})

    await harness.coordinator.start()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.coordinator.status().state).toEqual("failed")
    expect(harness.coordinator.status().failure.code).toEqual("sync_failed")
    expect(harness.reports).toEqual([failure])
  })

  it("bounds retry when durable status persistence itself stays unavailable", async () => {
    const harness = buildHarness({
      classifyError: () => ({code: "status_store_unavailable", retryable: true}),
      retry: {initialDelayMs: 100, maxDelayMs: 100, maxAttempts: 2},
      statusStore: {
        load: async () => null,
        save: async () => { throw new Error("status store unavailable") }
      }
    })

    await harness.coordinator.start()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.coordinator.status().state).toEqual("backoff")
    expect(harness.scheduler.delays()).toEqual([100])

    harness.scheduler.runNext()
    await harness.coordinator.waitForCurrentRun()

    expect(harness.coordinator.status().state).toEqual("failed")
    expect(harness.coordinator.status().failure.attempt).toEqual(2)
    expect(harness.scheduler.size()).toEqual(0)
    expect(harness.reports).toHaveLength(2)
  })

  it("publishes and persists immutable snapshots without conflict payload data", async () => {
    const conflict = {
      baseVersion: "v1",
      clientMutationId: "mutation-1",
      localVersion: "local-v2",
      recordId: "log-1",
      resourceId: "item-1",
      resourceType: "Item",
      serverVersion: "server-v2",
      versionAttribute: "updatedAt"
    }
    const harness = buildHarness({syncState: {conflicts: [conflict], pendingCount: 0, rejectedCount: 0}})
    const observed = []
    const unsubscribe = harness.coordinator.subscribe((status) => { observed.push(status) })

    await harness.coordinator.start()
    await harness.coordinator.waitForCurrentRun()

    const status = harness.coordinator.status()

    expect(status.state).toEqual("conflicted")
    expect(status.conflicts).toEqual([conflict])
    expect(Object.isFrozen(status)).toEqual(true)
    expect(Object.isFrozen(status.conflicts)).toEqual(true)
    expect(Object.isFrozen(status.conflicts[0])).toEqual(true)
    expect(harness.persisted.at(-1).conflicts).toEqual([conflict])
    expect(observed.at(-1)).toEqual(status)
    expect(harness.reports).toEqual([])

    unsubscribe()
  })

  it("stops idempotently, cancels owned work, and ignores stale completion state", async () => {
    const replayGate = deferred()
    const harness = buildHarness({replay: async () => await replayGate.promise})

    await harness.coordinator.start()
    await flushUntil(() => harness.calls.includes("client:replay"))

    const firstStop = harness.coordinator.stop()
    const secondStop = harness.coordinator.stop()

    replayGate.resolve()
    await Promise.all([firstStop, secondStop])

    expect(harness.coordinator.status().state).toEqual("stopped")
    expect(harness.calls.filter((call) => call === "client:stop")).toHaveLength(1)
    expect(harness.calls.filter((call) => call === "release")).toHaveLength(1)
    expect(harness.calls).toContain("client:detach")
    expect(harness.calls).toContain("connectivity:unsubscribe")
    expect(harness.scheduler.size()).toEqual(0)
  })

  it("does not publish syncing or begin network work after a stopped online check resolves", async () => {
    const onlineGate = deferred()
    const harness = buildHarness({onlineCheck: async () => await onlineGate.promise})
    const states = []

    harness.coordinator.subscribe((status) => { states.push(status.state) })
    await harness.coordinator.start()
    const stopPromise = harness.coordinator.stop()

    onlineGate.resolve(true)
    await stopPromise

    expect(harness.calls).not.toContain("client:replay")
    expect(states).not.toContain("syncing")
    expect(harness.coordinator.status().state).toEqual("stopped")
  })

  it("rolls back partial lifecycle ownership when preparation fails", async () => {
    const harness = buildHarness({
      classifyError: () => ({code: "replica_unavailable", retryable: false}),
      prepare: async () => { throw new Error("replica acquisition failed") }
    })

    await expect(async () => await harness.coordinator.start()).toThrow("replica acquisition failed")

    expect(harness.coordinator.status().state).toEqual("failed")
    expect(harness.coordinator.status().failure.code).toEqual("replica_unavailable")
    expect(harness.calls).toContain("client:stop")
    expect(harness.calls).toContain("client:detach")
    expect(harness.calls).toContain("connectivity:unsubscribe")
    expect(harness.client.coordinatorTrigger).toEqual(null)
  })
})
