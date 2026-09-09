/**
 * Per-process registry of channel subscribers used by worker code that
 * needs to react to events broadcast via `websocketEventsHost.publish(...)`
 * without holding an actual websocket session.
 *
 * Each Velocious worker thread (and the in-process handler used in tests)
 * gets its own instance attached to the configuration via
 * `setWebsocketChannelSubscribers(...)`.
 */
export default class VelociousWebsocketChannelSubscribers {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, Set<(payload: ReturnType<typeof JSON.parse>, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>>>} */
    _subscribers: Map<string, Set<(payload: ReturnType<typeof JSON.parse>, meta: {
        channel: string;
        createdAt?: string;
        eventId?: string;
    }) => void | Promise<void>>>;
    constructor();
    /**
     * Runs subscribe.
     * @param {string} channel - Channel name to subscribe to.
     * @param {(payload: ReturnType<typeof JSON.parse>, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>} callback - Callback invoked for each event on the channel.
     * @returns {() => void} - Unsubscribe function.
     */
    subscribe(channel: string, callback: (payload: ReturnType<typeof JSON.parse>, meta: {
        channel: string;
        createdAt?: string;
        eventId?: string;
    }) => void | Promise<void>): () => void;
    /**
     * Runs unsubscribe.
     * @param {string} channel - Channel name.
     * @param {(payload: ReturnType<typeof JSON.parse>, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>} callback - Previously registered callback.
     * @returns {void}
     */
    unsubscribe(channel: string, callback: (payload: ReturnType<typeof JSON.parse>, meta: {
        channel: string;
        createdAt?: string;
        eventId?: string;
    }) => void | Promise<void>): void;
    /**
     * Runs has subscribers.
     * @param {string} channel - Channel name.
     * @returns {boolean} - Whether any subscribers exist for the channel.
     */
    hasSubscribers(channel: string): boolean;
    /**
     * Dispatch an event to all subscribers of the channel.
     * @param {object} args - Event args.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Event payload.
     * @param {string} [args.createdAt] - Event creation time.
     * @param {string} [args.eventId] - Event identifier.
     * @returns {Promise<void>} - Resolves when all subscribers have completed.
     */
    dispatch({ channel, payload, createdAt, eventId }: {
        channel: string;
        payload: ReturnType<typeof JSON.parse>;
        createdAt?: string;
        eventId?: string;
    }): Promise<void>;
}
//# sourceMappingURL=websocket-channel-subscribers.d.ts.map