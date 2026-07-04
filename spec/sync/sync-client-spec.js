// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SyncClient from "../../src/sync/sync-client.js"

class Ticket {
  /** @returns {string} Stable model name. */
  static getModelName() {
    return "Ticket"
  }
}

class TicketScan {
  /** @returns {string} Stable model name. */
  static getModelName() {
    return "TicketScan"
  }
}

/** @returns {Configuration} Database-less configuration so the scope store uses memory storage. */
function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: "/tmp/velocious-sync-client-spec",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    locales: ["en"]
  })
}

/**
 * Builds a fake local pending-sync model compatible with the sync client.
 * @returns {?} Fake sync model with a rows array.
 */
function buildFakeSyncModel() {
  /** @type {Array<?>} */
  const rows = []
  let nextId = 1

  /**
   * @param {Record<string, ?>} attributes - Row attributes.
   * @returns {?} Fake sync row.
   */
  const buildRow = (attributes) => {
    const row = {
      attributes: {...attributes, id: nextId++},
      createdAt: () => new Date("2026-07-01T10:00:00.000Z"),
      data: () => row.attributes.data,
      id: () => row.attributes.id,
      resource: () => null,
      resourceId: () => row.attributes.resourceId,
      resourceType: () => row.attributes.resourceType,
      syncType: () => row.attributes.syncType,
      /** @param {Record<string, ?>} newAttributes - Updated attributes. @returns {Promise<void>} */
      update: async (newAttributes) => {
        Object.assign(row.attributes, newAttributes)
      },
      updatedAt: () => new Date("2026-07-01T10:00:00.000Z")
    }

    return row
  }

  return {
    /** @param {Record<string, ?>} attributes - Row attributes. @returns {Promise<?>} Created row. */
    create: async (attributes) => {
      const row = buildRow(attributes)

      rows.push(row)

      return row
    },
    /** @param {Record<string, ?>} conditions - Lookup conditions. @returns {Promise<?>} Existing row. */
    findBy: async (conditions) => {
      if ("id" in conditions) return rows.find((row) => row.attributes.id === conditions.id) || null

      return rows.find((row) => row.attributes.resourceId === conditions.resourceId && row.attributes.resourceType === conditions.resourceType) || null
    },
    preload: () => ({
      /** @param {Record<string, ?>} conditions - Where conditions. @returns {?} Chainable query. */
      where: (conditions) => ({
        first: async () => rows.find((row) => row.attributes.id === conditions.id) || null,
        order: () => ({
          toArray: async () => rows.filter((row) => row.attributes.state === conditions.state)
        })
      })
    }),
    rows
  }
}

/**
 * Builds a fake query for a resource type with plain conditions.
 * @param {string} resourceType - Resource/model name.
 * @param {Record<string, ?>} conditions - Attribute conditions.
 * @returns {?} Fake model query.
 */
function fakeQuery(resourceType, conditions) {
  return {
    getGroups: () => [],
    getJoins: () => [],
    getLimit: () => null,
    getModelClass: () => ({getModelName: () => resourceType}),
    getOffset: () => null,
    getOrders: () => [],
    getWheres: () => [{hash: conditions}]
  }
}

/**
 * Builds a sync client harness with recording fakes.
 * @param {Record<string, ?>} [overrides] - Config overrides.
 * @returns {?} Harness with client, fakes, and recorded calls.
 */
