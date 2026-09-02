import FormDataPart from "./form-data-part.js";
import Header from "./header.js";
import Logger from "../../../logger.js";
export default class RequestBuffer {
    configuration: import("../../../configuration.js").default;
    logger: Logger;
    currentChunkBytesRead: number | undefined;
    currentChunkCrlfRead: number | undefined;
    formDataPart: FormDataPart | undefined;
    contentLength: number | undefined;
    boundary: string | undefined;
    boundaryLine: string | undefined;
    boundaryLineNext: string | undefined;
    boundaryLineEnd: string | undefined;
    httpMethod: string | undefined;
    httpVersion: string | undefined;
    path: string | undefined;
    postBody: string | undefined;
    currentChunkSize: number | undefined;
    bodyLength: number;
    /** @type {Buffer[] | undefined} */
    postBodyBuffers: Buffer[] | undefined;
    /**
     * Data.
     * @type {number[]} */
    data: number[];
    events: import("eventemitter3").EventEmitter<string | symbol, any>;
    /**
     * Headers by name.
     * @type {Record<string, Header>} */
    headersByName: Record<string, Header>;
    /**
     * Chunked body chars.
     * @type {number[] | undefined} */
    chunkedBodyChars: number[] | undefined;
    multiPartyFormData: boolean;
    completed: boolean;
    params: {};
    readingBody: boolean;
    state: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration }: {
        configuration: import("../../../configuration.js").default;
    });
    destroy(): void;
    /**
     * Runs feed.
     * @param {Buffer} data - Data payload.
     * @returns {Buffer | undefined} - Remaining data, if any.
     */
    feed(data: Buffer): Buffer | undefined;
    /**
     * Consumes bytes for the line-based states up to and including the next newline.
     * @param {Buffer} data - Data payload.
     * @param {number} index - Read position.
     * @returns {number} - New read position.
     */
    feedLine(data: Buffer, index: number): number;
    /**
     * Consumes fixed-length request body bytes in bulk.
     * @param {Buffer} data - Data payload.
     * @param {number} index - Read position.
     * @returns {number} - New read position.
     */
    feedPostBody(data: Buffer, index: number): number;
    /**
     * Consumes a single byte for the byte-based parser states.
     * @param {Buffer} data - Data payload.
     * @param {number} index - Read position.
     * @returns {number} - New read position.
     */
    feedByte(data: Buffer, index: number): number;
    /**
     * Runs get header.
     * @param {string} name - Name.
     * @returns {Header} - The header.
     */
    getHeader(name: string): Header;
    /**
     * Runs get headers hash.
     * @returns {Record<string, string>} - The headers hash.
     */
    getHeadersHash(): Record<string, string>;
    /**
     * Runs form data part done.
     * @returns {void} - No return value.
     */
    formDataPartDone(): void;
    isMultiPartyFormData(): boolean;
    /**
     * Runs new form data part.
     * @returns {void} - No return value.
     */
    newFormDataPart(): void;
    /**
     * Runs parse.
     * @param {string} line - Line.
     * @returns {void} - No return value.
     */
    parse(line: string): void;
    /**
     * Runs read header from line.
     * @param {string} line - Line.
     * @returns {Header | undefined} - The header from line.
     */
    readHeaderFromLine(line: string): Header | undefined;
    /**
     * Runs add header.
     * @param {Header} header - Header value.
     */
    addHeader(header: Header): void;
    /**
     * Runs parse header.
     * @param {string} line - Line.
     * @returns {void} - No return value.
     */
    parseHeader(line: string): void;
    /**
     * Runs parse status line.
     * @param {string} line - Line.
     * @returns {void} - No return value.
     */
    parseStatusLine(line: string): void;
    postRequestDone(): void;
    /**
     * Runs expects request body.
     * @param {string} httpMethod - HTTP method.
     * @returns {boolean} - Whether the request expects a body.
     */
    expectsRequestBody(httpMethod: string): boolean;
    /**
     * Runs is chunked encoding.
     * @returns {boolean} - Whether the request uses chunked transfer encoding.
     */
    isChunkedEncoding(): boolean;
    /**
     * Runs initialize chunked body.
     * @returns {void} - No return value.
     */
    initializeChunkedBody(): void;
    /**
     * Runs parse chunk size line.
     * @param {string} line - Chunk size line.
     * @returns {void} - No return value.
     */
    parseChunkSizeLine(line: string): void;
    /**
     * Runs finish chunked body.
     * @returns {void} - No return value.
     */
    finishChunkedBody(): void;
    /**
     * Runs set state.
     * @param {string} newState - New state.
     * @returns {void} - No return value.
     */
    setState(newState: string): void;
    completeRequest: () => void;
    parseApplicationJsonParams(): void;
    parseQueryStringPostParams(): void;
}
//# sourceMappingURL=index.d.ts.map