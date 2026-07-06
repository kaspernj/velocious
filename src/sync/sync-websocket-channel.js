// @ts-check

import VelociousWebsocketChannel from "../http-server/websocket-channel.js"
import {VELOCIOUS_SYNC_CHANNEL} from "./sync-channel-name.js"

/** Configurations whose framework sync channel has already been registered. */
const registeredConfigurations = new WeakSet()

/**
 * Framework-owned websocket channel for synced resources
 * ({@link VELOCIOUS_SYNC_CHANNEL}).
 *
 * Subscribe params mirror a declared pull scope — `{resourceType, conditions}`
 * plus the client-injected `authenticationToken` — and subscribe-time
 * authorization delegates to the app sync resource's existing
 * `authorizeChanges({params, scope})` (the `sync.api.resourceClass`), so apps
 * hook in through the authorization they already declared instead of writing
 * their own channel classes. Broadcast routing matches the publisher's
 * scoping params against the subscription's scope conditions.
 */
export default class SyncWebsocketChannel extends VelociousWebsocketChannel {
  /**
   * Scope the subscription was authorized for, set by {@link SyncWebsocketChannel#canSubscribe}.
   * @type {import("./sync-resource-base.js").SerializedChangesScope | null}
   */
  _scope = null

  /**
   * Registers the framework sync channel on a configuration declaring a
   * `sync.api` block (guarded so repeated server boots with the same
   * configuration register it only once). No-op without `sync.api` — the
   * channel authorizes through the app's sync resource class.
   * @param {import("../configuration.js").default} configuration - Configuration instance.
   * @returns {void}
   */
  static registerFromConfiguration(configuration) {
    if (!configuration.getSyncConfiguration().api || registeredConfigurations.has(configuration)) return

    registeredConfigurations.add(configuration)
    configuration.registerWebsocketChannel(VELOCIOUS_SYNC_CHANNEL, this)
  }

  /**
   * Authorizes the subscription through the app sync resource: the subscribe
   * params are parsed into the same serialized scope the changes endpoint
   * consumes and passed to the resource's `authorizeChanges({params, scope})`.
   * Denials and malformed scopes throw, rejecting the subscription.
   * @returns {Promise<boolean>} Whether the subscription is allowed.
   */
  async canSubscribe() {
    const resource = await this.buildSyncResource()
    const scope = resource.changesScope({scope: {conditions: this.params.conditions, resourceType: this.params.resourceType}})

    await resource.authorizeChanges({params: this.params, scope})

    this._scope = scope

    return true
  }

  /**
   * Builds the app sync resource authorizing this subscription, mirroring the
   * sync transport controller's resource construction with the ability
   * resolved from the subscribe params (which carry the client-injected
   * authenticationToken).
   * @returns {Promise<import("./sync-resource-base.js").default>} App sync resource instance.
   */
  async buildSyncResource() {
    const configuration = this.session.configuration
    const api = configuration.getSyncConfiguration().api

    if (!api) {
      throw new Error(`The ${VELOCIOUS_SYNC_CHANNEL} channel requires a sync.api configuration block with the app's sync resource class`)
    }

    // Narrows the configured resource class to the sync resource contract
    // (changesScope/authorizeChanges) the sync.api validation requires.
    const ResourceClass = /** @type {typeof import("./sync-resource-base.js").default} */ (api.resourceClass)
    // Narrows the websocket subscribe params to the resource params contract.
    const params = /** @type {import("../configuration-types.js").VelociousParams} */ (/** @type {unknown} */ (this.params))
    const request = this.session.upgradeRequest
    const ability = await configuration.resolveAbility({params, request})

    return new ResourceClass({
      ability,
      context: {
        ...(ability?.getContext() || {}),
        params,
        request
      },
      locals: ability?.getLocals() || {},
      modelClass: ResourceClass.ModelClass,
      modelName: ResourceClass.ModelClass?.name,
      params,
      resourceConfiguration: /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({
        attributes: ResourceClass.attributes || {},
        sync: {enabled: true}
      })
    })
  }

