// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncResourceBase from "../../src/sync/sync-resource-base.js"
import SyncWebsocketChannel from "../../src/sync/sync-websocket-channel.js"

const PROJECT_A = "a3bb189e-8bf9-3888-9912-ace4e6543002"
const PROJECT_B = "886313e1-3b8a-5372-9b90-0c9aee199e5d"
const RESOURCE_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"

/**
 * User-scope sync resource scoping the real dummy sync feed by the caller's
 * allowed project ids (carried on the subscribe params for the spec, standing
 * in for an app's ability scoping).
 */
class ProjectUserScopeResource extends SyncResourceBase {
  static ModelClass = /** @type {?} */ (SyncEntry)

  /** @param {{params: Record<string, ?>, query: ?}} args - Feed query and params. @returns {void} */
  scopeChangesQuery({params, query}) {
    query.where({project_id: params.allowedProjectIds})
  }
}

/**
 * Builds a resource instance without the frontend-model pipeline.
 * @param {Record<string, ?>} params - Request params.
 * @returns {ProjectUserScopeResource} Resource instance.
 */
function buildResource(params) {
  return /** @type {ProjectUserScopeResource} */ (Object.assign(Object.create(ProjectUserScopeResource.prototype), {params: () => params}))
}

/**
 * Framework sync channel that returns a hand-built resource so the spec
 * exercises the real per-delivery DB path without the sync.api/ability
 * plumbing.
 */
class TestSyncWebsocketChannel extends SyncWebsocketChannel {
  /** @returns {Promise<?>} Hand-built user-scope resource. */
  async buildSyncResource() {
    return buildResource(this.params)
  }
}

/**
 * Builds a channel already in the authorized user-scope state, over the real
 * dummy configuration, whose session captures delivered messages.
 * @param {Record<string, ?>} params - Subscribe params.
 * @returns {{channel: TestSyncWebsocketChannel, configuration: Configuration, messages: Array<Record<string, ?>>}} Channel, configuration, and captured messages.
 */
function buildChannel(params) {
  /** @type {Array<Record<string, ?>>} */
  const messages = []
  const configuration = Configuration.current()
  const session = /** @type {?} */ ({configuration, sendJson: (/** @type {Record<string, ?>} */ message) => messages.push(message), upgradeRequest: undefined})
  const channel = new TestSyncWebsocketChannel({params, session, subscriptionId: "s1"})

  channel._scope = {conditions: {}, resourceType: "Task"}

  return {channel, configuration, messages}
}

describe("sync websocket channel - user-scope delivery over a real database", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("re-checks record access with a live query under a checked-out connection at broadcast fan-out", async () => {
    const entry = new SyncEntry({
      authenticationTokenId: null,
      clientUpdatedAt: new Date("2026-07-06T10:00:00.000Z"),
      projectId: PROJECT_A,
      resourceId: RESOURCE_ID,
      resourceType: "Task",
      syncType: "update"
    })

    await entry.save()

    const allowed = buildChannel({authenticationToken: "token-a", allowedProjectIds: [PROJECT_A], conditions: {}, resourceType: "Task"})
    const denied = buildChannel({authenticationToken: "token-b", allowedProjectIds: [PROJECT_B], conditions: {}, resourceType: "Task"})
    const broadcast = {echoOrigin: null, syncs: [{data: {name: "Changed"}, resourceId: RESOURCE_ID, resourceType: "Task", syncType: "update"}]}

    // Reproduce the real broadcast fan-out: delivery runs with the ambient
    // connection context stripped (Configuration#_broadcastToChannelLocal calls
    // withoutCurrentConnectionContexts). The per-delivery access query must
    // re-acquire a connection instead of failing with no current connection.
    await allowed.configuration.withoutCurrentConnectionContexts(() => allowed.channel.deliverBroadcast(broadcast))
    await denied.configuration.withoutCurrentConnectionContexts(() => denied.channel.deliverBroadcast(broadcast))

    expect(allowed.messages).toHaveLength(1)
    expect(allowed.messages[0].body).toEqual(broadcast)
    expect(denied.messages).toHaveLength(0)
  })
})
