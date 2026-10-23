// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel, buildMetadataModelClass} from "./sync-client-fakes.js"
import SyncApiClient from "../../src/sync/sync-api-client.js"
import SyncClient from "../../src/sync/sync-client.js"

const TICKET_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"

const TICKET_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "name", name: "name", type: "varchar"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

/**
 * Builds a normalized Ticket change envelope.
 * @param {{name: string, serverSequence?: number | null, syncId: string}} args - Envelope args.
 * @returns {import("../../src/sync/sync-api-client-types.js").SyncChangeEnvelope} Change envelope.
 */
function ticketEnvelope({name, serverSequence = null, syncId}) {
  return SyncApiClient.syncEnvelopeFromPayload({
    data: {name},
    id: syncId,
    resourceId: TICKET_ID,
    resourceType: "Ticket",
    serverSequence,
    syncType: "update",
    updatedAt: "2026-07-06T12:00:00.000Z"
  })
}

/**
 * Builds a client whose Ticket resource assigns `name` onto one recording row.
 * @returns {Promise<{applySync: (sync: import("../../src/sync/sync-api-client-types.js").SyncChangeEnvelope) => Promise<import("../../src/sync/sync-api-client-types.js").SyncChangeApplyResult>, appliedNames: string[], record: {attributes: Record<string, unknown>}}} Applied client harness.
 */
async function buildHarness() {
  /** @type {Array<string>} */
  const appliedNames = []
  const record = {
    /** @type {Record<string, unknown>} */
    attributes: {},
    /** @param {Record<string, unknown>} attributes - Applied attributes. @returns {void} */
    assign(attributes) {
      this.attributes = attributes
      appliedNames.push(String(attributes.name))
    },
    isChanged: () => true,
    save: async () => {}
  }
  const ticketModelClass = buildMetadataModelClass({
    columns: TICKET_COLUMNS,
    modelName: "Ticket",
    sync: {
      attributes: (/** @type {{data: Record<string, ReturnType<typeof JSON.parse>>}} */ {data}) => ({name: data.name}),
      findRecord: async () => record
    }
  })
  const configuration = buildConfiguration({
    modelClasses: [ticketModelClass],
    sync: {
      client: {
        authenticationToken: () => "token-1",
        isOnline: () => false,
        transport: {post: async () => { throw new Error("transport is not used") }}
      }
    }
  })
  const client = new SyncClient({configuration, syncModel: buildFakeSyncModel()})

  return {appliedNames, applySync: client.remoteApplySync(), record}
}

describe("SyncClient applied sequences", () => {
  it("exposes serverSequence and updatedAt on apply envelopes", () => {
    const envelope = ticketEnvelope({name: "inside", serverSequence: 42, syncId: "sync-42"})

    expect(envelope.serverSequence()).toEqual(42)
    expect(envelope.updatedAt()).toEqual("2026-07-06T12:00:00.000Z")
    expect(ticketEnvelope({name: "legacy", syncId: "sync-legacy"}).serverSequence()).toEqual(null)
  })

  it("skips duplicate and older changes for a record and applies newer ones", async () => {
    const harness = await buildHarness()

    expect(await harness.applySync(ticketEnvelope({name: "inside", serverSequence: 10, syncId: "sync-10"}))).toMatchObject({changed: true, resourceType: "Ticket"})
    expect(harness.record.attributes).toEqual({name: "inside"})

    // Realtime applied sequence 10, then the next pull re-delivers it.
    expect(await harness.applySync(ticketEnvelope({name: "stale-inside", serverSequence: 10, syncId: "sync-10"}))).toMatchObject({changed: false, resourceType: "Ticket"})
    expect(harness.record.attributes).toEqual({name: "inside"})

    expect(await harness.applySync(ticketEnvelope({name: "scanned-out", serverSequence: 11, syncId: "sync-11"}))).toMatchObject({changed: true, resourceType: "Ticket"})
    expect(harness.record.attributes).toEqual({name: "scanned-out"})

    // An older row must not move the record backwards.
    expect(await harness.applySync(ticketEnvelope({name: "older-inside", serverSequence: 9, syncId: "sync-9"}))).toMatchObject({changed: false, resourceType: "Ticket"})
    expect(harness.record.attributes).toEqual({name: "scanned-out"})
    expect(harness.appliedNames).toEqual(["inside", "scanned-out"])
  })

  it("keeps applying changes from sources without a server sequence", async () => {
    const harness = await buildHarness()

    await harness.applySync(ticketEnvelope({name: "first", syncId: "legacy-1"}))
    await harness.applySync(ticketEnvelope({name: "second", syncId: "legacy-2"}))

    expect(harness.record.attributes).toEqual({name: "second"})
    expect(harness.appliedNames).toEqual(["first", "second"])
  })
})
