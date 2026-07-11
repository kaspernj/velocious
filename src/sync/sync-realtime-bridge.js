// @ts-check

import recordChanges from "../database/record-changes.js"

import SyncApiClient from "./sync-api-client.js"
import {VELOCIOUS_SYNC_CHANNEL} from "./sync-channel-name.js"

/** @typedef {import("../configuration-types.js").VelociousSyncRealtimeChannelDescriptor} VelociousSyncRealtimeChannelDescriptor */
/** @typedef {import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient} VelociousSyncRealtimeWebsocketClient */

/**
 * Derived realtime push bridge for the sync client. Subscribes every declared
 * pull scope to the framework sync channel ({@link VELOCIOUS_SYNC_CHANNEL})
 * automatically — the subscribe params mirror the scope's
 * `{resourceType, conditions}` so the server authorizes them through the same
 * sync resource authorization as pulls — plus any deprecated legacy channels
 * (config `sync.client.realtime.channels` callback and model-level
 * `static sync = {realtime: {channel}}` declarations). Pushed changes apply
 * through the same derived resource applier as pulls (with echo suppression
 * against tracked re-queueing), own-device messages are dropped by echo
 * origin, and a coalesced `pull()` fires when subscriptions become ready or
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
    /** @type {boolean} Whether the bridge created its own client (deprecated per-cycle path) and must disconnect it on unsubscribe. A shared connection is never owned. */
    this._ownsClient = false
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
   * @param {?} [context] - App context passed to the deprecated `sync.client.realtime.channels` callback (runtime scope values).
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
    /** @type {boolean} Whether this attempt created its own client and must disconnect it on teardown. */
    let ownsClient = false
    /**
     * Tears down everything this stale/failed subscribe attempt created itself:
     * always closes its channel subscriptions, and disconnects the websocket
     * only when the bridge owns it (deprecated per-cycle path); a shared
     * connection stays open.
     * @returns {Promise<void>}
     */
    const teardown = async () => {
      for (const {subscription} of channels) {
        subscription.close()
      }

      if (client && ownsClient) await client.disconnectAndStopReconnect()
    }

    try {
      const sharedClient = this.syncClient.syncConnection()
      const realtime = this.requireClientSource(sharedClient)
      const channelDescriptors = await this.channelDescriptors(context)

      if (generation !== this._generation) return

      if (sharedClient) {
        client = sharedClient
      } else {
        // requireClientSource guaranteed realtime.createClient when there is no shared connection.
        client = await /** @type {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration} */ (realtime).createClient()
        ownsClient = true
      }

      if (generation !== this._generation) {
        await teardown()
        return
      }

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
      this._ownsClient = ownsClient
      this._state = "subscribed"
      this.schedulePull()
    } catch (error) {
      await teardown()

      if (generation === this._generation) this._state = "unsubscribed"

      throw error
    }
  }

  /**
   * Closes every channel subscription (idempotent). The websocket is
   * disconnected only when the bridge owns it (deprecated per-cycle
   * `realtime.createClient` path); a shared app-lifetime connection stays open
   * so unsubscribing drops subscriptions without tearing down the socket. Also
   * marks any in-flight subscribe attempt stale so it tears itself down instead
   * of finishing the subscription afterwards.
   * @returns {Promise<void>}
   */
  async unsubscribe() {
    this._generation += 1

    const channels = this._channels
    const client = this._client
    const ownsClient = this._ownsClient

    this._channels = []
    this._client = null
    this._ownsClient = false
    this._state = "unsubscribed"

    for (const {subscription} of channels) {
      subscription.close()
    }

    if (client && ownsClient) await client.disconnectAndStopReconnect()
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
   * Resolves the realtime configuration block, or null when the app declared
   * none (valid when a shared connection is configured).
   * @returns {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null} Realtime configuration, or null.
   */
  realtimeConfiguration() {
    return this.syncClient.config.realtime || null
  }

  /**
   * Resolves the realtime configuration and asserts a websocket client source
   * exists: a shared connection rides its own lifecycle, otherwise the
   * deprecated per-cycle `realtime.createClient` must be configured.
   * @param {import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient | null} sharedClient - Shared connection, or null.
   * @returns {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null} Realtime configuration, or null.
   */
  requireClientSource(sharedClient) {
    const realtime = this.realtimeConfiguration()

    if (!sharedClient && typeof realtime?.createClient !== "function") {
      throw new Error("subscribeRealtime requires a shared connection (sync.client.websocketUrl or sync.client.websocketClient) or the deprecated sync.client.realtime.createClient callback")
    }

    return realtime
  }

  /**
   * Derives the channel descriptors to subscribe: one framework sync channel
   * subscription per declared pull scope (the params mirror the scope's
   * `{resourceType, conditions}`), plus the deprecated legacy paths —
   * model-level static realtime declarations and the config channels callback.
   * Fails loudly when nothing is subscribable.
   * @param {?} context - App context passed to the deprecated channels callback.
   * @returns {Promise<Array<VelociousSyncRealtimeChannelDescriptor>>} Channel descriptors.
   */
  async channelDescriptors(context) {
    const realtime = this.realtimeConfiguration()
    /** @type {Array<VelociousSyncRealtimeChannelDescriptor>} */
    const channelDescriptors = []

    for (const scopeRow of await this.syncClient.scopeStore().activeScopes()) {
      channelDescriptors.push({
        channel: VELOCIOUS_SYNC_CHANNEL,
        params: {conditions: this.attributeNamedConditions(scopeRow), resourceType: scopeRow.resourceType}
      })
    }

    for (const [resourceType, resourceConfig] of Object.entries(this.syncClient.config.resources)) {
      if (!resourceConfig.realtime) continue

      channelDescriptors.push({channel: resourceConfig.realtime.channel, params: resourceConfig.realtime.params, resourceType})
    }

    if (realtime?.channels) {
      channelDescriptors.push(...await realtime.channels(context))
    }

    if (channelDescriptors.length === 0) {
      throw new Error("subscribeRealtime found no channels to subscribe - declare a sync scope (syncClient().sync(query)) so its framework sync channel subscription can be derived, or the deprecated sync.client.realtime.channels callback")
    }

    return channelDescriptors
  }

  /**
   * Translates a persisted scope's condition keys to the model's attribute
   * names so the framework channel subscription matches the publisher's
   * attribute-named scoping params: `serializedScopeFromQuery` persists the
   * query's model-normalized column names (for example `project_id`), while
   * scope-partition broadcasts carry attribute names (`projectId`). Keys
   * without a column mapping are already attribute names and pass through;
   * scopes on models without a declared sync resource fail loudly because no
   * attribute mapping exists for them.
   *
   * The all-types (user) scope has no resource type and no conditions - it
   * covers everything the server authorizes for the caller - so there is
   * nothing to map.
   * @param {{conditions: Record<string, ?>, resourceType: string | null}} scopeRow - Active scope row.
   * @returns {Record<string, ?>} Attribute-named scope conditions.
   */
  attributeNamedConditions(scopeRow) {
    if (scopeRow.resourceType === null) return {}

    const resourceConfig = this.syncClient.config.resources[scopeRow.resourceType]

    if (!resourceConfig) {
      throw new Error(`subscribeRealtime can't derive attribute names for the sync scope declared on ${scopeRow.resourceType} - declare static sync on that model so its resource is registered`)
    }

    const columnNameToAttributeName = resourceConfig.modelClass.getColumnNameToAttributeNameMap()
    /** @type {Record<string, ?>} */
    const conditions = {}

    for (const [conditionName, conditionValue] of Object.entries(scopeRow.conditions)) {
      conditions[columnNameToAttributeName[conditionName] || conditionName] = conditionValue
    }

    return conditions
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

    if (realtime?.localOrigin && body.echoOrigin !== undefined && body.echoOrigin !== null) {
      const localOrigin = String(await realtime.localOrigin())

      if (String(body.echoOrigin) === localOrigin) return
    }

    const syncPayloads = Array.isArray(body.syncs) ? body.syncs : [body]
    const applySync = this.syncClient.remoteApplySync({source: "remote change"})

    // Coalesce record-change events across the pushed batch so it triggers one live-query re-run.
    await recordChanges.batch(async () => {
      for (const syncPayload of syncPayloads) {
        const sync = SyncApiClient.syncEnvelopeFromPayload({resourceType, ...syncPayload})

        await applySync(sync)
      }
    })
  }

  /**
   * Schedules a coalesced background pull closing offline gaps after
   * (re)subscription readiness. Resumes arriving while a pull is already
   * scheduled or in flight coalesce into that pull instead of stacking.
   * @returns {void}
   */
  schedulePull() {
    if (this.realtimeConfiguration()?.pullOnReconnect === false) return

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
