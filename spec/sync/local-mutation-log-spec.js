import {describe, expect, it} from "../../src/testing/test.js"
import LocalMutationLog from "../../src/sync/local-mutation-log.js"
import {applySyncReplayResultToLocalMutationLog, replayResultLocalStatus, resolveSyncConflict} from "../../src/sync/conflict-strategy.js"

describe("local sync mutation log", () => {
  it("appends pending mutations with actor device grant policy and dependency metadata", async () => {
    const storage = buildMemoryStorage()
    const mutationLog = new LocalMutationLog({
      idGenerator: () => "log-1",
      now: () => new Date("2026-06-24T10:00:00.000Z"),
      storage
    })

    const record = await mutationLog.append({
      dependencies: [{clientMutationId: "parent-1", model: "Project"}],
      mutation: {
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        attributes: {name: "Offline task"},
        baseVersion: "v1",
        clientMutationId: "mutation-1",
        model: "Task",
        occurredAt: "2026-06-24T09:59:59.000Z",
        offlineGrantId: "grant-1",
        operation: "create",
        policyHash: "sha256-task"
      }
    })

    expect(record).toEqual({
      createdAt: "2026-06-24T10:00:00.000Z",
      dependencies: [{clientMutationId: "parent-1", model: "Project"}],
      id: "log-1",
      mutation: {
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        attributes: {name: "Offline task"},
        baseVersion: "v1",
        clientMutationId: "mutation-1",
        model: "Task",
        occurredAt: "2026-06-24T09:59:59.000Z",
        offlineGrantId: "grant-1",
        operation: "create",
        policyHash: "sha256-task"
      },
      sequence: 1,
      status: "pending",
      updatedAt: "2026-06-24T10:00:00.000Z"
    })
    expect(await mutationLog.records()).toEqual([record])
    expect(storage.calls.map((call) => call.method)).toEqual(["nextSequence", "appendRecord", "records"])
  })

  it("persists pending mutations across new log instances without one JSON blob", async () => {
    const storage = buildMemoryStorage()
    const firstLog = new LocalMutationLog({idGenerator: () => "log-1", storage})

    await firstLog.append({mutation: buildMutation({clientMutationId: "mutation-1"})})

    const reloadedLog = new LocalMutationLog({storage})

    expect((await reloadedLog.pendingRecords()).map((record) => record.mutation.clientMutationId)).toEqual(["mutation-1"])
    expect(storage.calls.some((call) => call.method === "getItem" || call.method === "setItem")).toEqual(false)
  })

  it("updates mutation status without rewriting the original actor payload", async () => {
    const storage = buildMemoryStorage()
    const mutationLog = new LocalMutationLog({
      idGenerator: () => "log-1",
      now: nextNow(["2026-06-24T10:00:00.000Z", "2026-06-24T10:01:00.000Z"]),
      storage
    })
    const original = await mutationLog.append({mutation: buildMutation({clientMutationId: "mutation-1"})})

    const updated = await mutationLog.updateStatus({
      id: original.id,
      status: "synced",
      syncResult: {serverSequence: 42}
    })

    expect(updated).toEqual({
      ...original,
      status: "synced",
      syncResult: {serverSequence: 42},
      updatedAt: "2026-06-24T10:01:00.000Z"
    })
    expect(await mutationLog.pendingRecords()).toEqual([])
  })

  it("asks storage for pending statuses instead of loading all terminal records", async () => {
    const storage = buildMemoryStorage()
    const mutationLog = new LocalMutationLog({idGenerator: nextValue(["log-1", "log-2"]), storage})

    const pending = await mutationLog.append({mutation: buildMutation({clientMutationId: "pending-1"})})
    const synced = await mutationLog.append({mutation: buildMutation({clientMutationId: "synced-1"})})
    await mutationLog.updateStatus({id: synced.id, status: "synced"})

    expect(await mutationLog.pendingRecords()).toEqual([pending])
    expect(storage.calls[storage.calls.length - 1]).toEqual({
      method: "records",
      options: {statuses: ["pending", "applied-locally", "peer-applied"]},
      storageKey: "velocious.sync.localMutationLog"
    })
  })

  it("serializes concurrent appends so no mutation is lost", async () => {
    const storage = buildMemoryStorage()
    const mutationLog = new LocalMutationLog({
      idGenerator: nextValue(["log-1", "log-2"]),
      now: nextNow(["2026-06-24T10:00:00.000Z", "2026-06-24T10:00:01.000Z"]),
      storage
    })

    await Promise.all([
      mutationLog.append({mutation: buildMutation({clientMutationId: "mutation-1"})}),
      mutationLog.append({mutation: buildMutation({clientMutationId: "mutation-2"})})
    ])

    expect((await mutationLog.records()).map((record) => ({
      clientMutationId: record.mutation.clientMutationId,
      id: record.id,
      sequence: record.sequence
    }))).toEqual([
      {clientMutationId: "mutation-1", id: "log-1", sequence: 1},
      {clientMutationId: "mutation-2", id: "log-2", sequence: 2}
    ])
  })

  it("compacts old terminal records while preserving pending dependencies", async () => {
    const storage = buildMemoryStorage()
    const mutationLog = new LocalMutationLog({
      idGenerator: nextValue(["log-1", "log-2", "log-3", "log-4"]),
      now: nextNow([
        "2026-06-24T10:00:00.000Z",
        "2026-06-24T10:00:01.000Z",
        "2026-06-24T10:00:02.000Z",
        "2026-06-24T10:00:03.000Z",
        "2026-06-24T10:00:04.000Z",
        "2026-06-24T10:00:05.000Z",
        "2026-06-24T10:00:06.000Z"
      ]),
      storage
    })
    const dependency = await mutationLog.append({mutation: buildMutation({clientMutationId: "dependency-1"})})
    const prunable = await mutationLog.append({mutation: buildMutation({clientMutationId: "prunable-1"})})
    const newestTerminal = await mutationLog.append({mutation: buildMutation({clientMutationId: "newest-1"})})
    const pending = await mutationLog.append({
      dependencies: [{clientMutationId: "dependency-1", model: "Task"}],
      mutation: buildMutation({clientMutationId: "pending-1"})
    })

    await mutationLog.updateStatus({id: dependency.id, status: "synced"})
    await mutationLog.updateStatus({id: prunable.id, status: "synced"})
    await mutationLog.updateStatus({id: newestTerminal.id, status: "synced"})

    const result = await mutationLog.compact({maxTerminalRecords: 1})

    expect(result.deletedRecordIds).toEqual([prunable.id])
    expect((await mutationLog.records()).map((record) => record.id)).toEqual([dependency.id, newestTerminal.id, pending.id])
  })

  it("maps server replay result statuses onto durable local mutation statuses", async () => {
    expect(replayResultLocalStatus({status: "success"})).toEqual("synced")
    expect(replayResultLocalStatus({status: "duplicate"})).toEqual("synced")
    expect(replayResultLocalStatus({status: "conflict"})).toEqual("conflict")
    expect(replayResultLocalStatus({status: "error"})).toEqual("rejected")
  })

  it("persists conflict replay results on the local mutation log for UI resolution", async () => {
    const storage = buildMemoryStorage()
    const mutationLog = new LocalMutationLog({
      idGenerator: () => "log-1",
      now: nextNow(["2026-06-24T10:00:00.000Z", "2026-06-24T10:01:00.000Z"]),
      storage
    })
    const record = await mutationLog.append({mutation: buildMutation({clientMutationId: "mutation-1"})})
    const syncResult = {
      conflict: {affectedFields: ["name"], serverModel: {id: "task-1", name: "Server task"}},
      idempotencyKey: "user-1:device-1:mutation-1",
      status: "conflict"
    }

    const updated = await applySyncReplayResultToLocalMutationLog({mutationLog, record, result: syncResult})

    expect(updated.status).toEqual("conflict")
    expect(updated.syncResult).toEqual(syncResult)
    expect(updated.updatedAt).toEqual("2026-06-24T10:01:00.000Z")
  })

  it("detects optimistic-version conflicts and returns structured server/local state", async () => {
    const result = await resolveSyncConflict({
      mutation: buildMutation({attributes: {name: "Offline edit"}, baseVersion: "v1", clientMutationId: "mutation-1", operation: "update", payload: {id: "task-1"}}),
      serverRecord: {attributes: {id: "task-1", name: "Server edit", updatedAt: "v2"}}
    })

    expect(result.status).toEqual("conflict")
    expect(result.strategy).toEqual("optimisticVersion")
    expect(result.conflict).toEqual({
      affectedFields: ["name"],
      baseRecord: null,
      baseVersion: "v1",
      localMutation: {
        attributes: {name: "Offline edit"},
        clientMutationId: "mutation-1",
        model: "Task",
        operation: "update",
        payload: {id: "task-1"}
      },
      serverModel: {id: "task-1", name: "Server edit", updatedAt: "v2"},
      serverVersion: "v2",
      suggestedResolution: "manual",
      versionAttribute: "updatedAt"
    })
  })

  it("three-way merges non-overlapping field edits while reporting overlapping conflicts", async () => {
    const nonOverlapping = await resolveSyncConflict({
      baseRecord: {attributes: {id: "task-1", name: "Original", scanned: false}},
      mutation: buildMutation({attributes: {scanned: true}, clientMutationId: "mutation-1", operation: "update", payload: {id: "task-1"}}),
      serverRecord: {attributes: {id: "task-1", name: "Server edit", scanned: false}},
      strategy: "fieldThreeWay"
    })
    const overlapping = await resolveSyncConflict({
      baseRecord: {attributes: {id: "task-1", name: "Original"}},
      mutation: buildMutation({attributes: {name: "Offline edit"}, clientMutationId: "mutation-2", operation: "update", payload: {id: "task-1"}}),
      serverRecord: {attributes: {id: "task-1", name: "Server edit"}},
      strategy: "fieldThreeWay"
    })

    expect(nonOverlapping).toEqual({attributes: {scanned: true}, status: "applied", strategy: "fieldThreeWay"})
    expect(overlapping.status).toEqual("conflict")
    expect(overlapping.conflict?.affectedFields).toEqual(["name"])
  })
})

