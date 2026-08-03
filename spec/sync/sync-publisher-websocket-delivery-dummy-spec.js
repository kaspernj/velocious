// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncPublisher from "../../src/sync/sync-publisher.js"
import SyncResourceBase from "../../src/sync/sync-resource-base.js"
import SyncWebsocketChannel from "../../src/sync/sync-websocket-channel.js"
import UuidItem from "../dummy/src/models/uuid-item.js"
import {VELOCIOUS_SYNC_CHANNEL} from "../../src/sync/sync-channel-name.js"

const UUID_ITEM_ID = "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c"

/**
 * User-scope sync resource scoping the real dummy sync feed by the caller's
 * allowed project ids (carried on the subscribe params for the spec, standing
 * in for an app's ability scoping). Records every changeDeliverable sync entry
 * so the spec can prove the exact persisted sync envelope reaches delivery
 * authorization. Built with Object.create to avoid the full frontend-model
 * resource constructor contract in this harness.
 */
class RecordingUserScopeResource extends SyncResourceBase {
  static ModelClass = /** @type {?} */ (SyncEntry)

  /** @returns {Promise<void>} Allows every scope (including the user scope). */
  async authorizeChanges() {}

  /** @param {{params: Record<string, ?>, query: ?}} args - Feed query and params. @returns {void} */
  scopeChangesQuery({params, query}) {
    query.where({project_id: params.allowedProjectIds})
  }
}

/**
 * Builds a hand-built recording user-scope resource for the channel harness.
 * @param {Record<string, ?>} params - Request params.
 * @returns {RecordingUserScopeResource & {changeDeliverableSyncs: Array<Record<string, ?>>}} Recording resource.
 */
function buildRecordingResource(params) {
  const resource = /** @type {RecordingUserScopeResource & {changeDeliverableSyncs: Array<Record<string, ?>>}} */ (Object.assign(Object.create(RecordingUserScopeResource.prototype), {
    changeDeliverableSyncs: [],
    getContext: () => ({allowedProjectIds: params.allowedProjectIds}),
    params: () => params
  }))

  const baseChangeDeliverable = RecordingUserScopeResource.prototype.changeDeliverable

  resource.changeDeliverable = async ({sync}) => {
    resource.changeDeliverableSyncs.push(sync)

    return baseChangeDeliverable.call(resource, {params, scope: {conditions: {}, resourceType: "UuidItem", resourceTypes: null}, sync})
  }

  return resource
}

/**
 * Framework sync channel that returns the recording user-scope resource so the
 * spec exercises the real per-delivery DB path without the sync.api/ability
 * plumbing. The resource is memoized on the channel so the recording instance
 * survives from subscribe-time authorization through broadcast delivery.
 */
class TestSyncWebsocketChannel extends SyncWebsocketChannel {
  /** @returns {Promise<RecordingUserScopeResource & {changeDeliverableSyncs: Array<Record<string, ?>>}>} Hand-built user-scope resource. */
  async buildSyncResource() {
    this._resource ||= buildRecordingResource(this.params)

    return this._resource
  }
}

/**
 * Builds a started publisher watching the real dummy UuidItem model with the
 * real SyncEntry sync model. The publish declaration is assigned onto
 * UuidItem's static sync for the duration of the test and restored by the
 * returned restore callback.
 * @param {{broadcaster?: (broadcast: {body: ?, channel: string, params: Record<string, ?>}) => Promise<void>}} [args] - Optional broadcaster override.
 * @returns {{publisher: SyncPublisher, restore: () => void}} Publisher harness.
 */
function buildPublisher({broadcaster} = {}) {
  const originalSync = UuidItem.sync

  UuidItem.sync = {
    .../** @type {Record<string, ?>} */ (originalSync),
    publish: {serialize: (/** @type {UuidItem} */ uuidItem) => ({id: uuidItem.id(), title: uuidItem.title()})}
  }

  const publisher = new SyncPublisher({
    broadcaster,
    configuration: dummyConfiguration,
    syncModel: SyncEntry
  })

  return {
    publisher,
    restore: () => {
      publisher.stop()
      UuidItem.sync = originalSync
    }
  }
}

