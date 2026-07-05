// @ts-check

import SyncApiClient from "./sync-api-client.js"

/** @typedef {import("../configuration-types.js").VelociousSyncRealtimeChannelDescriptor} VelociousSyncRealtimeChannelDescriptor */
/** @typedef {import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient} VelociousSyncRealtimeWebsocketClient */

/**
 * Derived realtime push bridge for the sync client. Subscribes the declared
 * websocket channels (config `sync.client.realtime.channels` callback plus
 * model-level `static sync = {realtime: {channel}}` declarations), applies
 * pushed changes through the same derived resource applier as pulls (with echo
 * suppression against tracked re-queueing), drops own-device messages by echo
 * origin, and fires a coalesced `pull()` when subscriptions become ready or
 * resume so offline gaps close.
 */
export default class SyncRealtimeBridge {
  /**
   * Builds the bridge for a sync client.
   * @param {{syncClient: import("./sync-client.js").default}} args - Bridge args.
   */
  constructor({syncClient}) {
    this.syncClient = syncClient
    /** @type {Array<{channel: string, resourceType: string | null, subscription: import("../configuration-types.js").VelociousSyncRealtimeSubscription}>} */
    this._channels = []
    /** @type {VelociousSyncRealtimeWebsocketClient | null} */
    this._client = null
    /** @type {Promise<void>} */
    this._applyPromise = Promise.resolve()
    /** @type {number} Subscription generation - bumped by unsubscribe so in-flight subscribes detect they became stale. */
    this._generation = 0
    /** @type {Promise<void> | null} */
    this._scheduledPull = null
    /** @type {Promise<void> | null} */
    this._subscribePromise = null
    /** @type {"subscribed" | "subscribing" | "unsubscribed"} */
    this._state = "unsubscribed"
  }

  /**
   * Subscribes the derived realtime channels (idempotent and single-flighted):
   * an active subscription is kept as-is and a concurrent subscribe awaits the
   * in-flight attempt. Call `unsubscribe()` first to change the context.
   * @param {?} [context] - App context passed to the `sync.client.realtime.channels` callback (runtime values like eventId).
   * @returns {Promise<void>}
   */
  async subscribe(context) {
    if (this._state === "subscribed") return

    if (!this._subscribePromise) {
      this._subscribePromise = this._subscribe(context).finally(() => {
        this._subscribePromise = null
      })
    }

    await this._subscribePromise
  }

  /**
   * Connects the websocket client, subscribes every derived channel, and waits
   * for each subscription's server acknowledgement before the gap-closing pull,
   * so no change can land between the pull and the subscriptions going live.
   * Locally created resources are only promoted to the bridge once everything
   * is live; an unsubscribe arriving during any await marks this attempt stale
   * and it tears its own resources down instead of resubscribing.
   * @param {?} context - App context passed to the channels callback.
   * @returns {Promise<void>}
   */
  async _subscribe(context) {
    const generation = this._generation

    this._state = "subscribing"

    /** @type {Array<{channel: string, resourceType: string | null, subscription: import("../configuration-types.js").VelociousSyncRealtimeSubscription}>} */
    const channels = []
    /** @type {VelociousSyncRealtimeWebsocketClient | null} */
    let client = null
    /**
     * Tears down everything this stale/failed subscribe attempt created itself.
     * @returns {Promise<void>}
     */
    const teardown = async () => {
      for (const {subscription} of channels) {
        subscription.close()
      }

      if (client) await client.disconnectAndStopReconnect()
    }

    try {
      const realtime = this.realtimeConfiguration()
      const channelDescriptors = await this.channelDescriptors(context)

      if (generation !== this._generation) return

      client = await realtime.createClient()

      if (generation !== this._generation) return

      await client.connect()

      if (generation !== this._generation) {
        await teardown()
        return
      }

      const authenticationToken = await this.syncClient.config.authenticationToken()

      if (generation !== this._generation) {
        await teardown()
        return
      }

      for (const channelDescriptor of channelDescriptors) {
        if (channelDescriptor.params && "authenticationToken" in channelDescriptor.params) {
          throw new Error(`Realtime channel "${channelDescriptor.channel}" params must not include authenticationToken - the framework injects the sync.client authenticationToken automatically`)
        }

        const resourceType = channelDescriptor.resourceType ?? null
        const subscription = client.subscribeChannel(channelDescriptor.channel, {
          onMessage: (body) => this.enqueueApply({body, resourceType}),
          onResume: () => this.schedulePull(),
          params: {...channelDescriptor.params, authenticationToken}
        })

        channels.push({channel: channelDescriptor.channel, resourceType, subscription})
      }

      await Promise.all(channels.map(({subscription}) => subscription.waitForReady()))

      if (generation !== this._generation) {
        await teardown()
        return
      }

      this._channels = channels
      this._client = client
      this._state = "subscribed"
      this.schedulePull()
    } catch (error) {
      await teardown()

      if (generation === this._generation) this._state = "unsubscribed"

      throw error
    }
  }