function buildHarness(overrides = {}) {
  /** @type {Array<Record<string, ?>>} */
  const postChangesCalls = []
  /** @type {Array<Record<string, ?>>} */
  const postReplayCalls = []
  /** @type {Array<Error>} */
  const errors = []
  const syncModel = buildFakeSyncModel()
  const ticketRecord = {
    assignedAttributes: /** @type {Record<string, ?> | null} */ (null),
    /** @param {Record<string, ?>} attributes - Applied attributes. @returns {void} */
    assign(attributes) {
      this.assignedAttributes = attributes
    },
    isChanged: () => true,
    save: async () => {},
    saved: false
  }
  const state = {
    changesResponses: /** @type {Array<Record<string, ?>>} */ ([]),
    online: true,
    replayResponse: /** @type {Record<string, ?> | ((payload: Record<string, ?>) => Record<string, ?>)} */ ({status: "success", syncs: []})
  }
  const client = new SyncClient({
    authenticationToken: () => "token-1",
    configuration: buildConfiguration(),
    isOnline: () => state.online,
    onError: (error) => {
      errors.push(error)
    },
    postChanges: async (payload) => {
      postChangesCalls.push(payload)

      return state.changesResponses.shift() || {nextCursor: null, status: "success", syncs: [], upToCursor: null}
    },
    postReplay: async (payload) => {
      postReplayCalls.push(payload)

      if (typeof state.replayResponse === "function") return state.replayResponse(payload)

      return {
        ...state.replayResponse,
        syncs: state.replayResponse.syncs.length > 0
          ? state.replayResponse.syncs
          : payload.syncs.map((sync) => ({id: sync.id, syncState: "successful"}))
      }
    },
    resources: {
      Ticket: {
        attributes: ({data}) => ({name: data.name}),
        findRecord: async () => ticketRecord,
        modelClass: Ticket
      },
      TicketScan: {
        booleanAttributes: ["accepted"],
        localOnlyAttributes: ["localOnly"],
        modelClass: TicketScan,
        syncType: ({operation}) => operation === "create" ? "scanAttempt" : "update"
      }
    },
    syncModel,
    ...overrides
  })

  return {client, errors, postChangesCalls, postReplayCalls, state, syncModel, ticketRecord}
}

/**
 * Builds a fake scan record for queueing tests.
 * @returns {?} Fake TicketScan record.
 */
function buildScanRecord() {
  const record = Object.create(TicketScan.prototype)

  record.id = () => "scan-1"
  record.attributes = () => ({accepted: 1, localOnly: "internal", ticketId: "t-1"})

  return record
}

