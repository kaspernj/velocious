export default class VelociousHttpServerClientWebsocketRequest {
    body: any;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string>} */
    headersMap: Record<string, string>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    metadataObject: Record<string, ReturnType<typeof JSON.parse>>;
    method: string;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    paramsObject: Record<string, ReturnType<typeof JSON.parse>>;
    _path: string;
    remoteAddressValue: string | undefined;
    /**
     * Whether the owning client connection was torn down while this request
     * was still running. Websocket requests are session-owned and never
     * enter the client's in-flight request list, so this stays false for
     * them; the field exists so the request union shares one surface.
     * @type {boolean} */
    clientDisconnected: boolean;
    /** @type {Set<() => void>} */
    clientDisconnectCallbacks: Set<() => void>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {ReturnType<typeof JSON.parse>} [args.body] - Request body.
     * @param {Record<string, string>} [args.headers] - Header list.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.metadata] - Session metadata.
     * @param {string} args.method - HTTP method.
     * @param {string} args.path - Path.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.params] - Parameters object.
     * @param {string} [args.remoteAddress] - Remote address.
     */
    constructor({ body, headers, metadata, method, params, path, remoteAddress }: {
        body?: ReturnType<typeof JSON.parse>;
        headers?: Record<string, string>;
        metadata?: Record<string, ReturnType<typeof JSON.parse>>;
        method: string;
        path: string;
        params?: Record<string, ReturnType<typeof JSON.parse>>;
        remoteAddress?: string;
    });
    /**
     * Marks this request as client-disconnected and runs every registered
     * disconnect callback exactly once. The owning client invokes it when the
     * socket tears down; handlers that register afterwards learn of the
     * disconnect through the `clientDisconnected` field instead. Websocket
     * requests are session-owned and never enter the client's in-flight
     * request list, so this is inert for them; the shared surface keeps the
     * request union uniform.
     * @returns {void}
     */
    markClientDisconnected(): void;
    /**
     * Registers a callback that fires once when the client connection tears
     * down while this request is still running. See the HTTP request's
     * {@linkcode markClientDisconnected} for the shared-surface note.
     * @param {() => void} callback - Disconnect callback.
     * @returns {void}
     */
    onClientDisconnect(callback: () => void): void;
    baseURL(): string | undefined;
    /**
     * Runs header.
     * @param {string} name - Header name.
     * @returns {string | null} - Header value.
     */
    header(name: string): string | null;
    headers(): Record<string, string>;
    httpMethod(): string;
    httpVersion(): string;
    host(): string | undefined;
    /**
     * Runs metadata.
     * @param {string} [key] - Metadata key.
     * @returns {ReturnType<typeof JSON.parse>} - Metadata value for a key, or the full metadata object.
     */
    metadata(key?: string): ReturnType<typeof JSON.parse>;
    hostWithPort(): string | undefined;
    origin(): string | null;
    path(): string;
    params(): Record<string, any>;
    port(): number | undefined;
    protocol(): string | undefined;
    /**
     * Runs query params.
     * @returns {Record<string, string | string[]>} - Parsed query parameters from the URL.
     */
    queryParams(): Record<string, string | string[]>;
    remoteAddress(): string | undefined;
    _parseQueryParams(): any;
}
//# sourceMappingURL=websocket-request.d.ts.map