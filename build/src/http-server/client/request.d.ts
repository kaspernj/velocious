import RequestParser from "./request-parser.js";
export default class VelociousHttpServerClientRequest {
    client: import("./index.js").default;
    configuration: import("../../configuration.js").default;
    requestParser: RequestParser;
    /**
     * Whether the owning client connection was torn down while this request
     * was still running. Set once by the client on socket teardown and read
     * by handlers that need to settle in-flight work (e.g. admission queue
     * positions) without waiting for the response to be sent.
     * @type {boolean} */
    clientDisconnected: boolean;
    /** @type {Set<() => void>} */
    clientDisconnectCallbacks: Set<() => void>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./index.js").default} args.client - Client instance.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ client, configuration, ...restArgs }: {
        client: import("./index.js").default;
        configuration: import("../../configuration.js").default;
    });
    baseURL(): string;
    /**
     * Runs feed.
     * @param {Buffer} data - Data payload.
     * @returns {Buffer | undefined} - Remaining data, if any.
     */
    feed(data: Buffer): Buffer | undefined;
    /**
     * Runs header.
     * @param {string} headerName - Header name.
     * @returns {string | null} - The header.
     */
    header(headerName: string): string | null;
    headers(): Record<string, string>;
    httpMethod(): string;
    httpVersion(): string;
    host(): void | string;
    /**
     * Runs metadata.
     * @param {string} [key] - Metadata key.
     * @returns {ReturnType<typeof JSON.parse>} - Metadata value for a key, or the full metadata object.
     */
    metadata(key?: string): ReturnType<typeof JSON.parse>;
    hostWithPort(): string;
    origin(): string | null;
    path(): string;
    /**
     * Runs params.
     * @returns {Record<string, string | string[] | undefined | Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>>} - The request params.
     */
    params(): Record<string, string | string[] | undefined | Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>>;
    port(): void | number;
    /**
     * Runs query params.
     * @returns {Record<string, string | string[]>} - Parsed query parameters from the URL.
     */
    queryParams(): Record<string, string | string[]>;
    protocol(): string | null;
    remoteAddress(): string | undefined;
    /**
     * Returns exact body bytes for requests whose header-stage body policy selected raw mode.
     * @returns {Buffer} - A copy of the exact request body bytes.
     */
    rawBody(): Buffer;
    socketRemoteAddress(): string | undefined;
    /**
     * Marks this request as client-disconnected and runs every registered
     * disconnect callback exactly once. The owning client invokes it when the
     * socket tears down; handlers that register afterwards learn of the
     * disconnect through the `clientDisconnected` field instead.
     * @returns {void}
     */
    markClientDisconnected(): void;
    /**
     * Registers a callback that fires once when the client connection tears
     * down while this request is still running. Buffered requests cannot rely
     * on the streaming response's `onStreamClose` for that: no stream has
     * been opened yet, so a queued request's queue position is otherwise
     * stranded until its admission deadline.
     * @param {() => void} callback - Disconnect callback.
     * @returns {void}
     */
    onClientDisconnect(callback: () => void): void;
    getRequestBuffer(): import("./request-buffer/index.js").default;
    getRequestParser(): RequestParser;
}
//# sourceMappingURL=request.d.ts.map