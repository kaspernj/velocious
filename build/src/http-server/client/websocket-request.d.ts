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