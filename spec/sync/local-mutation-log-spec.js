import {describe, expect, it} from "../../src/testing/test.js"
import LocalMutationLog from "../../src/sync/local-mutation-log.js"

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
  })

  it("persists pending mutations across new log instances", async () => {
    const storage = buildMemoryStorage()
    const firstLog = new LocalMutationLog({idGenerator: () => "log-1", storage})

    await firstLog.append({mutation: buildMutation({clientMutationId: "mutation-1"})})

    const reloadedLog = new LocalMutationLog({storage})

    expect((await reloadedLog.pendingRecords()).map((record) => record.mutation.clientMutationId)).toEqual(["mutation-1"])
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
  const values = new Map()

  return {
    getItem: async (key) => values.get(key) || null,
    setItem: async (key, value) => values.set(key, value)
  }
}

function nextNow(values) {
  let index = 0

  return () => new Date(values[index++] || values[values.length - 1])
}
