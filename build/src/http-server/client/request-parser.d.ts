import RequestBuffer from "./request-buffer/index.js";
export default class VelociousHttpServerClientRequestParser {
    configuration: import("../../configuration.js").default;
    data: any[];
    events: import("eventemitter3").EventEmitter<string | symbol, any>;
    hasCompleted: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string | string[] | undefined | Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>>} */
    params: Record<string, string | string[] | undefined | Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>>;
    requestBuffer: RequestBuffer;
    state: string | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration }: {
        configuration: import("../../configuration.js").default;
    });
    /**
     * Runs destroy.
     * @returns {void} - No return value.
     */
    destroy(): void;
    /**
     * On form data part.
     * @param {import("./request-buffer/form-data-part.js").default} formDataPart - Form data part.
     * @returns {void} - No return value.
     */
    onFormDataPart: (formDataPart: import("./request-buffer/form-data-part.js").default) => void;
    /**
     * Feed.
     * @param {Buffer} data - Data payload.
     * @returns {Buffer | undefined} - Remaining data, if any.
     */
    feed: (data: Buffer) => Buffer | undefined;
    /**
     * Runs get header.
     * @param {string} name - Name.
     * @returns {string} - The header.
     */
    getHeader(name: string): string;
    /**
     * Runs get headers.
     * @returns {Record<string, string>} - The headers.
     */
    getHeaders(): Record<string, string>;
    /**
     * Runs get http method.
     * @returns {string} - The http method.
     */
    getHttpMethod(): string;
    /**
     * Runs get http version.
     * @returns {string} - The http version.
     */
    getHttpVersion(): string;
    /**
     * Runs get host match.
     * @returns {{host: string, port: string, protocol: string} | null} - Parsed host info, or null when unavailable.
     */
    _getHostMatch(): {
        host: string;
        port: string;
        protocol: string;
    } | null;
    /**
     * Runs get host.
     * @returns {string | void} - The host.
     */
    getHost(): string | void;
    /**
     * Runs get path.
     * @returns {string} - The path.
     */
    getPath(): string;
    /**
     * Runs get port.
     * @returns {number | void} - The port.
     */
    getPort(): number | void;
    /**
     * Runs get protocol.
     * @returns {string | null} - The protocol.
     */
    getProtocol(): string | null;
    /**
     * Runs get request buffer.
     * @returns {RequestBuffer} - The request buffer.
     */
    getRequestBuffer(): RequestBuffer;
    /**
     * Request done.
     * @returns {void} - No return value.
     */
    requestDone: () => void;
}
//# sourceMappingURL=request-parser.d.ts.map