declare class Response {
    fetchResponse: globalThis.Response;
    _body: string | undefined;
    /**
     * Runs constructor.
     * @param {globalThis.Response} fetchResponse - Fetch response.
     */
    constructor(fetchResponse: globalThis.Response);
    /**
     * Runs parse.
     * @returns {Promise<void>} - Resolves when complete.
     */
    parse(): Promise<void>;
    /**
     * Runs body.
     * @returns {string} - The body.
     */
    body(): string;
    /**
     * Runs content type.
     * @returns {string | null} - The content type.
     */
    contentType(): string | null;
    /**
     * Runs status code.
     * @returns {number} - The status code.
     */
    statusCode(): number;
}
export default class RequestClient {
    host: string;
    port: number;
    /**
     * Runs get.
     * @param {string} path - Path.
     * @returns {Promise<Response>} - Resolves with the get.
     */
    get(path: string): Promise<Response>;
    /**
     * Runs post.
     * @param {string} path - Path.
     * @param {object} data - Data payload.
     * @returns {Promise<Response>} - Resolves with the post.
     */
    post(path: string, data: object): Promise<Response>;
}
export {};
//# sourceMappingURL=request-client.d.ts.map