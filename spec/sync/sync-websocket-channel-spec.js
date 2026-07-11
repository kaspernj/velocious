// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SyncResourceBase from "../../src/sync/sync-resource-base.js"
import SyncWebsocketChannel from "../../src/sync/sync-websocket-channel.js"
import {VELOCIOUS_SYNC_CHANNEL} from "../../src/sync/sync-channel-name.js"

const ALLOWED_EVENT_ID = "a3bb189e-8bf9-3888-9912-ace4e6543002"
const DENIED_EVENT_ID = "886313e1-3b8a-5372-9b90-0c9aee199e5d"
const SCAN_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"

class TestSyncModel {}

/**
 * Builds an in-memory change-feed query that AND-matches accumulated
 * conditions, mutating in place like the Velocious model query.
 * @param {Array<Record<string, ?>>} rows - Feed rows.
 * @returns {{where: (condition: Record<string, ?>) => ?, first: () => Promise<Record<string, ?> | null>}} Fake feed query.
 */
function buildFeedQuery(rows) {
  /** @type {Array<Record<string, ?>>} */
  const conditions = []
  const query = {
    /** @param {Record<string, ?>} condition - Added condition. @returns {?} Query for chaining. */
    where: (condition) => {
      conditions.push(condition)

      return query
    },
    /** @returns {Promise<Record<string, ?> | null>} First matching row. */
    first: async () => rows.find((row) => conditions.every((condition) => Object.entries(condition).every(([key, value]) => (
      Array.isArray(value) ? value.map(String).includes(String(row[key])) : String(row[key]) === String(value)
    )))) || null
  }

  return query
}

/**
 * Builds a fake change-feed model class over in-memory rows.
 * @param {Array<Record<string, ?>>} rows - Feed rows keyed by column name.
 * @returns {?} Fake change-feed model class.
 */
function buildFeedModelClass(rows) {
  return class FeedModel {
    /** @returns {string} Feed table name. */
    static tableName() {
      return "velocious_syncs"
    }

    /** @returns {string} Primary key column. */
    static primaryKey() {
      return "id"
    }

    /** @param {Record<string, ?>} condition - Initial condition. @returns {?} Feed query. */
    static where(condition) {
      const query = buildFeedQuery(rows)

      query.where(condition)

      return query
    }
  }
}

/**
 * Builds a test sync resource class recording authorizeChanges calls and
 * denying the denied event scope like an app authorization would.
 * @returns {{calls: Array<{context: Record<string, ?>, params: Record<string, ?>, scope: import("../../src/sync/sync-resource-base.js").SerializedChangesScope | null}>, TestSyncResource: typeof SyncResourceBase}} Recording resource class and its calls.
 */
function buildTestSyncResource() {
  /** @type {Array<{context: Record<string, ?>, params: Record<string, ?>, scope: import("../../src/sync/sync-resource-base.js").SerializedChangesScope | null}>} */
  const calls = []

  class TestSyncResource extends SyncResourceBase {
    static ModelClass = /** @type {?} */ (TestSyncModel)

    /** @param {{params: Record<string, ?>, scope: import("../../src/sync/sync-resource-base.js").SerializedChangesScope | null}} args - Request params and parsed scope. @returns {Promise<void>} */
    async authorizeChanges({params, scope}) {
      calls.push({context: /** @type {Record<string, ?>} */ (this.getContext()), params, scope})

      if (scope?.conditions.eventId === DENIED_EVENT_ID) {
        throw new Error("Current context may not read changes for this event")
      }
    }
  }

  return {calls, TestSyncResource}
}

/**
 * Builds a configuration with a sync.api resource class and an optional ability resolver.
 * @param {object} [args] - Configuration args.
 * @param {?} [args.abilityResolver] - Ability resolver receiving the subscribe params.
 * @param {?} [args.sync] - Sync configuration override.
 * @returns {Configuration} Configuration instance.
 */
function buildChannelConfiguration({abilityResolver, sync} = {}) {
  return new Configuration({
    abilityResolver,
    database: {test: {}},
    directory: "/tmp/velocious-sync-websocket-channel-spec",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    locales: ["en"],
    sync
  })
}

/**
 * Builds a framework sync channel bound to a fake websocket session.
 * @param {{configuration: Configuration, params: Record<string, ?>}} args - Channel args.
 * @returns {SyncWebsocketChannel} Framework sync channel instance.
 */
function buildChannel({configuration, params}) {
  const session = /** @type {?} */ ({configuration, upgradeRequest: undefined})

  return new SyncWebsocketChannel({params, session, subscriptionId: "s1"})
}

/**
 * Builds a framework sync channel whose session captures delivered messages.
 * @param {{configuration: Configuration, params: Record<string, ?>}} args - Channel args.
 * @returns {{channel: SyncWebsocketChannel, messages: Array<Record<string, ?>>}} Channel and captured message bodies.
 */
