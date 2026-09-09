import net from "node:net";
import JsonSocket from "../background-jobs/json-socket.js";
import EventEmitter from "../utils/event-emitter.js";
export type BeaconBroadcastHandler = (arg: import("./types.js").BeaconBroadcastMessage) => void;
/**
 * BeaconClient connects to a `velocious beacon` daemon and exchanges
 * broadcasts with all peer processes connected to the same daemon.
 *
 * Lifecycle:
 *   const client = new BeaconClient({host, port, peerType: "server"})
 *   await client.connect()                         // resolves on first successful connect
 *   await client.waitForReady({timeoutMs: 1000})   // resolves after the daemon hello-ack
 *   client.onBroadcast((message) => { ... })       // every fan-out
 *   client.publish({channel, broadcastParams, body})
 *   await client.close()
 *
 * Reconnect: on socket close (without an explicit `close()` call) the
 * client schedules a reconnect with exponential backoff. While the
 * underlying socket is down, `publish(...)` returns false and the
 * caller can fall back to local-only delivery; subsequent reconnects do
 * not replay missed publishes (Beacon is pubsub, not a queue).
 */
export default class BeaconClient extends EventEmitter {
    host: string;
    port: number;
    peerType: string | undefined;
    peerId: string;
    _initialReconnectDelayMs: number;
    _maxReconnectDelayMs: number;
    _reconnectDelayMs: number;
    _closeTimeoutMs: number;
    /**
     * Narrows the runtime value to the documented type.
     * @type {JsonSocket | undefined} */
    _jsonSocket: JsonSocket | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {net.Socket | undefined} */
    _socket: net.Socket | undefined;
    _connected: boolean;
    _ready: boolean;
    _closed: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<void> | undefined} */
    _connectPromise: Promise<void> | undefined;
    /**
     * Last socket error observed while connected, surfaced as the disconnect reason.
     * @type {Error | undefined}
     */
    _lastSocketError: Error | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {string} args.host - Beacon host.
     * @param {number} args.port - Beacon port.
     * @param {string} [args.peerType] - Optional human-readable peer label.
     * @param {string} [args.peerId] - Optional explicit peer id (defaults to a random UUID).
     * @param {number} [args.reconnectDelayMs] - Starting reconnect delay in ms.
     * @param {number} [args.maxReconnectDelayMs] - Maximum reconnect delay in ms.
     * @param {number} [args.closeTimeoutMs] - Maximum graceful socket close wait in ms.
     */
    constructor({ host, port, peerType, peerId, reconnectDelayMs, maxReconnectDelayMs, closeTimeoutMs }: {
        host: string;
        port: number;
        peerType?: string;
        peerId?: string;
        reconnectDelayMs?: number;
        maxReconnectDelayMs?: number;
        closeTimeoutMs?: number;
    });
    /**
     * Runs get peer id.
     * @returns {string} - The peer id sent on the hello handshake.
     */
    getPeerId(): string;
    /**
     * Runs is connected.
     * @returns {boolean} - Whether the underlying socket is currently connected.
     */
    isConnected(): boolean;
    /**
     * Runs is ready.
     * @returns {boolean} - Whether the daemon has acknowledged this peer registration.
     */
    isReady(): boolean;
    /**
     * Resolves on the first successful connect. Subsequent calls return
     * the same promise. Subsequent reconnects after a drop are silent —
     * use `on("connect")` / `on("disconnect", reason)` to observe them.
     * The `disconnect` listener receives an `Error` reason: either the
     * underlying socket error, or `Error("Beacon broker disconnected")`
     * when the close had no preceding error.
     * @returns {Promise<void>}
     */
    connect(): Promise<void>;
    /**
     * Resolves after the Beacon daemon has acknowledged this peer's
     * hello handshake. This is stronger than `isConnected()`: connected
     * means the TCP socket is open, ready means the daemon has registered
     * the peer and broadcasts can be routed through the bus.
     * @param {object} [args] - Options.
     * @param {number} [args.timeoutMs] - Optional timeout in milliseconds.
     * @returns {Promise<void>}
     */
    waitForReady({ timeoutMs }?: {
        timeoutMs?: number;
    }): Promise<void>;
    /**
     * Publishes a broadcast message to all peers (including this one,
     * unless the daemon is restarted mid-publish).
     * @param {object} args - Broadcast args.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing params.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body.
     * @returns {boolean} - True if the publish was written to the socket. False if the client is currently disconnected.
     */
    publish({ channel, broadcastParams, body }: {
        channel: string;
        broadcastParams: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
    }): boolean;
    /**
     * Registers a handler called once for every `broadcast` message
     * received from the daemon (including echoes of this client's own
     * publishes — synapse-style fan-out).
     * @param {BeaconBroadcastHandler} handler - Handler.
     * @returns {() => void} - Unregister function.
     */
    onBroadcast(handler: BeaconBroadcastHandler): () => void;
    /**
     * Runs close.
     * @returns {Promise<void>} - Resolves once the socket is closed.
     */
    close(): Promise<void>;
    /**
     * Runs open socket.
     * @returns {void}
     */
    _openSocket(): void;
    /**
     * Runs schedule reconnect.
     * @returns {void}
     */
    _scheduleReconnect(): void;
}
//# sourceMappingURL=client.d.ts.map