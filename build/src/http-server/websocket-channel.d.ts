export type WebsocketJsonValue = null | boolean | number | string | object;
export type WebsocketParams = Record<string, WebsocketJsonValue>;
export type WebsocketBroadcastMetadata = {
    broadcastParams?: WebsocketParams;
    eventId?: string;
};
/**
 * WebsocketJsonValue type.
 * @typedef {null | boolean | number | string | object} WebsocketJsonValue
 */
/**
 * WebsocketParams type.
 * @typedef {Record<string, WebsocketJsonValue>} WebsocketParams
 */
/**
 * Server-side metadata accompanying a matched broadcast.
 * @typedef {{broadcastParams?: WebsocketParams, eventId?: string}} WebsocketBroadcastMetadata
 */
/**
 * Base class for app-defined 1:N pub/sub channels.
 *
 * Subclasses override:
 *  - `canSubscribe()` — subscribe-time auth (default `false`).
 *  - `subscribed()` / `unsubscribed()` — optional lifecycle hooks.
 *  - `matches(broadcastParams)` — broadcast routing filter.
 */
export default class VelociousWebsocketChannel {
    subscriptionId: string;
    params: WebsocketParams;
    session: import("./client/websocket-session.js").default;
    _closed: boolean;
    /**
     * Runs constructor.
     * @param {object} args - Session, channel parameters, and client subscription identifier.
     * @param {string} args.subscriptionId - Client-assigned id, unique within the session.
     * @param {WebsocketParams} args.params - Subscribe params.
     * @param {import("./client/websocket-session.js").default} args.session - Owning session.
     */
    constructor({ subscriptionId, params, session }: {
        subscriptionId: string;
        params: WebsocketParams;
        session: import("./client/websocket-session.js").default;
    });
    /**
     * Subscribe-time auth. Default is `false` (deny). Channel authors
     * MUST override to allow subscriptions. Returning a Promise defers
     * the `channel-subscribed` confirmation until it resolves.
     * @returns {boolean | Promise<boolean>} - Whether the subscription is authorized.
     */
    canSubscribe(): boolean | Promise<boolean>;
    /**
     * Optional — called once after `canSubscribe` resolves truthy and
     * before `channel-subscribed` is sent to the client. Use for
     * initial snapshot delivery.
     * @returns {void | Promise<void>} - Completes after subscription setup.
     */
    subscribed(): void | Promise<void>;
    /**
     * Optional — called once when the subscription ends. Fires on
     * client-initiated `channel-unsubscribe` or on session teardown.
     * @returns {void | Promise<void>} - Completes after subscription teardown.
     */
    unsubscribed(): void | Promise<void>;
    /**
     * Called when the underlying socket drops and the session is
     * moved into the paused/grace registry. Either `onResume` fires
     * on successful client reconnect, or `unsubscribed()` fires when
     * the grace window expires.
     * @returns {void | Promise<void>} - Completes after disconnect handling.
     */
    onDisconnect(): void | Promise<void>;
    /**
     * Called after a client reconnect + `session-resume` rebinds this
     * subscription to a new socket.
     * @returns {void | Promise<void>} - Completes after resume handling.
     */
    onResume(): void | Promise<void>;
    /**
     * Called when the client sends updated metadata (e.g. after
     * sign-in / locale change). Override to react to session-level
     * metadata updates.
     * @param {WebsocketParams} _metadata - Updated metadata.
     * @returns {void | Promise<void>} - Completes after metadata-change handling.
     */
    onMetadataChanged(_metadata: WebsocketParams): void | Promise<void>;
    /**
     * Broadcast routing filter. Called by `broadcastToChannel` for
     * each live subscription — returning true delivers the body via
     * `sendMessage`. Default matches all broadcasts regardless of
     * params; override for per-subscriber filtering.
     * @param {...WebsocketJsonValue} _broadcastArgs - Params forwarded from `broadcastToChannel` (ignored by default).
     * @returns {boolean} - True to deliver the broadcast to this subscriber.
     */
    matches(..._broadcastArgs: WebsocketJsonValue[]): boolean;
    /**
     * Returns sanitized diagnostics for debug snapshots.
     * Subclasses can override to expose non-sensitive routing details.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Debug-safe subscription details.
     */
    debugSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Delivers a matched broadcast to this subscriber. Subclasses can
     * override when the outbound body must be tailored to subscription
     * params before sending.
     * @param {WebsocketJsonValue} body - Broadcast payload offered to this subscription.
     * @param {WebsocketBroadcastMetadata} [meta] - Optional server-side broadcast metadata.
     * @returns {void | Promise<void>} - Completes after broadcast delivery.
     */
    deliverBroadcast(body: WebsocketJsonValue, meta?: WebsocketBroadcastMetadata): void | Promise<void>;
    /**
     * Sends a `channel-message` frame to THIS subscriber only.
     * When `meta.eventId` is provided, the client receives it so it
     * can track its checkpoint for `lastEventId` replay on reconnect.
     * @param {WebsocketJsonValue} body - Channel payload to send to the subscribed client.
     * @param {WebsocketBroadcastMetadata} [meta] - Optional server-side broadcast metadata.
     * @returns {void}
     */
    sendMessage(body: WebsocketJsonValue, meta?: WebsocketBroadcastMetadata): void;
    /**
     * Runs is closed.
     * @returns {boolean} - Whether the channel is closed.
     */
    isClosed(): boolean;
}
//# sourceMappingURL=websocket-channel.d.ts.map