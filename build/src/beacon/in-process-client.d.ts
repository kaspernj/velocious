import EventEmitter from "../utils/event-emitter.js";
export type BeaconBroadcastHandler = (arg: import("./types.js").BeaconBroadcastMessage) => void;
/**
 * BeaconBroadcastHandler type.
 * @typedef {(arg: import("./types.js").BeaconBroadcastMessage) => void} BeaconBroadcastHandler
 */
/**
 * In-process counterpart to `BeaconClient`. Registers with the
 * module-level `in-process-broker` singleton so peers in the same
 * process exchange broadcasts without ever touching TCP. Implements the
 * same external surface as `BeaconClient` (`connect`, `publish`,
 * `onBroadcast`, `isConnected`, `getPeerId`, `close`) so
 * `Configuration` can use either client interchangeably.
 *
 * Lifecycle differs from `BeaconClient` in two intentional ways:
 *   - `connect()` and `waitForReady()` resolve immediately; there is no broker to wait for.
 *   - There is no reconnect loop and no `connect-error` / `disconnect`
 *     event surface, because nothing can fail.
 */
export default class InProcessBeaconClient extends EventEmitter {
    peerType: string | undefined;
    peerId: string;
    _connected: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {(() => void) | undefined} */
    _unregister: (() => void) | undefined;
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {string} [args.peerType] - Optional human-readable peer label.
     * @param {string} [args.peerId] - Optional explicit peer id (defaults to a random UUID).
     */
    constructor({ peerType, peerId }?: {
        peerType?: string;
        peerId?: string;
    });
    /**
     * Runs get peer id.
     * @returns {string} - Peer id.
     */
    getPeerId(): string;
    /**
     * Runs is connected.
     * @returns {boolean} - Whether the peer is registered with the broker.
     */
    isConnected(): boolean;
    /**
     * Runs is ready.
     * @returns {boolean} - Whether the peer is ready to publish through the broker.
     */
    isReady(): boolean;
    /**
     * Registers with the in-process broker. Idempotent.
     * @returns {Promise<void>}
     */
    connect(): Promise<void>;
    /**
     * In-process peers are ready as soon as they are connected.
     * @returns {Promise<void>}
     */
    waitForReady(): Promise<void>;
    /**
     * Publishes a broadcast to every registered peer (including this
     * one). Returns false if `connect()` hasn't been called yet, matching
     * `BeaconClient` semantics.
     * @param {object} args - Broadcast args.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing params.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body.
     * @returns {boolean} - True when the broadcast was queued.
     */
    publish({ channel, broadcastParams, body }: {
        channel: string;
        broadcastParams: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
    }): boolean;
    /**
     * Registers a handler called once for every broadcast received.
     * @param {BeaconBroadcastHandler} handler - Handler.
     * @returns {() => void} - Unregister function.
     */
    onBroadcast(handler: BeaconBroadcastHandler): () => void;
    /**
     * Receives a broadcast from the broker. Called by `in-process-broker`.
     * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
     * @returns {void}
     */
    _receiveBroadcast(message: import("./types.js").BeaconBroadcastMessage): void;
    /**
     * Runs close.
     * @returns {Promise<void>} - Unregisters from the broker.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=in-process-client.d.ts.map