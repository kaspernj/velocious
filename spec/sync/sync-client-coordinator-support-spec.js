// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel, buildMetadataModelClass, buildRecord} from "./sync-client-fakes.js"
import {buildMutationLog, conflictTracking} from "../helpers/sync-client-conflict-tracking-helper.js"
import SyncClient from "../../src/sync/sync-client.js"

const COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "title", name: "title", type: "varchar"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

/** Builds a conflict-tracked sync client. @param {Record<string, ReturnType<typeof JSON.parse>>} [options] - Overrides. @returns {ReturnType<typeof JSON.parse>} Harness. */
function buildHarness(options = {}) {
  const mutationLog = buildMutationLog(["mutation-1", "mutation-2", "mutation-3"])
  const tracking = conflictTracking(mutationLog, ["mutation-1", "mutation-2", "mutation-3"])
  const ModelClass = buildMetadataModelClass({
    columns: COLUMNS,
    modelName: "Item",
    sync: {
      attributes: ({data}) => data,
      conflictTracking: tracking,
      track: true
    }
  })
  const syncModel = buildFakeSyncModel()
  const responses = [...(options.responses || [])]
  const posts = []
  const transport = {
    post: async (path, payload) => {
      posts.push({path, payload})

      return {
        json: () => path.endsWith("/changes")
          ? {nextCursor: null, status: "success", syncs: [], upToCursor: null}
          : responses.shift() || {status: "success", syncs: payload.syncs.map((sync) => ({id: sync.id, serverVersion: "v2", syncState: "successful"}))}
      }
    }
  }
  const configuration = buildConfiguration({
    modelClasses: [ModelClass],
    sync: {client: {authenticationToken: () => "token-1", isOnline: () => options.online ?? false, transport}}
  })
  const client = new SyncClient({configuration, syncModel})

  return {client, ModelClass, mutationLog, posts, syncModel}
}

