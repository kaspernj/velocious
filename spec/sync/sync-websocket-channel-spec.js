// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SyncResourceBase from "../../src/sync/sync-resource-base.js"
import SyncWebsocketChannel from "../../src/sync/sync-websocket-channel.js"
import {VELOCIOUS_SYNC_CHANNEL} from "../../src/sync/sync-channel-name.js"

const ALLOWED_EVENT_ID = "a3bb189e-8bf9-3888-9912-ace4e6543002"
const DENIED_EVENT_ID = "886313e1-3b8a-5372-9b90-0c9aee199e5d"

class TestSyncModel {}

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

    await expect(async () => await buildChannel({configuration, params: {conditions: {eventId: ALLOWED_EVENT_ID}}}).canSubscribe())
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

    expect(channel.matches({eventId: ALLOWED_EVENT_ID})).toEqual(true)
    expect(channel.matches({eventId: DENIED_EVENT_ID})).toEqual(false)
    expect(channel.matches({})).toEqual(false)
    expect(channel.matches({somethingElse: ALLOWED_EVENT_ID})).toEqual(false)
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

    expect(numberChannel.matches({accountId: "5"})).toEqual(true)
    expect(numberChannel.matches({accountId: "6"})).toEqual(false)
    expect(arrayChannel.matches({accountId: DENIED_EVENT_ID})).toEqual(true)
    expect(arrayChannel.matches({accountId: "not-subscribed"})).toEqual(false)
  })

  it("does not match broadcasts before an authorized subscription established its scope", () => {
    const {TestSyncResource} = buildTestSyncResource()
    const configuration = buildChannelConfiguration({sync: {api: {resourceClass: TestSyncResource}}})
    const channel = buildChannel({
      configuration,
      params: {conditions: {eventId: ALLOWED_EVENT_ID}, resourceType: "Ticket"}
    })

    expect(channel.matches({eventId: ALLOWED_EVENT_ID})).toEqual(false)
  })
})