describe("sync client", () => {
  it("declares a scope and pulls it with the scope in the changes payload", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "New name"}, id: "s-1", resourceId: "t-1", resourceType: "Ticket", syncType: "update"}],
      upToCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"}
    })

    const result = await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))

    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.postChangesCalls[0].authenticationToken).toEqual("token-1")
    expect(harness.postChangesCalls[0].scope).toEqual({conditions: {partner_id: 5}, resourceType: "Ticket"})
    expect(harness.ticketRecord.assignedAttributes).toEqual({name: "New name"})
    expect(result.pulled?.syncedCount).toEqual(1)
  })

  it("sends the persisted scope cursor on subsequent pulls", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "New name"}, id: "s-1", resourceId: "t-1", resourceType: "Ticket", syncType: "update"}],
      upToCursor: null
    })

    await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))
    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(2)
    expect(harness.postChangesCalls[1].afterId).toEqual("s-1")
    expect(harness.postChangesCalls[1].afterServerSequence).toEqual(3)
    expect(harness.postChangesCalls[1].afterUpdatedAt).toEqual("2026-07-01T10:00:00.000Z")
  })

  it("seeds new scope cursors from the legacyCursor hook", async () => {
    const harness = buildHarness({
      legacyCursor: async () => JSON.stringify({id: "legacy-1", serverSequence: 7, updatedAt: "2026-06-30T10:00:00.000Z"})
    })

    await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))

    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.postChangesCalls[0].afterId).toEqual("legacy-1")
    expect(harness.postChangesCalls[0].afterServerSequence).toEqual(7)
  })

  it("does not pull while offline and pulls declared scopes once online", async () => {
    const harness = buildHarness()

    harness.state.online = false

    const result = await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))

    expect(result.pulled).toEqual(null)
    expect(harness.postChangesCalls.length).toEqual(0)

    harness.state.online = true

    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.postChangesCalls[0].scope).toEqual({conditions: {partner_id: 5}, resourceType: "Ticket"})
  })

  it("pulls every active scope with its own cursor and stops pulling unsynced scopes", async () => {
    const harness = buildHarness()

    harness.state.online = false
    await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))
    await harness.client.sync(fakeQuery("Ticket", {partner_id: 6}))
    harness.state.online = true

    await harness.client.pull()

    expect(harness.postChangesCalls.map((call) => call.scope.conditions.partner_id)).toEqual([5, 6])

    await harness.client.unsync(fakeQuery("Ticket", {partner_id: 5}))
    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(3)
    expect(harness.postChangesCalls[2].scope.conditions.partner_id).toEqual(6)
  })

  it("queues local changes declaratively and replays them immediately when online", async () => {
    const harness = buildHarness()
    const syncRow = await harness.client.queue({resource: buildScanRecord(), syncType: "scanAttempt"})

    expect(syncRow.attributes.data).toEqual({accepted: true, ticketId: "t-1"})
    expect(syncRow.attributes.syncType).toEqual("scanAttempt")

    await harness.client.waitForScheduledReplay()

    expect(harness.postReplayCalls.length).toEqual(1)
    expect(harness.postReplayCalls[0].syncs[0].resourceType).toEqual("TicketScan")
    expect(syncRow.attributes.state).toEqual("success")
    expect(harness.errors).toEqual([])
  })

  it("keeps queued rows pending while offline", async () => {
    const harness = buildHarness()

    harness.state.online = false

    const syncRow = await harness.client.queue({resource: buildScanRecord()})

    await harness.client.waitForScheduledReplay()

    expect(harness.postReplayCalls.length).toEqual(0)
    expect(syncRow.attributes.state).toEqual("pending")
  })

  it("keeps rows pending and reports the error when the replay request fails", async () => {
    const harness = buildHarness()

    harness.state.replayResponse = () => {
      throw new Error("Network down")
    }

    const syncRow = await harness.client.queue({resource: buildScanRecord()})

    await harness.client.waitForScheduledReplay()

    expect(harness.errors.map((error) => error.message)).toEqual(["Network down"])
    expect(syncRow.attributes.state).toEqual("pending")
  })

  it("keeps rows pending when the backend does not acknowledge success", async () => {
    const harness = buildHarness()

    harness.state.replayResponse = (payload) => ({
      status: "success",
      syncs: payload.syncs.map((sync) => ({id: sync.id, syncState: "failed"}))
    })

    const syncRow = await harness.client.queue({resource: buildScanRecord()})

    await harness.client.waitForScheduledReplay()

    expect(harness.errors.length).toEqual(1)
    expect(syncRow.attributes.state).toEqual("pending")
  })

  it("fails loudly instead of skipping pulled changes without an applyable resource", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 1, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "Someone"}, id: "s-1", resourceId: "c-1", resourceType: "Customer", syncType: "update"}],
      upToCursor: null
    })

    await expect(async () => await harness.client.sync(fakeQuery("Ticket", {partner_id: 5})))
      .toThrow(/No sync resource with pull attributes configured for pulled change: Customer/u)

    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(2)
    expect(harness.postChangesCalls[1].afterId).toEqual(undefined)
  })

  it("fails loudly when queueing a resource type that is not configured", async () => {
    const harness = buildHarness()

    class UnknownModel {
      /** @returns {string} Stable model name. */
      static getModelName() {
        return "UnknownModel"
      }
    }

    const record = Object.create(UnknownModel.prototype)

    await expect(async () => await harness.client.queue({resource: record}))
      .toThrow(/No sync resource configured for: UnknownModel/u)
  })

  it("fails loudly on invalid configuration", async () => {
    await expect(() => new SyncClient(/** @type {?} */ ({}))).toThrow(/postChanges/u)
    await expect(() => new SyncClient(/** @type {?} */ ({
      authenticationToken: () => "token",
      postChanges: async () => ({}),
      postReplay: async () => ({}),
      resources: {},
      syncModel: {}
    }))).toThrow(/resources/u)
  })

  it("exposes a current sync client singleton", async () => {
    const harness = buildHarness()

    harness.client.setCurrent()

    expect(SyncClient.current()).toEqual(harness.client)
  })

  it("automatically queues tracked model mutations and replays them", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")
    const harness = buildHarness({
      resources: {
        TrackedScan: {
          booleanAttributes: ["accepted"],
          localOnlyAttributes: ["localOnly"],
          modelClass: TrackedScan,
          syncType: ({operation}) => operation === "create" ? "scanAttempt" : "update",
          track: true
        }
      }
    })

    await harness.client.start()

    const record = buildTrackedRecord(TrackedScan, {accepted: 1, localOnly: "internal", ticketId: "t-1"})

    await triggerLifecycle(TrackedScan, "afterCreate", record)
    await harness.client.waitForScheduledReplay()

    expect(harness.syncModel.rows.length).toEqual(1)
    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("scanAttempt")
    expect(harness.syncModel.rows[0].attributes.data).toEqual({accepted: true, ticketId: "t-1"})
    expect(harness.syncModel.rows[0].attributes.state).toEqual("success")
    expect(harness.postReplayCalls.length).toEqual(1)
  })

  it("tracks only the configured operations", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")
    const harness = buildHarness({
      resources: {
        TrackedScan: {modelClass: TrackedScan, track: {operations: ["update"]}}
      }
    })

    await harness.client.start()

    expect(Object.keys(TrackedScan.lifecycleCallbacks)).toEqual(["afterUpdate"])
  })

  it("maps tracked destroys to delete sync rows", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")
    const harness = buildHarness({
      resources: {
        TrackedScan: {modelClass: TrackedScan, track: true}
      }
    })

    harness.state.online = false

    await harness.client.start()

    const record = buildTrackedRecord(TrackedScan, {ticketId: "t-1"})

    await triggerLifecycle(TrackedScan, "afterDestroy", record)

    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("delete")
  })

  it("maps the upsert syncType flag to update and delete wire types", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")
    const harness = buildHarness({
      resources: {
        TrackedScan: {modelClass: TrackedScan, syncType: "upsert", track: true}
      }
    })

    harness.state.online = false

    await harness.client.start()

    const record = buildTrackedRecord(TrackedScan, {ticketId: "t-1"})

    await triggerLifecycle(TrackedScan, "afterCreate", record)

    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("update")

    await triggerLifecycle(TrackedScan, "afterDestroy", record)

    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("delete")
  })

  it("rejects syncType strings other than upsert", async () => {
    await expect(() => buildHarness({
      resources: {
        TicketScan: {modelClass: TicketScan, syncType: "update"}
      }
    })).toThrow(/upsert/u)
  })

  it("uses trackedData to build tracked payloads", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")
    const harness = buildHarness({
      resources: {
        TrackedScan: {
          modelClass: TrackedScan,
          track: true,
          trackedData: ({operation, record}) => ({deviceId: "device-1", operation, ticketId: record.attributes().ticketId})
        }
      }
    })

    harness.state.online = false

    await harness.client.start()

    const record = buildTrackedRecord(TrackedScan, {ticketId: "t-1"})

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows[0].attributes.data).toEqual({deviceId: "device-1", operation: "update", ticketId: "t-1"})
  })

  it("does not queue tracked mutations for records written by pull-apply", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")
    const record = buildTrackedRecord(TrackedScan, {ticketId: "t-1"})

    record.assign = () => {}
    record.isChanged = () => true
    record.save = async () => {
      await triggerLifecycle(TrackedScan, "afterUpdate", record)
    }

    const harness = buildHarness({
      resources: {
        TrackedScan: {
          attributes: ({data}) => ({ticketId: data.ticketId}),
          findRecord: async () => record,
          modelClass: TrackedScan,
          track: true
        }
      }
    })

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 1, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {ticketId: "t-2"}, id: "s-1", resourceId: "scan-1", resourceType: "TrackedScan", syncType: "update"}],
      upToCursor: null
    })

    await harness.client.start()
    await harness.client.sync(fakeQuery("TrackedScan", {event_id: 5}))
    await harness.client.waitForScheduledReplay()

    expect(harness.syncModel.rows.length).toEqual(0)

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows.length).toEqual(1)
  })

  it("unregisters tracking callbacks when stopped", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")
    const harness = buildHarness({
      resources: {
        TrackedScan: {modelClass: TrackedScan, track: true}
      }
    })

    await harness.client.start()

    expect(TrackedScan.lifecycleCallbacks.afterCreate.length).toEqual(1)

    harness.client.stop()

    expect(TrackedScan.lifecycleCallbacks.afterCreate.length).toEqual(0)
    expect(TrackedScan.lifecycleCallbacks.afterUpdate.length).toEqual(0)
    expect(TrackedScan.lifecycleCallbacks.afterDestroy.length).toEqual(0)
  })

  it("fails loudly on invalid track configuration", async () => {
    const TrackedScan = buildTrackedModelClass("TrackedScan")

    const harness = buildHarness({
      resources: {
        TrackedScan: {modelClass: TrackedScan, track: {operations: ["upsert"]}}
      }
    })

    await expect(async () => await harness.client.start()).toThrow(/track\.operations/u)
  })
})

