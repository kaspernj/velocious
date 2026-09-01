import RequestParser from "./request-parser.js";
export default class VelociousHttpServerClientRequest {
    client: import("./index.js").default;
    configuration: import("../../configuration.js").default;
    requestParser: RequestParser;
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
    socketRemoteAddress(): string | undefined;
    getRequestBuffer(): import("./request-buffer/index.js").default;
    getRequestParser(): RequestParser;
}
//# sourceMappingURL=request.d.ts.map