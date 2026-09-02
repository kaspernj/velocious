import JsonSocket from "./json-socket.js";
export default class BackgroundJobsSocketRequest {
    host: string;
    port: number;
    role: "client" | "reporter";
    generationId: string | undefined;
    generationHandshakeTimeoutMs: number;
    /**
     * Internal test-only observability reference — NOT public API. Holds the
     * JsonSocket wrapper this request created so the timeout spec can inspect the
     * wrapper's own `destroy()`/`close()` call counters — direct evidence of which
     * teardown method actually ran, not a self-reported flag. Retains the single
     * (already torn-down) wrapper for the request's lifetime. Do not expose or
     * depend on this outside tests.
     * @type {JsonSocket | undefined}
     */
    _jsonSocket: JsonSocket | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {string} args.host - Host.
     * @param {number} args.port - Port.
     * @param {"client" | "reporter"} args.role - Socket role.
     * @param {string} [args.generationId] - Release generation identity.
     * @param {number} [args.generationHandshakeTimeoutMs] - Generation acknowledgement deadline.
     */
    constructor({ host, port, role, generationHandshakeTimeoutMs, generationId }: {
        host: string;
        port: number;
        role: "client" | "reporter";
        generationId?: string;
        generationHandshakeTimeoutMs?: number;
    });
    /**
     * Runs run.
     * @template T
     * @param {object} args - Options.
     * @param {(jsonSocket: JsonSocket) => void} args.onConnect - Called after the socket connects.
     * @param {(args: {message: import("./types.js").BackgroundJobSocketMessage, resolve: (value: T) => void, reject: (error: Error) => void}) => void} args.onMessage - Message handler.
     * @param {AbortSignal} [args.signal] - Aborts the request; on abort the pending socket is destroyed and the promise rejects with the signal reason when it is an Error, otherwise with a generic abort Error.
     * @returns {Promise<T>} - Resolved request value.
     */
    run<T>({ onConnect, onMessage, signal }: {
        onConnect: (jsonSocket: JsonSocket) => void;
        onMessage: (args: {
            message: import("./types.js").BackgroundJobSocketMessage;
            resolve: (value: T) => void;
            reject: (error: Error) => void;
        }) => void;
        signal?: AbortSignal;
    }): Promise<T>;
}
//# sourceMappingURL=socket-request.d.ts.map