function buildDeliveringChannel({configuration, params}) {
  /** @type {Array<Record<string, ?>>} */
  const messages = []
  const session = /** @type {?} */ ({configuration, sendJson: (/** @type {Record<string, ?>} */ message) => messages.push(message), upgradeRequest: undefined})

  return {channel: new SyncWebsocketChannel({params, session, subscriptionId: "s1"}), messages}
}

/**
 * Builds a user-scope-capable sync resource class scoping the feed by the
 * ability's allowed event ids, over the given in-memory feed rows.
 * @param {Array<Record<string, ?>>} rows - Feed rows.
 * @returns {typeof SyncResourceBase} User-scope sync resource class.
 */
function buildUserScopeResource(rows) {
  const feedModel = buildFeedModelClass(rows)

  return class UserScopeResource extends SyncResourceBase {
    static ModelClass = /** @type {?} */ (feedModel)

    /** @returns {Promise<void>} Allows every scope (including the user scope). */
    async authorizeChanges() {}

    /** @param {{query: ?}} args - Feed query. @returns {void} Scopes the feed by the ability's allowed event ids. */
    scopeChangesQuery({query}) {
      query.where({event_id: /** @type {{allowedEventIds: string[]}} */ (this.getContext()).allowedEventIds})
    }
  }
}