/**
 * Builds an authorized framework sync channel over the real dummy configuration
 * whose session captures delivered messages.
 * @param {Record<string, ?>} params - Subscribe params.
 * @returns {{channel: TestSyncWebsocketChannel, messages: Array<Record<string, ?>>}} Channel and captured messages.
 */
function buildSubscribedChannel(params) {
  /** @type {Array<Record<string, ?>>} */
  const messages = []
  const session = /** @type {?} */ ({
    configuration: dummyConfiguration,
    sendJson: (/** @type {Record<string, ?>} */ message) => messages.push(message),
    upgradeRequest: undefined
  })
  const channel = new TestSyncWebsocketChannel({params, session, subscriptionId: "s1"})

  return {channel, messages}
}

describe("sync publisher - websocket user-scope delivery over a real database", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("broadcasts the persisted sync row id and exact public metadata through the channel to changeDeliverable", async () => {
    const {channel, messages} = buildSubscribedChannel({
      allowedProjectIds: [UUID_ITEM_ID],
      authenticationToken: "token-a",
      conditions: {},
      resourceType: "UuidItem"
    })

    await channel.canSubscribe()

    const resource = /** @type {RecordingUserScopeResource} */ (channel._resource)

    const previousWebsocketEvents = dummyConfiguration.getWebsocketEvents()

    dummyConfiguration.setWebsocketEvents(undefined)
    dummyConfiguration._registerWebsocketChannelSubscription(VELOCIOUS_SYNC_CHANNEL, channel)

    const {publisher, restore} = buildPublisher()

    await publisher.start()

    try {
      await UuidItem.create({id: UUID_ITEM_ID, title: "Published item"})

      const syncRows = await SyncEntry.where({resource_id: UUID_ITEM_ID, resource_type: "UuidItem"}).toArray()

      expect(syncRows).toHaveLength(1)

      const syncRow = syncRows[0]

      // The persisted row's exact-row discriminator and public metadata reach the
      // per-delivery authorization re-check, so overrides can authorize by exact row.
      expect(resource.changeDeliverableSyncs).toHaveLength(1)
      expect(resource.changeDeliverableSyncs[0].id).toEqual(syncRow.id())
      expect(resource.changeDeliverableSyncs[0].serverSequence).toEqual(syncRow.serverSequence())
      expect(resource.changeDeliverableSyncs[0].updatedAt).toEqual(syncRow.updatedAt()?.toISOString())
      expect(resource.changeDeliverableSyncs[0].projectId).toEqual(UUID_ITEM_ID)

      expect(messages).toHaveLength(1)
      expect(messages[0].body.echoOrigin).toEqual(null)
      expect(messages[0].body.syncs).toHaveLength(1)

      const deliveredEntry = messages[0].body.syncs[0]

      // The delivered entry carries the same complete persisted sync envelope.
      expect(deliveredEntry.id).toEqual(syncRow.id())
      expect(deliveredEntry.serverSequence).toEqual(syncRow.serverSequence())
      expect(deliveredEntry.updatedAt).toEqual(syncRow.updatedAt()?.toISOString())
      expect(deliveredEntry.projectId).toEqual(UUID_ITEM_ID)
      expect(deliveredEntry.data).toEqual({id: UUID_ITEM_ID, title: "Published item"})
      expect(deliveredEntry.resourceId).toEqual(UUID_ITEM_ID)
      expect(deliveredEntry.resourceType).toEqual("UuidItem")
      expect(deliveredEntry.syncType).toEqual("update")
    } finally {
      restore()
      dummyConfiguration._unregisterWebsocketChannelSubscription(VELOCIOUS_SYNC_CHANNEL, channel)
      dummyConfiguration.setWebsocketEvents(previousWebsocketEvents)
    }
  })
})
