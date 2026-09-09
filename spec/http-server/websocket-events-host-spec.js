// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {deferred, timeout} from "awaitery"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {VelociousHttpServerWebsocketEventsHost} from "../../src/http-server/websocket-events-host.js"

/**
 * Test host that gates event persistence per channel through explicit
 * deferred signals so tests control exactly when queued publish work
 * proceeds — without sleeps or runtime instance overrides.
 */
class GatedPersistEventsHost extends VelociousHttpServerWebsocketEventsHost {
  constructor() {
    super()
    /** @type {Map<string, ReturnType<typeof deferred>>} */
    this.persistGates = new Map()
    /** @type {Array<string>} */
    this.persistOrder = []
    /** @type {ReturnType<typeof deferred>} */
    this.firstPersistStarted = deferred()
  }

  /**
   * Gates persistence for the given channel until the returned gate resolves.
   * @param {string} channel - Channel name to gate.
   * @returns {ReturnType<typeof deferred>} - Gate controlling when persistence may proceed.
   */
  gateChannel(channel) {
    const gate = deferred()

    this.persistGates.set(channel, gate)

    return gate
  }

  /**
   * Records the persistence attempt and waits for any gate on the channel.
   * @param {string} marker - Marker recorded for persistence order assertions.
   * @param {string} channel - Channel name.
   * @returns {Promise<void>}
   */
  async _awaitPersistGate(marker, channel) {
    this.persistOrder.push(marker)
    this.firstPersistStarted.resolve(undefined)

    const gate = this.persistGates.get(channel)

    if (gate) await gate.promise
  }

  /**
   * Runs persist event if needed.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
   * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
   */
  async _persistEventIfNeeded({channel, payload}) {
    await this._awaitPersistGate(`${channel}:${payload.n}`, channel)

    return null
  }

  /**
   * Runs persist v2 event if needed.
   * @param {object} args - Options.
   * @param {ReturnType<typeof JSON.parse>} args.body - Event body.
   * @param {string} args.channel - Channel name.
   * @param {import("../../src/configuration.js").default} args.configuration - Originating configuration.
   * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata when storage is enabled.
   */
  async _persistV2EventIfNeeded({body, channel}) {
    await this._awaitPersistGate(`${channel}:${body.n}`, channel)

    return null
  }
}

class AccessScopePersistEventsHost extends VelociousHttpServerWebsocketEventsHost {
  persistGate = deferred()
  /** @type {{revoked: boolean} | null | undefined} */
  observedAccessScope = null
  /** @type {() => {revoked: boolean} | undefined} */
  currentAccessScope

  /** @param {() => {revoked: boolean} | undefined} currentAccessScope - Current access-scope reader. */
  constructor(currentAccessScope) {
    super()
    this.currentAccessScope = currentAccessScope
  }

  /** @returns {Promise<null>} - No persisted event metadata. */
  async _persistV2EventIfNeeded() {
    await this.persistGate.promise
    this.observedAccessScope = this.currentAccessScope()

    return null
  }
}

