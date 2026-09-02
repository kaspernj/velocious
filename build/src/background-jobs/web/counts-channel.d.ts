import VelociousWebsocketChannel from "../../http-server/websocket-channel.js";
/**
 * Authorized dashboard count-delta channel. Clients subscribe with the mount
 * path and their normal bearer token as `authenticationToken`.
 */
export default class BackgroundJobCountsChannel extends VelociousWebsocketChannel {
    /**
     * Authorizes the subscription.
     * @returns {Promise<boolean>} Whether the mount's normal dashboard authorization allows the subscription.
     */
    canSubscribe(): Promise<boolean>;
    /**
     * Matches only events from the database selected by the authorized mount.
     * @param {import("../../http-server/websocket-channel.js").WebsocketJsonValue} broadcastParams - Publisher scope.
     * @returns {boolean} Whether this subscription should receive the event.
     */
    matches(broadcastParams: import("../../http-server/websocket-channel.js").WebsocketJsonValue): boolean;
    /**
     * Builds diagnostics.
     * @returns {Record<string, string>} Non-sensitive diagnostics.
     */
    debugSnapshot(): Record<string, string>;
    /** @type {string} */
    databaseIdentifier: string;
    /**
     * Registers the framework channel used by mounted jobs dashboards.
     * @param {import("../../configuration.js").default} configuration - Configuration.
     */
    static register(configuration: import("../../configuration.js").default): void;
}
//# sourceMappingURL=counts-channel.d.ts.map