/**
 * Builds a fake model class implementing the lifecycle-callback registration contract.
 * @param {string} name - Model class name.
 * @returns {?} Fake trackable model class.
 */
function buildTrackedModelClass(name) {
  const klass = class {
    /** @type {Record<string, Array<Function>>} */
    static lifecycleCallbacks = {}

    /** @returns {string} Stable model name. */
    static getModelName() {
      return name
    }

    /** @param {Function} callback - Lifecycle callback. @returns {void} */
    static afterCreate(callback) {
      (this.lifecycleCallbacks.afterCreate ||= []).push(callback)
    }

    /** @param {Function} callback - Lifecycle callback. @returns {void} */
    static afterUpdate(callback) {
      (this.lifecycleCallbacks.afterUpdate ||= []).push(callback)
    }

    /** @param {Function} callback - Lifecycle callback. @returns {void} */
    static afterDestroy(callback) {
      (this.lifecycleCallbacks.afterDestroy ||= []).push(callback)
    }

    /** @param {string} callbackName - Callback type. @param {Function} callback - Registered callback. @returns {void} */
    static unregisterLifecycleCallback(callbackName, callback) {
      const callbacks = this.lifecycleCallbacks[callbackName]

      if (!callbacks) return

      const index = callbacks.indexOf(callback)

      if (index >= 0) callbacks.splice(index, 1)
    }
  }

  Object.defineProperty(klass, "name", {value: name})

  return klass
}

/**
 * Builds a fake record instance of a tracked model class.
 * @param {?} modelClass - Tracked model class.
 * @param {Record<string, ?>} attributes - Record attributes.
 * @returns {?} Fake record.
 */
function buildTrackedRecord(modelClass, attributes) {
  const record = Object.create(modelClass.prototype)

  record.id = () => "scan-1"
  record.attributes = () => attributes

  return record
}

/**
 * Invokes the registered lifecycle callbacks like the record layer would.
 * @param {?} modelClass - Tracked model class.
 * @param {string} callbackName - Callback type.
 * @param {?} record - Mutated record.
 * @returns {Promise<void>}
 */
async function triggerLifecycle(modelClass, callbackName, record) {
  for (const callback of modelClass.lifecycleCallbacks[callbackName] || []) {
    await callback(record)
  }
}
