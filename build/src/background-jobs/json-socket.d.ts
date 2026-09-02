import EventEmitter from "../utils/event-emitter.js";
export default class JsonSocket extends EventEmitter {
    socket: import("node:net").Socket;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | undefined} */
    workerId: string | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    supportsHandoffIdReporting: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    acceptsSpawnedJobs: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    acceptsForkedJobs: boolean;
    /** @type {boolean} */
    acceptsPooledJobs: boolean;
    /** Number of pooled handoffs this readiness advertisement can accept. */
    availablePooledSlots: number;
    /** Whether the worker/main pair uses consumable pooled-capacity credits. */
    usesPooledCapacityCredits: boolean;
    /** Whether this worker has permanently stopped accepting new handoffs. */
    isDraining: boolean;
    /** Monotonic generation of the worker's latest readiness advertisement. */
    readinessVersion: number;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    acceptsInlineJobs: boolean;
    /**
     * Whether this worker advertised heartbeat support in its hello. Only
     * heartbeat-capable workers are subject to the main's stale-liveness
     * eviction; a legacy worker (e.g. mid rolling deploy) is exempt so its
     * active leases are not released while it is still running them.
     * @type {boolean} */
    supportsHeartbeat: boolean;
    /**
     * Last time (ms) the main saw any message from this worker socket; used by
     * the main's liveness sweep to drop a wedged/silent worker.
     * @type {number | undefined} */
    lastSeenAt: number | undefined;
    /**
     * Internal test-only observability counter — NOT public API. Number of times
     * `destroy()` has run, incremented immediately before the raw socket
     * `destroy()` call so specs can assert the actual teardown method that ran
     * rather than a self-reported flag. Do not read or depend on this outside tests.
     * @type {number} */
    _destroyCallCount: number;
    /**
     * Internal test-only observability counter — NOT public API. Number of times
     * `close()` has run, incremented immediately before the raw socket `end()`
     * call. Do not read or depend on this outside tests.
     * @type {number} */
    _closeCallCount: number;
    buffer: string;
    /**
     * Runs constructor.
     * @param {import("net").Socket} socket - Socket instance.
     */
    constructor(socket: import("net").Socket);
    /**
     * Runs on data.
     * @param {string} chunk - Data chunk.
     * @returns {void}
     */
    _onData(chunk: string): void;
    /**
     * Runs send.
     * @param {ReturnType<typeof JSON.parse>} message - Message to send.
     * @returns {void}
     */
    send(message: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs close.
     * @returns {void}
     */
    close(): void;
    /**
     * Forcibly destroys the underlying socket. Unlike {@link close}, which
     * half-closes gracefully via `end()`, this tears the connection down
     * immediately so a stalled/aborted request does not leave the socket alive.
     * @returns {void}
     */
    destroy(): void;
}
//# sourceMappingURL=json-socket.d.ts.map