function buildMutation(overrides = {}) {
  return {
    actorDeviceId: "device-1",
    actorUserId: "user-1",
    attributes: {name: "Offline task"},
    baseVersion: null,
    clientMutationId: "mutation-1",
    model: "Task",
    occurredAt: "2026-06-24T09:59:59.000Z",
    offlineGrantId: "grant-1",
    operation: "create",
    policyHash: "sha256-task",
    ...overrides
  }
}

function buildMemoryStorage() {
  const recordsByKey = new Map()
  const calls = []

  function recordsFor(storageKey) {
    if (!recordsByKey.has(storageKey)) recordsByKey.set(storageKey, [])

    return recordsByKey.get(storageKey)
  }

  return {
    calls,
    appendRecord: async (storageKey, record) => {
      calls.push({method: "appendRecord", record, storageKey})
      recordsFor(storageKey).push(JSON.parse(JSON.stringify(record)))
    },
    deleteRecords: async (storageKey, ids) => {
      calls.push({ids, method: "deleteRecords", storageKey})
      const idSet = new Set(ids)
      recordsByKey.set(storageKey, recordsFor(storageKey).filter((record) => !idSet.has(record.id)))
    },
    nextSequence: async (storageKey) => {
      calls.push({method: "nextSequence", storageKey})

      return recordsFor(storageKey).reduce((max, record) => Math.max(max, record.sequence + 1), 1)
    },
    record: async (storageKey, id) => {
      calls.push({id, method: "record", storageKey})
      const record = recordsFor(storageKey).find((candidate) => candidate.id === id)

      return record ? JSON.parse(JSON.stringify(record)) : null
    },
    records: async (storageKey, options = {}) => {
      calls.push({method: "records", options, storageKey})
      let records = recordsFor(storageKey)

      if (options.statuses) {
        const statuses = new Set(options.statuses)
        records = records.filter((record) => statuses.has(record.status))
      }

      return records.map((record) => JSON.parse(JSON.stringify(record)))
    },
    updateRecord: async (storageKey, record) => {
      calls.push({method: "updateRecord", record, storageKey})
      const rows = recordsFor(storageKey)
      const index = rows.findIndex((candidate) => candidate.id === record.id)

      if (index === -1) throw new Error(`No record ${record.id}`)

      rows[index] = JSON.parse(JSON.stringify(record))
    }
  }
}

function nextNow(values) {
  let index = 0

  return () => new Date(values[index++] || values[values.length - 1])
}

function nextValue(values) {
  let index = 0

  return () => values[index++] || values[values.length - 1]
}