describe("sync websocket channel", () => {
  it("registers the framework sync channel when sync.api is configured and skips registration without it", () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})

    SyncWebsocketChannel.registerFromConfiguration(configuration)

    expect(configuration.getWebsocketChannelClass(VELOCIOUS_SYNC_CHANNEL)).toEqual(SyncWebsocketChannel)

    const configurationWithoutSyncApi = buildChannelConfiguration()

    SyncWebsocketChannel.registerFromConfiguration(configurationWithoutSyncApi)

    expect(configurationWithoutSyncApi.getWebsocketChannelClass(VELOCIOUS_SYNC_CHANNEL)).toEqual(undefined)
  })

  it("authorizes subscriptions through the app sync resource authorizeChanges with the parsed scope and resolved ability context", async () => {
    const {calls, TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({
      abilityResolver: (/** @type {{params: Record<string, ?>}} */ {params}) => ({
        getContext: () => ({authenticatedToken: params.authenticationToken, partnerEventPytIds: [123]}),
        getLocals: () => ({})
      }),
      sync: {api: {resourceClass: TestSyncResource}}
    })
    const channel = buildChannel({
      configuration,
      params: {authenticationToken: "token-1", conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}
    })

    expect(await channel.canSubscribe()).toEqual(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].scope).toEqual({conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"})
    expect(calls[0].params.authenticationToken).toEqual("token-1")
    expect(calls[0].context.authenticatedToken).toEqual("token-1")
    expect(calls[0].context.partnerEventPytIds).toEqual([123])
  })

  it("rejects subscriptions whose scope the app authorization denies", async () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const channel = buildChannel({
      configuration,
      params: {authenticationToken: "token-1", conditions: {eventId: DENIED_EVENT_ID}, resourceType: "Ticket"}
    })

    await expect(async () => await channel.canSubscribe()).toThrow(/may not read changes/u)
  })

  it("fails loudly on malformed scope params and a missing sync.api configuration", async () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})

    await expect(async () => await buildChannel({configuration, params: {conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: ""}}).canSubscribe())
      .toThrow(/resourceType/u)
    await expect(async () => await buildChannel({configuration, params: {resourceType: "Ticket"}}).canSubscribe())
      .toThrow(/conditions must be an object/u)
    await expect(async () => await buildChannel({configuration: buildChannelConfiguration(), params: {conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}}).canSubscribe())
      .toThrow(/sync\.api/u)
  })

  it("matches broadcasts whose scoping params satisfy every subscription scope condition", async () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const channel = buildChannel({
      configuration,
      params: {authenticationToken: "token-1", conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}
    })

    await channel.canSubscribe()

    expect(channel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "Ticket"})).toEqual(true)
    expect(channel.matches({eventId: DENIED_EVENT_ID, resourceType: "Ticket"})).toEqual(false)
    expect(channel.matches({resourceType: "Ticket"})).toEqual(false)
    expect(channel.matches({resourceType: "Ticket", somethingElse: ALLOWED_EVENT_ID})).toEqual(false)
  })

  it("matches numeric scope conditions by value and array conditions by membership for any app-named scope attribute", async () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const numberChannel = buildChannel({
      configuration,
      params: {conditions: {accountId: 5}, resourceType: "Ticket"}
    })
    const arrayChannel = buildChannel({
      configuration,
      params: {conditions: {accountId: [ALLOWED_EVENT_ID, DENIED_EVENT_ID]}, resourceType: "Ticket"}
    })

    await numberChannel.canSubscribe()
    await arrayChannel.canSubscribe()

    expect(numberChannel.matches({accountId: "5", resourceType: "Ticket"})).toEqual(true)
    expect(numberChannel.matches({accountId: "6", resourceType: "Ticket"})).toEqual(false)
    expect(arrayChannel.matches({accountId: DENIED_EVENT_ID, resourceType: "Ticket"})).toEqual(true)
    expect(arrayChannel.matches({accountId: "not-subscribed", resourceType: "Ticket"})).toEqual(false)
  })

  it("routes broadcasts only to subscriptions authorized for the published resource type", async () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const ticketChannel = buildChannel({
      configuration,
      params: {conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}
    })
    const ticketScanChannel = buildChannel({
      configuration,
      params: {conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "TicketScan"}
    })

    await ticketChannel.canSubscribe()
    await ticketScanChannel.canSubscribe()

    expect(ticketChannel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "Ticket"})).toEqual(true)
    expect(ticketScanChannel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "Ticket"})).toEqual(false)
    expect(ticketChannel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "TicketScan"})).toEqual(false)
    expect(ticketScanChannel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "TicketScan"})).toEqual(true)
  })

  it("fails closed on broadcasts without a resource type", async () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const channel = buildChannel({
      configuration,
      params: {conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}
    })

    await channel.canSubscribe()

    expect(channel.matches({eventId: ALLOWED_EVENT_ID})).toEqual(false)
  })

  it("does not match broadcasts before an authorized subscription established its scope", () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const channel = buildChannel({
      configuration,
      params: {conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}
    })

    expect(channel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "Ticket"})).toEqual(false)
  })

  it("authorizes a user scope (empty conditions) through authorizeChanges and matches every broadcast of the resource type", async () => {
    const {calls, TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const channel = buildChannel({
      configuration,
      params: {authenticationToken: "token-1", conditions: {}, resourceType: "Ticket"}
    })

    expect(await channel.canSubscribe()).toEqual(true)
    expect(calls[0].scope).toEqual({conditions: {}, resourceType: "Ticket"})
    expect(channel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "Ticket"})).toEqual(true)
    expect(channel.matches({eventId: DENIED_EVENT_ID, resourceType: "Ticket"})).toEqual(true)
    expect(channel.matches({resourceType: "Ticket"})).toEqual(true)
    expect(channel.matches({eventId: ALLOWED_EVENT_ID, resourceType: "TicketScan"})).toEqual(false)
  })

  it("re-checks record access per delivery for user scopes so disjoint-access subscribers each receive only theirs", async () => {
    const configuration = buildChannelConfiguration({
      abilityResolver: (/** @type {{params: Record<string, ?>}} */ {params}) => ({
        getContext: () => ({allowedEventIds: params.authenticationToken === "token-a" ? [ALLOWED_EVENT_ID] : [DENIED_EVENT_ID]}),
        getLocals: () => ({})
      }),
      sync: {api: {resourceClass: buildUserScopeResource([{event_id: ALLOWED_EVENT_ID, id: "feed-1", resource_id: SCAN_ID, resource_type: "Ticket"}])}}
    })
    const {channel: channelA, messages: messagesA} = buildDeliveringChannel({
      configuration,
      params: {authenticationToken: "token-a", conditions: {}, resourceType: "Ticket"}
    })
    const {channel: channelB, messages: messagesB} = buildDeliveringChannel({
      configuration,
      params: {authenticationToken: "token-b", conditions: {}, resourceType: "Ticket"}
    })

    await channelA.canSubscribe()
    await channelB.canSubscribe()

    const broadcast = {echoOrigin: null, syncs: [{data: {pin: "1234"}, resourceId: SCAN_ID, resourceType: "Ticket", syncType: "update"}]}

    // Both user-scope subscriptions match the broadcast; only per-delivery access filters it.
    expect(channelA.matches({eventId: ALLOWED_EVENT_ID, resourceType: "Ticket"})).toEqual(true)
    expect(channelB.matches({eventId: ALLOWED_EVENT_ID, resourceType: "Ticket"})).toEqual(true)

    await channelA.deliverBroadcast(broadcast)
    await channelB.deliverBroadcast(broadcast)

    expect(messagesA).toHaveLength(1)
    expect(messagesA[0].body).toEqual(broadcast)
    expect(messagesB).toHaveLength(0)
  })

  it("delivers scoped (non-user) broadcasts unchanged without a per-delivery access query", async () => {
    const {channel, messages} = buildDeliveringChannel({
      configuration: buildChannelConfiguration({sync: {api: {resourceClass: buildUserScopeResource([])}}}),
      params: {authenticationToken: "token-a", conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}
    })

    await channel.canSubscribe()

    const broadcast = {echoOrigin: null, syncs: [{data: {pin: "1"}, resourceId: SCAN_ID, resourceType: "Ticket", syncType: "update"}]}

    // No feed row exists, but a scoped subscription must deliver without re-checking access.
    await channel.deliverBroadcast(broadcast)

    expect(messages).toHaveLength(1)
    expect(messages[0].body).toEqual(broadcast)
  })
})