  /**
   * Routes a publisher broadcast to this subscription when the published
   * resource type equals the type the subscription was authorized for and the
   * scoping params satisfy every scope condition: each condition key must be
   * present in the broadcast params and match by string comparison (array
   * conditions match by membership). Broadcasts without a resource type and
   * conditions the publisher's scoping params do not carry never match, so a
   * subscription cannot receive changes outside its authorized scope.
   * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} broadcastParams - Publisher scoping params (the published resourceType plus the change's scope-partition values).
   * @returns {boolean} Whether the broadcast belongs to this subscription's scope.
   */
  matches(broadcastParams) {
    const scope = this._scope

    if (!scope) return false

    const scopingParams = broadcastParams && typeof broadcastParams === "object" && !Array.isArray(broadcastParams)
      ? /** @type {Record<string, ?>} */ (broadcastParams)
      : {}

    if (!Object.hasOwn(scopingParams, "resourceType") || String(scopingParams.resourceType) !== String(scope.resourceType)) return false

    for (const [conditionName, conditionValue] of Object.entries(scope.conditions)) {
      if (!Object.hasOwn(scopingParams, conditionName)) return false

      const scopingValue = scopingParams[conditionName]

      if (Array.isArray(conditionValue)) {
        if (!conditionValue.some((value) => String(value) === String(scopingValue))) return false
      } else if (String(conditionValue) !== String(scopingValue)) {
        return false
      }
    }

    return true
  }

  /**
   * Delivers a matched broadcast. Scoped subscriptions (with explicit
   * conditions) already routed through {@link SyncWebsocketChannel#matches}, so
   * the change is in scope and delivers unchanged. User-scope subscriptions
   * (empty conditions, "everything my ability can see") match every broadcast
   * of the resource type, so each published change is re-checked against the
   * subscriber's ability at fan-out through the app sync resource's
   * `changeDeliverable`; only accessible changes are delivered, and a broadcast
   * with no accessible change is dropped.
   * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body (sync envelope).
   * @param {{eventId?: string}} [meta] - Optional event metadata.
   * @returns {Promise<void>}
   */
  async deliverBroadcast(body, meta) {
    if (!this._isUserScope()) {
      this.sendMessage(body, meta)

      return
    }

    const deliverableBody = await this._userScopeDeliverableBody(body)

    if (deliverableBody !== null) this.sendMessage(deliverableBody, meta)
  }

  /**
   * Whether this subscription is a user scope: authorized with empty conditions
   * ("everything my ability can see").
   * @returns {boolean} Whether the subscription is a user scope.
   */
  _isUserScope() {
    return Boolean(this._scope) && Object.keys(/** @type {import("./sync-resource-base.js").SerializedChangesScope} */ (this._scope).conditions).length === 0
  }

  /**
   * Filters a user-scope broadcast to the sync entries the subscriber's ability
   * can access, re-checking each through the app sync resource's
   * `changeDeliverable`. Returns the broadcast narrowed to accessible entries,
   * or null when none are accessible. Non-envelope bodies and entries without a
   * resource id are dropped (fail closed).
   * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body.
   * @returns {Promise<import("../http-server/websocket-channel.js").WebsocketJsonValue | null>} Deliverable body, or null.
   */
  async _userScopeDeliverableBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null

    const envelope = /** @type {Record<string, ?>} */ (body)
    const scope = /** @type {import("./sync-resource-base.js").SerializedChangesScope} */ (this._scope)
    const syncs = Array.isArray(envelope.syncs) ? envelope.syncs : [envelope]
    const configuration = this.session.configuration
    /** @type {Array<Record<string, ?>>} */
    const deliverableSyncs = []

    // Broadcast fan-out runs through `withoutCurrentConnectionContexts` (see
    // Configuration#_broadcastToChannelLocal), so there is no ambient database
    // connection here. Resolve the resource's ability and run the per-delivery
    // access query inside a checked-out connection context, mirroring how other
    // broadcast-time DB work (the frontend-model channel) obtains connections.
    await configuration.ensureConnections({name: `${VELOCIOUS_SYNC_CHANNEL} user-scope delivery access check`}, async () => {
      const resource = await this.buildSyncResource()

      for (const sync of syncs) {
        const resourceId = sync?.resourceId
        const resourceType = sync?.resourceType ?? scope.resourceType

        if (resourceId === undefined || resourceId === null) continue

        if (await resource.changeDeliverable({params: this.params, scope, sync: {resourceId: String(resourceId), resourceType: String(resourceType)}})) {
          deliverableSyncs.push(sync)
        }
      }
    })

    if (deliverableSyncs.length === 0) return null
    if (Array.isArray(envelope.syncs)) return {...envelope, syncs: deliverableSyncs}

    return deliverableSyncs[0]
  }

  /**
   * Returns the authorized scope for debug snapshots.
   * @returns {Record<string, ?>} Debug-safe subscription details.
   */
  debugSnapshot() {
    return {scope: this._scope, userScope: this._isUserScope()}
  }
}
