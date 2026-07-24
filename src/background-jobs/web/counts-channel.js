// @ts-check

import {BACKGROUND_JOB_COUNTS_CHANNEL} from "../store.js"
import VelociousWebsocketChannel from "../../http-server/websocket-channel.js"
import {authorizeJobsRequest} from "./authorization.js"
import {getJobsMount} from "./registry.js"
import {normalizeMountPrefix} from "./path-matcher.js"

/**
 * Authorized dashboard count-delta channel. Clients subscribe with the mount
 * path and their normal bearer token as `authenticationToken`.
 */
export default class BackgroundJobCountsChannel extends VelociousWebsocketChannel {
  /**
   * Authorizes the subscription.
   * @returns {Promise<boolean>} Whether the mount's normal dashboard authorization allows the subscription.
   */
  async canSubscribe() {
    if (typeof this.params.mountAt !== "string") return false

    const mountAt = normalizeMountPrefix(this.params.mountAt)
    const options = getJobsMount(this.session.configuration, mountAt)

    if (!options || !this.session.upgradeRequest) return false

    const token = typeof this.params.authenticationToken === "string"
      ? this.params.authenticationToken
      : null
    const ability = await this.session.configuration.resolveAbility({
      params: this.params,
      request: this.session.upgradeRequest
    })
    const authorized = await authorizeJobsRequest({
      ability,
      configuration: this.session.configuration,
      options,
      request: this.session.upgradeRequest,
      token
    })

    if (!authorized) return false

    this.databaseIdentifier = options.databaseIdentifier
      || this.session.configuration.getBackgroundJobsConfig().databaseIdentifier
      || "default"

    return true
  }

  /**
   * Matches only events from the database selected by the authorized mount.
   * @param {import("../../http-server/websocket-channel.js").WebsocketJsonValue} broadcastParams - Publisher scope.
   * @returns {boolean} Whether this subscription should receive the event.
   */
  matches(broadcastParams) {
    if (!broadcastParams || typeof broadcastParams !== "object" || Array.isArray(broadcastParams)) return false

    return String(/** @type {Record<string, ?>} */ (broadcastParams).databaseIdentifier) === this.databaseIdentifier
  }

  /**
   * Builds diagnostics.
   * @returns {Record<string, string>} Non-sensitive diagnostics.
   */
  debugSnapshot() {
    return {databaseIdentifier: this.databaseIdentifier}
  }

  /** @type {string} */
  databaseIdentifier = ""

  /**
   * Registers the framework channel used by mounted jobs dashboards.
   * @param {import("../../configuration.js").default} configuration - Configuration.
   */
  static register(configuration) {
    configuration.registerWebsocketChannel(BACKGROUND_JOB_COUNTS_CHANNEL, this)
  }
}
