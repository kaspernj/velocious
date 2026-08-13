// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import wait from "awaitery/build/wait.js"
import {buildConfiguration, buildFakeSyncModel, buildMetadataModelClass, buildRecord, triggerLifecycle} from "./sync-client-fakes.js"
import {buildMutationLog, conflictTracking} from "../helpers/sync-client-conflict-tracking-helper.js"
import SyncClient from "../../src/sync/sync-client.js"

const COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "lockVersion", name: "lock_version", type: "integer"},
  {attributeName: "title", name: "title", type: "varchar"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

/** @param {object} args - Harness args. @param {boolean} [args.optIn] - Enable conflict tracking. @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} [args.responses] - Replay responses. @param {string} [args.versionAttribute] - Conflict version attribute. @returns {ReturnType<typeof JSON.parse>} Harness. */
function buildHarness({optIn = true, responses = [], versionAttribute = "updatedAt"} = {}) {
  const mutationIds = ["mutation-1", "mutation-2", "mutation-3", "mutation-4"]
  const mutationLog = buildMutationLog(mutationIds)
  const syncModel = buildFakeSyncModel()
  const posts = []
  const tracking = conflictTracking(mutationLog, mutationIds)

  tracking.versionAttribute = versionAttribute

  const declaration = optIn ? {conflictTracking: tracking, track: true} : {track: true}
  const ModelClass = buildMetadataModelClass({columns: COLUMNS, modelName: "UuidItem", sync: declaration})
  const transport = {
    post: async (_path, payload) => {
      posts.push(payload)
      const queuedResponse = responses.shift()

      if (queuedResponse instanceof Error) throw queuedResponse

      const response = await queuedResponse || {syncs: payload.syncs.map((sync) => ({id: sync.id, serverVersion: `v${posts.length + 1}`, syncState: "successful"}))}

      return {json: () => response}
    }
  }
  const configuration = buildConfiguration({
    modelClasses: [ModelClass],
    sync: {client: {authenticationToken: () => "token-1", isOnline: () => false, transport}}
  })

  return {client: new SyncClient({configuration, syncModel}), ModelClass, mutationLog, posts, syncModel}
}

/** @param {ReturnType<typeof JSON.parse>} ModelClass - Model. @param {string} title - Title. @param {string} version - Version. @returns {ReturnType<typeof JSON.parse>} Record. */
function record(ModelClass, title, version) {
  return buildRecord(ModelClass, "item-1", {id: "item-1", title, updatedAt: new Date(version)})
}

describe("sync client base-version conflict tracking", () => {
  it("makes same-record predecessor timestamps strictly monotonic when the clock does not advance", async () => {
    const harness = buildHarness()
    const item = record(harness.ModelClass, "first", "2026-08-12T09:00:00.000Z")
    const tracking = harness.client.config.resources.UuidItem.conflictTracking

    if (!tracking) throw new Error("Expected conflict tracking")
    tracking.now = () => new Date("2026-08-12T09:30:00.000Z")

    await harness.client.queue({baseVersion: "v1", data: {title: "first"}, operation: "update", resource: item})
    await harness.client.queue({baseVersion: "v1", data: {title: "second"}, operation: "update", resource: item})

    const records = await harness.mutationLog.records()

    expect(records.map((queued) => queued.mutation.occurredAt)).toEqual([
      "2026-08-12T09:30:00.000Z",
      "2026-08-12T09:30:00.001Z"
    ])
  })

  it("strips a custom server-managed version attribute from automatic mutation data", async () => {
    const harness = buildHarness({versionAttribute: "lockVersion"})
    const item = buildRecord(harness.ModelClass, "item-1", {id: "item-1", lockVersion: 7, title: "changed"})

    await harness.client.queue({baseVersion: 7, operation: "update", resource: item})

    expect((await harness.mutationLog.records())[0].mutation.attributes).toEqual({title: "changed"})
    expect(harness.client.config.resources.UuidItem.localOnlyAttributes).toContain("lockVersion")
  })

  it("captures the pre-update version before the tracked record changes", async () => {
    const harness = buildHarness()
    const attributes = {id: "item-1", title: "before", updatedAt: new Date("2026-08-12T09:00:00.000Z")}
    const item = buildRecord(harness.ModelClass, "item-1", attributes)

    await harness.client.start()
    await triggerLifecycle(harness.ModelClass, "beforeUpdate", item)
    attributes.title = "after"
    attributes.updatedAt = new Date("2026-08-12T09:05:00.000Z")
    await triggerLifecycle(harness.ModelClass, "afterUpdate", item)

    expect((await harness.mutationLog.records())[0].mutation.baseVersion).toEqual("2026-08-12T09:00:00.000Z")
    harness.client.stop()
  })

  it("persists stale update and delete conflicts with their authoritative base versions", async () => {
    const conflict = {affectedFields: ["title"], baseVersion: "2026-08-12T09:00:00.000Z", serverVersion: "2026-08-12T09:30:00.000Z"}
    const harness = buildHarness({responses: [{syncs: [{conflict, id: "mutation-1", syncState: "conflict"}]}]})

    await harness.client.queue({baseVersion: "2026-08-12T09:00:00.000Z", data: {title: "local"}, operation: "update", resource: record(harness.ModelClass, "local", "2026-08-12T09:00:00.000Z")})
    harness.client.config.isOnline = () => true
    await harness.client.replayPending()

    let records = await harness.mutationLog.records()

    expect(harness.posts[0].syncs[0].baseVersion).toEqual("2026-08-12T09:00:00.000Z")
    expect(records[0].status).toEqual("conflict")
    expect(records[0].syncResult?.conflict).toEqual(conflict)

    const deletion = buildHarness({responses: [{syncs: [{conflict, id: "mutation-1", syncState: "conflict"}]}]})

    await deletion.client.queue({baseVersion: "2026-08-12T09:00:00.000Z", data: {}, operation: "destroy", resource: record(deletion.ModelClass, "server", "2026-08-12T09:00:00.000Z")})
    deletion.client.config.isOnline = () => true
    await deletion.client.replayPending()
    records = await deletion.mutationLog.records()

    expect(deletion.posts[0].syncs[0].syncType).toEqual("delete")
    expect(records[0].status).toEqual("conflict")
  })

  it("preserves sequential predecessors and create-then-edit order", async () => {
    const harness = buildHarness()
    const item = record(harness.ModelClass, "first", "2026-08-12T09:00:00.000Z")

    await harness.client.queue({baseVersion: null, data: {title: "created"}, operation: "create", resource: item})
    await harness.client.queue({baseVersion: null, data: {title: "edited"}, operation: "update", resource: item})

    const records = await harness.mutationLog.records()

    expect(records).toHaveLength(2)
    expect(records[0].mutation.operation).toEqual("create")
    expect(records[1].dependencies).toEqual([{clientMutationId: "mutation-1", model: "UuidItem"}])
    expect(records[1].mutation.operation).toEqual("update")
  })

  it("coalesces only scalar transport updates while retaining inspectable intents", async () => {
    const harness = buildHarness()
    const item = record(harness.ModelClass, "first", "2026-08-12T09:00:00.000Z")

    await harness.client.queue({baseVersion: "v1", data: {title: "first"}, operation: "update", resource: item})
    await harness.client.queue({baseVersion: "v1", data: {priority: 2}, operation: "update", resource: item})
    await harness.client.queue({baseVersion: "v1", data: {metadata: {nested: true}}, operation: "update", resource: item})
    harness.client.config.isOnline = () => true
    await harness.client.replayPending()

    expect(await harness.mutationLog.records()).toHaveLength(3)
    expect(harness.posts[0].syncs[0].data).toEqual({priority: 2, title: "first"})
    expect(harness.posts[0].syncs).toHaveLength(1)
    expect(harness.posts[1].syncs[0].data).toEqual({metadata: {nested: true}})
  })

  it("rebases a successor after acknowledgement only without an intervening remote apply", async () => {
    const harness = buildHarness()
    const item = record(harness.ModelClass, "first", "2026-08-12T09:00:00.000Z")

    await harness.client.queue({baseVersion: "v1", data: {title: "first"}, operation: "update", resource: item})
    await harness.client.queue({baseVersion: "v1", data: {title: "second"}, operation: "update", resource: item})
    harness.client.config.isOnline = () => true
    await harness.client.replayPending()

    const records = await harness.mutationLog.records()

    expect(records[0].status).toEqual("synced")
    expect(records[1].mutation.baseVersion).toEqual("v2")
    expect(records[1].status).toEqual("synced")
  })

  it("keeps an intervening-remote successor unre-based and stores its later conflict", async () => {
    let release
    const firstResponse = new Promise((resolve) => { release = resolve })
    const conflict = {baseVersion: "v1", serverVersion: "remote-v2"}
    const harness = buildHarness({responses: [firstResponse, {syncs: [{conflict, id: "mutation-2", syncState: "conflict"}]}]})
    const item = record(harness.ModelClass, "first", "2026-08-12T09:00:00.000Z")

    await harness.client.queue({baseVersion: "v1", data: {title: "first"}, operation: "update", resource: item})
    await harness.client.queue({baseVersion: "v1", data: {title: "second"}, operation: "update", resource: item})
    harness.client.config.isOnline = () => true
    const replay = harness.client.replayPending()

    await wait(() => harness.posts.length === 1)
    harness.client.noteRemoteVersion({resourceId: "item-1", resourceType: "UuidItem", version: "remote-v2"})
    release({syncs: [{id: "mutation-1", serverVersion: "v2", syncState: "successful"}]})
    await replay

    const records = await harness.mutationLog.records()

    expect(records[1].mutation.baseVersion).toEqual("v1")
    expect(records[1].status).toEqual("conflict")
    expect(records[1].syncResult?.conflict).toEqual(conflict)
  })

  it("replays the same durable id after response loss and accepts duplicate acknowledgement", async () => {
    const harness = buildHarness({responses: [new Error("response lost"), {syncs: [{id: "mutation-1", serverVersion: "v2", syncState: "duplicate"}]}]})

    await harness.client.queue({baseVersion: "v1", data: {title: "once"}, operation: "update", resource: record(harness.ModelClass, "once", "2026-08-12T09:00:00.000Z")})
    harness.client.config.isOnline = () => true
    await expect(async () => await harness.client.replayPending()).toThrow("response lost")
    await harness.client.replayPending()

    expect(harness.posts[0].syncs[0].id).toEqual(harness.posts[1].syncs[0].id)
    expect((await harness.mutationLog.records())[0].status).toEqual("synced")
  })

  it("preserves the legacy one-row payload for resources that do not opt in", async () => {
    const harness = buildHarness({optIn: false})
    const item = record(harness.ModelClass, "first", "2026-08-12T09:00:00.000Z")

    await harness.client.queue({data: {title: "first"}, resource: item})
    await harness.client.queue({data: {title: "second"}, resource: item})
    harness.client.config.isOnline = () => true
    await harness.client.replayPending()

    expect(harness.syncModel.rows).toHaveLength(1)
    expect(harness.posts[0].syncs[0].data).toEqual({title: "second"})
    expect(harness.posts[0].syncs[0].baseVersion).toEqual(undefined)
    expect(await harness.mutationLog.records()).toEqual([])
  })
})