  /**
   * Closes every channel subscription and disconnects the websocket client
   * (idempotent). Also marks any in-flight subscribe attempt stale so it tears
   * itself down instead of finishing the subscription afterwards.
   * @returns {Promise<void>}
   */
  async unsubscribe() {
    this._generation += 1

    const channels = this._channels
    const client = this._client

    this._channels = []
    this._client = null
    this._state = "unsubscribed"

    for (const {subscription} of channels) {
      subscription.close()
    }

    if (client) await client.disconnectAndStopReconnect()
  }

  /**
   * Reports the bridge subscription state and per-channel readiness.
   * @returns {{channels: Array<{channel: string, ready: boolean, resourceType: string | null}>, state: "subscribed" | "subscribing" | "unsubscribed"}} Realtime status.
   */
  status() {
    return {
      channels: this._channels.map(({channel, resourceType, subscription}) => ({channel, ready: subscription.isReady(), resourceType})),
      state: this._state
    }
  }

  /**
   * Awaits all enqueued message applies and any scheduled pull (tests, shutdown flows).
   * @returns {Promise<void>}
   */
  async waitForApplied() {
    await this._applyPromise
    if (this._scheduledPull) await this._scheduledPull
  }

  /**
   * Resolves the realtime configuration, failing loudly when it is missing.
   * @returns {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration} Realtime configuration.
   */
  realtimeConfiguration() {
    const realtime = this.syncClient.config.realtime

    if (!realtime) {
      throw new Error("subscribeRealtime requires a sync.client.realtime configuration block with a createClient callback")
    }

    return realtime
  }

  /**
   * Derives the channel descriptors to subscribe: model-level static realtime
   * declarations plus the config channels callback, failing loudly when none exist.
   * @param {?} context - App context passed to the channels callback.
   * @returns {Promise<Array<VelociousSyncRealtimeChannelDescriptor>>} Channel descriptors.
   */
  async channelDescriptors(context) {
    const realtime = this.realtimeConfiguration()
    /** @type {Array<VelociousSyncRealtimeChannelDescriptor>} */
    const channelDescriptors = []

    for (const [resourceType, resourceConfig] of Object.entries(this.syncClient.config.resources)) {
      if (!resourceConfig.realtime) continue

      channelDescriptors.push({channel: resourceConfig.realtime.channel, params: resourceConfig.realtime.params, resourceType})
    }

    if (realtime.channels) {
      channelDescriptors.push(...await realtime.channels(context))
    }

    if (channelDescriptors.length === 0) {
      throw new Error("subscribeRealtime found no realtime channels - declare sync.client.realtime.channels or static sync = {realtime: {channel}} on a model")
    }

    return channelDescriptors
  }

  /**
   * Chains one pushed message onto the serialized apply queue so changes apply
   * in arrival order; failures go to the sync client's error reporting.
   * @param {{body: ?, resourceType: string | null}} args - Message args.
   * @returns {void}
   */
  enqueueApply({body, resourceType}) {
    this._applyPromise = this._applyPromise.then(async () => {
      try {
        await this.applyMessage({body, resourceType})
      } catch (error) {
        this.syncClient.reportError(/** @type {Error} */ (error))
      }
    })
  }

  /**
   * Applies one pushed message through the derived resource applier: drops
   * own-device messages by echo origin, defaults the channel's resourceType onto
   * envelopes without one, and fails loudly on unknown resource types.
   * @param {{body: ?, resourceType: string | null}} args - Message args.
   * @returns {Promise<void>}
   */
  async applyMessage({body, resourceType}) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error(`Realtime sync messages must be envelope objects, got: ${JSON.stringify(body)}`)
    }

    const realtime = this.realtimeConfiguration()

    if (realtime.localOrigin && body.echoOrigin !== undefined && body.echoOrigin !== null) {
      const localOrigin = String(await realtime.localOrigin())

      if (String(body.echoOrigin) === localOrigin) return
    }

    const syncPayloads = Array.isArray(body.syncs) ? body.syncs : [body]
    const applySync = this.syncClient.remoteApplySync({source: "remote change"})

    for (const syncPayload of syncPayloads) {
      const sync = SyncApiClient.syncEnvelopeFromPayload({resourceType, ...syncPayload})

      await applySync(sync)
    }
  }

  /**
   * Schedules a coalesced background pull closing offline gaps after
   * (re)subscription readiness. Resumes arriving while a pull is already
   * scheduled or in flight coalesce into that pull instead of stacking.
   * @returns {void}
   */
  schedulePull() {
    if (this.realtimeConfiguration().pullOnReconnect === false) return

    this._scheduledPull ||= (async () => {
      try {
        await this.syncClient.pull()
      } catch (error) {
        this.syncClient.reportError(/** @type {Error} */ (error))
      } finally {
        this._scheduledPull = null
      }
    })()
  }
}