describe("sync client coordinator support", () => {
  it("activates the user scope without subscribing or pulling outside the coordinator", async () => {
    const harness = buildHarness({online: true})

    await harness.client.activateUserScope()

    const scopes = await harness.client.scopeStore().activeScopes()

    expect(scopes).toHaveLength(1)
    expect(scopes[0].conditions).toEqual({})
    expect(scopes[0].resourceType).toEqual(null)
    expect(scopes[0].state).toEqual("active")
    expect(harness.posts).toEqual([])
    expect(harness.client.realtimeStatus()).toEqual({channels: [], state: "unsubscribed"})
  })

  it("routes mutation and realtime catch-up requests through one attached coordinator", async () => {
    const harness = buildHarness()
    const reasons = []
    const detach = harness.client.attachCoordinator(async (reason) => { reasons.push(reason) })
    const item = buildRecord(harness.ModelClass, "item-1", {id: "item-1", title: "local", updatedAt: new Date("2026-09-20T09:00:00.000Z")})

    await harness.client.queue({baseVersion: "v1", data: {title: "local"}, operation: "update", resource: item})
    harness.client.realtimeBridge().schedulePull()
    await harness.client.waitForScheduledReplay()
    await harness.client.waitForRealtimeApplied()

    expect(reasons).toEqual(["mutation", "realtime"])
    expect(() => harness.client.attachCoordinator(async () => {})).toThrow(/already has an attached coordinator/u)

    detach()
  })

  it("reports privacy-safe pending, rejection, and conflict diagnostics", async () => {
    const harness = buildHarness()
    const pending = await harness.mutationLog.append({mutation: mutation({clientMutationId: "mutation-1"})})
    const conflict = await harness.mutationLog.append({mutation: mutation({clientMutationId: "mutation-2"})})
    const rejected = await harness.mutationLog.append({mutation: mutation({clientMutationId: "mutation-3"})})

    await harness.mutationLog.updateStatus({
      id: conflict.id,
      status: "conflict",
      syncResult: {
        conflict: {
          affectedFields: ["title"],
          baseVersion: "v1",
          localMutation: {attributes: {title: "private local title"}},
          localVersion: "local-v2",
          serverModel: {id: "item-1", title: "private server title", updatedAt: "server-v2"},
          serverVersion: "server-v2",
          versionAttribute: "updatedAt"
        },
        syncState: "conflict"
      }
    })
    await harness.mutationLog.updateStatus({id: rejected.id, status: "rejected", syncResult: {reason: "private policy detail", syncState: "rejected"}})
    await harness.syncModel.create({data: {title: "legacy"}, resourceId: "legacy-1", resourceType: "LegacyItem", state: "pending", syncType: "update"})

    const state = await harness.client.inspectSyncState()

    expect(state.pendingCount).toEqual(2)
    expect(state.rejectedCount).toEqual(1)
    expect(state.conflicts).toEqual([{
      baseVersion: "v1",
      clientMutationId: "mutation-2",
      localVersion: "local-v2",
      recordId: conflict.id,
      resourceId: "item-1",
      resourceType: "Item",
      serverVersion: "server-v2",
      versionAttribute: "updatedAt"
    }])
    expect(JSON.stringify(state)).not.toMatch(/private/u)
    expect(pending.status).toEqual("pending")
  })

  it("resolves conflicts explicitly by keeping the server or retrying local intent from the authoritative version", async () => {
    const harness = buildHarness()
    const keepServer = await harness.mutationLog.append({mutation: mutation({clientMutationId: "mutation-1"})})
    const retryLocal = await harness.mutationLog.append({mutation: mutation({clientMutationId: "mutation-2"})})

    for (const record of [keepServer, retryLocal]) {
      await harness.mutationLog.updateStatus({
        id: record.id,
        status: "conflict",
        syncResult: {conflict: {serverVersion: "server-v2"}, syncState: "conflict"}
      })
    }

    await harness.client.resolveConflict({recordId: keepServer.id, resolution: "keep-server", resourceType: "Item"})
    await harness.client.resolveConflict({recordId: retryLocal.id, resolution: "retry-local", resourceType: "Item"})
    await harness.client.waitForScheduledReplay()

    const records = await harness.mutationLog.records()

    expect(records[0].status).toEqual("synced")
    expect(records[1].status).toEqual("pending")
    expect(records[1].mutation.baseVersion).toEqual("server-v2")
  })

  it("applies the server-authoritative conflict record through the remote applier before preserving intent", async () => {
    const conflict = {
      baseVersion: "v1",
      serverModel: {id: "item-1", title: "server title", updatedAt: "server-v2"},
      serverVersion: "server-v2",
      versionAttribute: "updatedAt"
    }
    const harness = buildHarness({online: true, responses: [{status: "success", syncs: [{conflict, id: "mutation-1", syncState: "conflict"}]}]})
    const attributes = {id: "item-1", title: "local title", updatedAt: "local-v2"}
    const item = buildRecord(harness.ModelClass, "item-1", attributes)

    item.assign = (newAttributes) => { Object.assign(attributes, newAttributes) }
    item.isChanged = () => true
    item.save = async () => {}
    harness.ModelClass.findOrInitializeBy = async () => item
    harness.ModelClass.findBy = async () => item

    await harness.client.queue({baseVersion: "v1", data: {title: "local title"}, operation: "update", resource: item})
    await harness.client.replayPending()

    expect(attributes).toEqual({id: "item-1", title: "server title", updatedAt: "server-v2"})
    expect((await harness.mutationLog.records())[0].status).toEqual("conflict")
  })
})

/** Builds a durable mutation. @param {Record<string, ReturnType<typeof JSON.parse>>} overrides - Overrides. @returns {ReturnType<typeof JSON.parse>} Mutation. */
function mutation(overrides) {
  return {
    actorDeviceId: "device-1",
    actorUserId: "user-1",
    attributes: {title: "private local title"},
    baseVersion: "v1",
    clientMutationId: "mutation-1",
    model: "Item",
    occurredAt: "2026-09-20T09:00:00.000Z",
    offlineGrantId: "grant-1",
    operation: "update",
    payload: {resourceId: "item-1", syncType: "update"},
    policyHash: "policy-1",
    ...overrides
  }
}