describe("HttpServer - websocket events host", {databaseCleaning: {transaction: true}}, () => {
  it("keeps broadcast handlers separate from subscription debug state", () => {
    const host = new VelociousHttpServerWebsocketEventsHost()
    const subscription = {debugSnapshot: () => ({topic: "debug"})}
    const handler = {
      configuration: dummyConfiguration,
      dispatchWebsocketV2Broadcast: () => {},
      websocketV2BroadcastDispatchKey: () => dummyConfiguration
    }

    dummyConfiguration._registerWebsocketChannelSubscription("RegistrySeparation", /** @type {ReturnType<typeof JSON.parse>} */ (subscription))
    const unregister = host.register(/** @type {ReturnType<typeof JSON.parse>} */ (handler))

    expect(dummyConfiguration._websocketChannelSubscriptions.get("RegistrySeparation")).toEqual(new Set([subscription]))
    expect(host.broadcastHandlersByConfiguration.get(dummyConfiguration)).toEqual(new Set([handler]))
    expect(dummyConfiguration.getLocalDebugSnapshot().websockets.subscriptions.find(({channel}) => channel === "RegistrySeparation")).toEqual({
      channel: "RegistrySeparation",
      count: 1,
      details: [{count: 1, details: {topic: "debug"}}]
    })

    unregister()
    dummyConfiguration._unregisterWebsocketChannelSubscription("RegistrySeparation", /** @type {ReturnType<typeof JSON.parse>} */ (subscription))
    expect(host.broadcastHandlersByConfiguration.has(dummyConfiguration)).toEqual(false)
  })

  it("isolates configuration-local broadcasts and deduplicates shared in-process handlers", async () => {
    const host = new VelociousHttpServerWebsocketEventsHost()
    const configurationA = {
      withoutCurrentConnectionContexts: async (callback) => await callback(),
      withoutCurrentTestDatabaseAccessScope: async (callback) => await callback()
    }
    const configurationB = {
      withoutCurrentConnectionContexts: async (callback) => await callback(),
      withoutCurrentTestDatabaseAccessScope: async (callback) => await callback()
    }
    const deliveries = []

    for (const mountContext of ["a-1", "a-2"]) {
      host.register({
        configuration: configurationA,
        dispatchWebsocketV2Broadcast: ({body}) => deliveries.push({body, configuration: "A", mountContext}),
        websocketV2BroadcastDispatchKey: () => configurationA
      })
    }

    host.register({
      configuration: configurationB,
      dispatchWebsocketV2Broadcast: ({body}) => deliveries.push({body, configuration: "B", mountContext: "b-1"}),
      websocketV2BroadcastDispatchKey: () => configurationB
    })

    host.broadcastV2({
      body: {count: 1},
      broadcastParams: {subscription: "shared"},
      channel: "Counter",
      configuration: configurationA
    })
    host.broadcastV2({
      body: {count: 2},
      broadcastParams: {subscription: "shared"},
      channel: "Counter",
      configuration: configurationB
    })
    await host.awaitPendingBroadcasts()

    expect(deliveries).toEqual([
      {body: {count: 1}, configuration: "A", mountContext: "a-1"},
      {body: {count: 2}, configuration: "B", mountContext: "b-1"}
    ])
  })

  it("does not let a blocked channel delay an independent channel", async () => {
    const host = new GatedPersistEventsHost()
    const configuration = {
      withoutCurrentConnectionContexts: async (callback) => await callback(),
      withoutCurrentTestDatabaseAccessScope: async (callback) => await callback()
    }
    /** @type {Array<string>} */
    const deliveries = []
    const channelBDelivered = deferred()

    host.register(/** @type {ReturnType<typeof JSON.parse>} */ ({
      configuration,
      dispatchWebsocketV2Broadcast: ({channel}) => {
        deliveries.push(channel)

        if (channel === "ChannelB") channelBDelivered.resolve(undefined)
      },
      websocketV2BroadcastDispatchKey: () => configuration
    }))

    const gateA = host.gateChannel("ChannelA")

    host.broadcastV2({body: {n: 1}, broadcastParams: {}, channel: "ChannelA", configuration})
    host.broadcastV2({body: {n: 2}, broadcastParams: {}, channel: "ChannelB", configuration})

    // ChannelB must complete even though ChannelA persistence is still gated.
    await timeout({timeout: 2000}, () => channelBDelivered.promise)
    expect(deliveries).toEqual(["ChannelB"])

    gateA.resolve(undefined)
    await host.awaitPendingBroadcasts()
    expect(deliveries).toEqual(["ChannelB", "ChannelA"])
  })

  it("does not suppress configuration contexts while queued publish work waits for its channel turn", async () => {
    const host = new GatedPersistEventsHost()
    const contextEntries = {connection: 0, testDatabaseAccessScope: 0}
    const configurationA = {
      withoutCurrentConnectionContexts: async (callback) => await callback(),
      withoutCurrentTestDatabaseAccessScope: async (callback) => await callback()
    }
    const configurationB = {
      withoutCurrentConnectionContexts: async (callback) => {
        contextEntries.connection += 1
        return await callback()
      },
      withoutCurrentTestDatabaseAccessScope: async (callback) => {
        contextEntries.testDatabaseAccessScope += 1
        return await callback()
      }
    }

    host.register(/** @type {ReturnType<typeof JSON.parse>} */ ({
      configuration: configurationA,
      dispatchWebsocketV2Broadcast: () => {},
      websocketV2BroadcastDispatchKey: () => configurationA
    }))
    host.register(/** @type {ReturnType<typeof JSON.parse>} */ ({
      configuration: configurationB,
      dispatchWebsocketV2Broadcast: () => {},
      websocketV2BroadcastDispatchKey: () => configurationB
    }))

    const gate = host.gateChannel("SharedContextChannel")

    host.broadcastV2({body: {n: 1}, broadcastParams: {}, channel: "SharedContextChannel", configuration: configurationA})
    await timeout({timeout: 2000}, () => host.firstPersistStarted.promise)
    host.broadcastV2({body: {n: 2}, broadcastParams: {}, channel: "SharedContextChannel", configuration: configurationB})

    expect(contextEntries).toEqual({connection: 0, testDatabaseAccessScope: 0})

    gate.resolve(undefined)
    await host.awaitPendingBroadcasts()
    expect(contextEntries).toEqual({connection: 1, testDatabaseAccessScope: 1})
  })

  it("keeps exact FIFO persistence and delivery on a channel shared by legacy publish and V2 broadcasts", async () => {
    const host = new GatedPersistEventsHost()
    const configurationA = {
      withoutCurrentConnectionContexts: async (callback) => await callback(),
      withoutCurrentTestDatabaseAccessScope: async (callback) => await callback()
    }
    const configurationB = {
      withoutCurrentConnectionContexts: async (callback) => await callback(),
      withoutCurrentTestDatabaseAccessScope: async (callback) => await callback()
    }
    /** @type {Array<string>} */
    const deliveries = []

    host.register(/** @type {ReturnType<typeof JSON.parse>} */ ({
      configuration: configurationA,
      dispatchWebsocketEvent: ({payload}) => deliveries.push(`legacy-a:${payload.n}`),
      dispatchWebsocketV2Broadcast: ({body}) => deliveries.push(`v2-a:${body.n}`),
      websocketV2BroadcastDispatchKey: () => configurationA
    }))
    host.register(/** @type {ReturnType<typeof JSON.parse>} */ ({
      configuration: configurationB,
      dispatchWebsocketEvent: ({payload}) => deliveries.push(`legacy-b:${payload.n}`),
      dispatchWebsocketV2Broadcast: ({body}) => deliveries.push(`v2-b:${body.n}`),
      websocketV2BroadcastDispatchKey: () => configurationB
    }))

    const gate = host.gateChannel("SharedChannel")

    host.broadcastV2({body: {n: 1}, broadcastParams: {}, channel: "SharedChannel", configuration: configurationA})
    host.publish("SharedChannel", {n: 2})
    host.broadcastV2({body: {n: 3}, broadcastParams: {}, channel: "SharedChannel", configuration: configurationB})

    // While the gate is closed only the first publish may have started persistence.
    await timeout({timeout: 2000}, () => host.firstPersistStarted.promise)
    expect(host.persistOrder).toEqual(["SharedChannel:1"])

    gate.resolve(undefined)
    await host.awaitPendingBroadcasts()

    expect(host.persistOrder).toEqual(["SharedChannel:1", "SharedChannel:2", "SharedChannel:3"])
    expect(deliveries).toEqual(["v2-a:1", "legacy-a:2", "legacy-b:2", "v2-b:3"])
  })

  it("snapshots channel tails, waits for every snapshotted channel, excludes later work, and cleans up settled queues", async () => {
    const host = new GatedPersistEventsHost()
    const configuration = {
      withoutCurrentConnectionContexts: async (callback) => await callback(),
      withoutCurrentTestDatabaseAccessScope: async (callback) => await callback()
    }
    /** @type {Array<string>} */
    const deliveries = []
    const channelBDelivered = deferred()

    host.register(/** @type {ReturnType<typeof JSON.parse>} */ ({
      configuration,
      dispatchWebsocketV2Broadcast: ({channel}) => {
        deliveries.push(channel)

        if (channel === "ChannelB") channelBDelivered.resolve(undefined)
      },
      websocketV2BroadcastDispatchKey: () => configuration
    }))

    const gateA = host.gateChannel("ChannelA")
    const gateC = host.gateChannel("ChannelC")

    host.broadcastV2({body: {n: 1}, broadcastParams: {}, channel: "ChannelA", configuration})
    host.broadcastV2({body: {n: 2}, broadcastParams: {}, channel: "ChannelB", configuration})

    let barrierSettled = false
    const barrier = host
      .awaitPendingBroadcasts()
      .then(() => {
        barrierSettled = true
      })

    // The barrier must not settle while snapshotted ChannelA is still gated.
    await timeout({timeout: 2000}, () => channelBDelivered.promise)
    expect(barrierSettled).toEqual(false)

    // Work enqueued after the snapshot must not extend the barrier.
    host.broadcastV2({body: {n: 3}, broadcastParams: {}, channel: "ChannelC", configuration})

    gateA.resolve(undefined)
    await timeout({timeout: 2000}, () => barrier)

    expect(barrierSettled).toEqual(true)
    expect(deliveries).toEqual(["ChannelB", "ChannelA"])

    gateC.resolve(undefined)
    await host.awaitPendingBroadcasts()

    expect(deliveries).toEqual(["ChannelB", "ChannelA", "ChannelC"])
    expect(host.publishQueuesByChannel.size).toEqual(0)
  })

  it("creates queued persistence outside the caller's test database-access scope", async () => {
    const environmentHandler = dummyConfiguration.getEnvironmentHandler()
    const accessScope = {revoked: false}
    const host = new AccessScopePersistEventsHost(() => environmentHandler.currentTestDatabaseAccessScope())

    await dummyConfiguration.runWithTestDatabaseAccessScope(accessScope, async () => {
      host.broadcastV2({body: {n: 1}, broadcastParams: {}, channel: "AccessScope", configuration: dummyConfiguration})
    })
    accessScope.revoked = true
    host.persistGate.resolve(undefined)
    await host.awaitPendingBroadcasts()

    expect(host.observedAccessScope).toEqual(undefined)
  })
})
