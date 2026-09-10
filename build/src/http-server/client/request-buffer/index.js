// @ts-check
import EventEmitter from "../../../utils/event-emitter.js";
import FormDataPart from "./form-data-part.js";
import Header from "./header.js";
import { HttpRequestBodyTooLargeError } from "../errors.js";
import { incorporate } from "incorporator";
import Logger from "../../../logger.js";
import ParamsToObject from "../params-to-object.js";
import querystring from "querystring";
/**
 * Request header fields whose repeated wire fields combine into one value
 * (RFC 9110 §5.3) before the server consumes them.
 * @type {Set<string>} */
const COMBINING_HEADER_FIELDS = new Set(["accept-encoding"]);
/**
 * Runs truncate preview.
 * @param {string | undefined} input - Input string.
 * @param {number} [limit] - Max preview length.
 * @returns {string | undefined} - Truncated preview.
 */
function truncatePreview(input, limit = 300) {
    if (typeof input !== "string")
        return undefined;
    if (input.length <= limit)
        return input;
    return `${input.slice(0, limit)}...`;
}
export default class RequestBuffer {
    bodyLength = 0;
    /** @type {Buffer[] | undefined} */
    postBodyBuffers = undefined;
    /**
     * Data.
     * @type {number[]} */
    data = [];
    events = new EventEmitter();
    /**
     * Headers by name.
     * @type {Record<string, Header>} */
    headersByName = {};
    /**
     * Chunked body chars.
     * @type {number[] | undefined} */
    chunkedBodyChars = undefined;
    multiPartyFormData = false;
    completed = false;
    params = {};
    readingBody = false;
    state = "status";
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration }) {
        this.configuration = configuration;
        this.logger = new Logger(this, { debug: false });
    }
    /**
     * Raises before buffering a request body beyond the configured bound.
     * @param {number} actualBytes - Declared or accumulated decoded body bytes.
     * @returns {void}
     */
    assertRequestBodySize(actualBytes) {
        const maxBytes = this.configuration.getHttpServerMaxRequestBodyBytes();
        if (maxBytes !== undefined && actualBytes > maxBytes) {
            throw new HttpRequestBodyTooLargeError({ actualBytes, maxBytes });
        }
    }
    destroy() {
        // Do nothing for now...
    }
    /**
     * Runs feed.
     * @param {Buffer} data - Data payload.
     * @returns {Buffer | undefined} - Remaining data, if any.
     */
    feed(data) {
        let index = 0;
        while (index < data.length) {
            switch (this.state) {
                case "status":
                case "headers":
                case "multi-part-form-data":
                case "multi-part-form-data-header":
                case "chunked-size":
                case "chunked-trailer":
                    index = this.feedLine(data, index);
                    break;
                case "post-body":
                    index = this.feedPostBody(data, index);
                    break;
                default:
                    index = this.feedByte(data, index);
            }
            if (this.completed) {
                return data.subarray(index);
            }
        }
        return undefined;
    }
    /**
     * Consumes bytes for the line-based states up to and including the next newline.
     * @param {Buffer} data - Data payload.
     * @param {number} index - Read position.
     * @returns {number} - New read position.
     */
    feedLine(data, index) {
        const newlineIndex = data.indexOf(10, index);
        if (newlineIndex === -1) {
            if (this.readingBody)
                this.bodyLength += data.length - index;
            for (let dataIndex = index; dataIndex < data.length; dataIndex += 1) {
                this.data.push(data[dataIndex]);
            }
            return data.length;
        }
        if (this.readingBody)
            this.bodyLength += newlineIndex + 1 - index;
        let line;
        if (this.data.length == 0) {
            line = data.toString("latin1", index, newlineIndex + 1);
        }
        else {
            // The rest of a line that started in a previous chunk.
            for (let dataIndex = index; dataIndex <= newlineIndex; dataIndex += 1) {
                this.data.push(data[dataIndex]);
            }
            line = String.fromCharCode.apply(null, this.data);
            this.data = [];
        }
        this.parse(line);
        return newlineIndex + 1;
    }
    /**
     * Consumes fixed-length request body bytes in bulk.
     * @param {Buffer} data - Data payload.
     * @param {number} index - Read position.
     * @returns {number} - New read position.
     */
    feedPostBody(data, index) {
        if (!this.postBodyBuffers)
            throw new Error("postBodyBuffers not initialized");
        if (this.contentLength === undefined)
            throw new Error("Content length not set");
        const remainingBodyBytes = Math.max(1, this.contentLength - this.bodyLength);
        const endIndex = Math.min(data.length, index + remainingBodyBytes);
        this.postBodyBuffers.push(data.subarray(index, endIndex));
        this.bodyLength += endIndex - index;
        if (this.contentLength && this.bodyLength >= this.contentLength) {
            this.postRequestDone();
        }
        return endIndex;
    }
    /**
     * Consumes a single byte for the byte-based parser states.
     * @param {Buffer} data - Data payload.
     * @param {number} index - Read position.
     * @returns {number} - New read position.
     */
    feedByte(data, index) {
        const char = data[index];
        if (this.readingBody)
            this.bodyLength += 1;
        switch (this.state) {
            case "chunked-data": {
                const chunkedBodyChars = this.chunkedBodyChars;
                if (this.currentChunkSize === undefined)
                    throw new Error("Chunk size not initialized");
                if (!chunkedBodyChars)
                    throw new Error("Chunked body not initialized");
                chunkedBodyChars.push(char);
                /**
                 * Current chunk bytes read.
                 * @type {number} */
                const currentChunkBytesRead = (this.currentChunkBytesRead || 0) + 1;
                this.currentChunkBytesRead = currentChunkBytesRead;
                if (currentChunkBytesRead >= this.currentChunkSize) {
                    this.currentChunkCrlfRead = 0;
                    this.setState("chunked-data-crlf");
                }
                break;
            }
            case "chunked-data-crlf":
                this.currentChunkCrlfRead = (this.currentChunkCrlfRead || 0) + 1;
                if (this.currentChunkCrlfRead >= 2) {
                    this.currentChunkBytesRead = 0;
                    this.setState("chunked-size");
                }
                break;
            case "multi-part-form-data-body": {
                if (!this.formDataPart)
                    throw new Error("FormData part not initialized");
                if (!this.boundaryLineEnd)
                    throw new Error("Boundary line end not initialized");
                if (!this.boundaryLineNext)
                    throw new Error("Boundary line next not initialized");
                const body = this.formDataPart.body;
                body.push(char);
                const possibleBoundaryEndPosition = body.length - this.boundaryLineEnd.length;
                const possibleBoundaryEndChars = body.slice(possibleBoundaryEndPosition, body.length);
                const possibleBoundaryEnd = String.fromCharCode.apply(null, possibleBoundaryEndChars);
                const possibleBoundaryNextPosition = body.length - this.boundaryLineNext.length;
                const possibleBoundaryNextChars = body.slice(possibleBoundaryNextPosition, body.length);
                const possibleBoundaryNext = String.fromCharCode.apply(null, possibleBoundaryNextChars);
                if (possibleBoundaryEnd == this.boundaryLineEnd) {
                    this.formDataPart.removeFromBody(possibleBoundaryEnd);
                    this.formDataPartDone();
                    this.completeRequest();
                }
                else if (possibleBoundaryNext == this.boundaryLineNext) {
                    this.formDataPart.removeFromBody(possibleBoundaryNext);
                    this.formDataPartDone();
                    this.newFormDataPart();
                }
                else if (this.contentLength && this.bodyLength >= this.contentLength) {
                    this.formDataPartDone();
                    this.completeRequest();
                }
                else if (this.formDataPart.contentLength && this.bodyLength >= this.formDataPart.contentLength) {
                    this.formDataPartDone();
                    throw new Error("stub");
                }
                break;
            }
            default:
                this.logger.error(() => [`Unknown state for request buffer`, { state: this.state }]);
        }
        return index + 1;
    }
    /**
     * Runs get header.
     * @param {string} name - Name.
     * @returns {Header} - The header.
     */
    getHeader(name) {
        const result = this.headersByName[name.toLowerCase().trim()];
        this.logger.debugLowLevel(() => [`getHeader ${name}`, { result: result?.toString() }]);
        return result;
    }
    /**
     * Runs get headers hash.
     * @returns {Record<string, string>} - The headers hash.
     */
    getHeadersHash() {
        /**
         * Result.
         * @type {Record<string, string>} */
        const result = {};
        for (const headerFormattedName in this.headersByName) {
            const header = this.headersByName[headerFormattedName];
            result[header.getName()] = header.getValue();
        }
        return result;
    }
    /**
     * Runs form data part done.
     * @returns {void} - No return value.
     */
    formDataPartDone() {
        const formDataPart = this.formDataPart;
        if (!formDataPart)
            throw new Error("formDataPart wasnt set");
        this.formDataPart = undefined;
        formDataPart.finish();
        this.events.emit("form-data-part", formDataPart);
    }
    isMultiPartyFormData() {
        return this.multiPartyFormData;
    }
    /**
     * Runs new form data part.
     * @returns {void} - No return value.
     */
    newFormDataPart() {
        this.formDataPart = new FormDataPart();
        this.setState("multi-part-form-data-header");
    }
    /**
     * Runs parse.
     * @param {string} line - Line.
     * @returns {void} - No return value.
     */
    parse(line) {
        if (this.state == "status") {
            this.parseStatusLine(line);
        }
        else if (this.state == "headers") {
            this.parseHeader(line);
        }
        else if (this.state == "chunked-size") {
            this.parseChunkSizeLine(line);
        }
        else if (this.state == "chunked-trailer") {
            if (line == "\r\n") {
                this.finishChunkedBody();
                this.completeRequest();
            }
        }
        else if (this.state == "multi-part-form-data") {
            if (line == this.boundaryLine) {
                this.newFormDataPart();
            }
            else if (line == "\r\n") {
                this.setState("done");
            }
            else {
                throw new Error(`Expected boundary line but didn't get it: ${line}`);
            }
        }
        else if (this.state == "multi-part-form-data-header") {
            const header = this.readHeaderFromLine(line);
            if (header) {
                if (!this.formDataPart)
                    throw new Error("formDataPart not set");
                this.formDataPart.addHeader(header);
                //this.state == "multi-part-form-data"
            }
            else if (line == "\r\n") {
                this.setState("multi-part-form-data-body");
            }
        }
        else {
            throw new Error(`Unknown state parsing line: ${this.state}`);
        }
    }
    /**
     * Runs read header from line.
     * @param {string} line - Line.
     * @returns {Header | undefined} - The header from line.
     */
    readHeaderFromLine(line) {
        const match = line.match(/^(.+): (.+)\r\n/);
        if (match) {
            const header = new Header(match[1], match[2]);
            return header;
        }
    }
    /**
     * Runs add header.
     * @param {Header} header - Header value.
     */
    addHeader(header) {
        const formattedName = header.getFormattedName();
        const existingHeader = this.headersByName[formattedName];
        // RFC 9110 §5.3: a field may be repeated; its value is the concatenation of
        // all field values separated by commas, in wire order. Only Accept-Encoding
        // is consumed as a combined field by the server.
        if (existingHeader && COMBINING_HEADER_FIELDS.has(formattedName)) {
            existingHeader.value += `, ${header.getValue()}`;
        }
        else {
            this.headersByName[formattedName] = header;
        }
        if (formattedName == "content-length")
            this.contentLength = parseInt(header.getValue());
    }
    /**
     * Runs parse header.
     * @param {string} line - Line.
     * @returns {void} - No return value.
     */
    parseHeader(line) {
        const header = this.readHeaderFromLine(line);
        if (header) {
            this.logger.debugLowLevel(() => `Parsed header: ${header.toString()}`);
            this.addHeader(header);
            this.events.emit("header", header);
        }
        else if (line == "\r\n") {
            const httpMethod = this.httpMethod?.toUpperCase();
            if (!httpMethod)
                throw new Error("HTTP method not set");
            if (!this.expectsRequestBody(httpMethod)) {
                this.completeRequest();
            }
            else if (this.isChunkedEncoding()) {
                this.readingBody = true;
                this.bodyLength = 0;
                this.initializeChunkedBody();
            }
            else {
                this.readingBody = true;
                this.bodyLength = 0;
                if (this.contentLength !== undefined) {
                    if (Number.isNaN(this.contentLength))
                        throw new Error("Content length is invalid");
                    this.assertRequestBodySize(this.contentLength);
                }
                const match = this.getHeader("content-type")?.value?.match(/^multipart\/form-data;\s*boundary=(.+)$/i);
                if (match) {
                    this.boundary = match[1];
                    this.boundaryLine = `--${this.boundary}\r\n`;
                    this.boundaryLineNext = `\r\n--${this.boundary}\r\n`;
                    this.boundaryLineEnd = `\r\n--${this.boundary}--`;
                    this.multiPartyFormData = true;
                    this.setState("multi-part-form-data");
                }
                else if (this.contentLength === 0 || this.contentLength === undefined) {
                    this.completeRequest();
                }
                else {
                    /**
                     * Narrows the runtime value to the documented type.
                     * @type {Buffer[]} */
                    this.postBodyBuffers = [];
                    this.setState("post-body");
                }
            }
        }
    }
    /**
     * Runs parse status line.
     * @param {string} line - Line.
     * @returns {void} - No return value.
     */
    parseStatusLine(line) {
        const match = line.match(/^([A-Z-]+) (.+?) HTTP\/(.+)\r\n/);
        if (!match) {
            throw new Error(`Couldn't match status line from: ${line}`);
        }
        this.httpMethod = match[1];
        this.httpVersion = match[3];
        this.path = match[2];
        this.setState("headers");
        this.logger.debugLowLevel(() => ["Parsed status line", { httpMethod: this.httpMethod, httpVersion: this.httpVersion, path: this.path }]);
    }
    postRequestDone() {
        if (this.postBodyBuffers) {
            this.postBody = Buffer.concat(this.postBodyBuffers).toString("utf8");
        }
        this.postBodyBuffers = undefined;
        this.completeRequest();
    }
    /**
     * Runs expects request body.
     * @param {string} httpMethod - HTTP method.
     * @returns {boolean} - Whether the request expects a body.
     */
    expectsRequestBody(httpMethod) {
        return !["GET", "OPTIONS", "HEAD"].includes(httpMethod);
    }
    /**
     * Runs is chunked encoding.
     * @returns {boolean} - Whether the request uses chunked transfer encoding.
     */
    isChunkedEncoding() {
        const transferEncoding = this.getHeader("transfer-encoding")?.value?.toLowerCase();
        return Boolean(transferEncoding?.includes("chunked"));
    }
    /**
     * Runs initialize chunked body.
     * @returns {void} - No return value.
     */
    initializeChunkedBody() {
        this.chunkedBodyChars = [];
        this.currentChunkSize = undefined;
        this.currentChunkBytesRead = 0;
        this.setState("chunked-size");
    }
    /**
     * Runs parse chunk size line.
     * @param {string} line - Chunk size line.
     * @returns {void} - No return value.
     */
    parseChunkSizeLine(line) {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        const sizeToken = trimmed.split(";")[0]?.trim();
        if (!sizeToken)
            throw new Error(`Invalid chunk size line: ${line}`);
        const size = Number.parseInt(sizeToken, 16);
        if (!Number.isFinite(size))
            throw new Error(`Invalid chunk size: ${sizeToken}`);
        if (size === 0) {
            this.setState("chunked-trailer");
            return;
        }
        this.assertRequestBodySize((this.chunkedBodyChars?.length || 0) + size);
        this.currentChunkSize = size;
        this.currentChunkBytesRead = 0;
        this.setState("chunked-data");
    }
    /**
     * Runs finish chunked body.
     * @returns {void} - No return value.
     */
    finishChunkedBody() {
        if (this.chunkedBodyChars) {
            this.postBody = Buffer.from(this.chunkedBodyChars).toString("utf8");
        }
        delete this.chunkedBodyChars;
    }
    /**
     * Runs set state.
     * @param {string} newState - New state.
     * @returns {void} - No return value.
     */
    setState(newState) {
        this.logger.debugLowLevel(() => `Changing state from ${this.state} to ${newState}`);
        this.state = newState;
    }
    completeRequest = () => {
        this.state = "status"; // Reset state to new request
        this.completed = true;
        if (this.getHeader("content-type")?.value?.startsWith("application/json")) {
            this.parseApplicationJsonParams();
        }
        else if (this.multiPartyFormData) {
            // Done after each new form data part
        }
        else {
            this.parseQueryStringPostParams();
        }
        this.events.emit("completed");
    };
    parseApplicationJsonParams() {
        if (this.postBody) {
            const newParams = JSON.parse(this.postBody);
            incorporate(this.params, newParams);
        }
    }
    parseQueryStringPostParams() {
        if (this.postBody) {
            try {
                const parsedQuery = querystring.parse(this.postBody);
                /**
                 * Unparsed params.
                 * @type {Record<string, string | string[]>} */
                const unparsedParams = {};
                for (const [key, value] of Object.entries(parsedQuery)) {
                    if (typeof value !== "undefined") {
                        unparsedParams[key] = value;
                    }
                }
                const paramsToObject = new ParamsToObject(unparsedParams);
                const newParams = paramsToObject.toObject();
                incorporate(this.params, newParams);
            }
            catch (error) {
                const ensuredError = /** @type {Error & {velociousContext?: Record<string, ReturnType<typeof JSON.parse>>}} */ (error);
                ensuredError.velociousContext = {
                    ...(ensuredError.velociousContext || {}),
                    requestParsing: {
                        contentType: this.getHeader("content-type")?.value,
                        httpMethod: this.httpMethod,
                        parameterKeys: Object.keys(querystring.parse(this.postBody)),
                        path: this.path,
                        postBodyPreview: truncatePreview(this.postBody),
                        stage: "query-string-post-params"
                    }
                };
                throw ensuredError;
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtYnVmZmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSxpQ0FBaUMsQ0FBQTtBQUMxRCxPQUFPLFlBQVksTUFBTSxxQkFBcUIsQ0FBQTtBQUM5QyxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxFQUFDLDRCQUE0QixFQUFDLE1BQU0sY0FBYyxDQUFBO0FBQ3pELE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sb0JBQW9CLENBQUE7QUFDdkMsT0FBTyxjQUFjLE1BQU0sd0JBQXdCLENBQUE7QUFDbkQsT0FBTyxXQUFXLE1BQU0sYUFBYSxDQUFBO0FBRXJDOzs7eUJBR3lCO0FBQ3pCLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUE7QUFFNUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGVBQWUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxHQUFHLEdBQUc7SUFDekMsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFDL0MsSUFBSSxLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUs7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUV2QyxPQUFPLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQTtBQUN0QyxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDLFVBQVUsR0FBRyxDQUFDLENBQUE7SUFFZCxtQ0FBbUM7SUFDbkMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtJQUUzQjs7MEJBRXNCO0lBQ3RCLElBQUksR0FBRyxFQUFFLENBQUE7SUFFVCxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUUzQjs7d0NBRW9DO0lBQ3BDLGFBQWEsR0FBRyxFQUFFLENBQUE7SUFDbEI7O3NDQUVrQztJQUNsQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7SUFFNUIsa0JBQWtCLEdBQUcsS0FBSyxDQUFBO0lBRTFCLFNBQVMsR0FBRyxLQUFLLENBQUE7SUFDakIsTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUNYLFdBQVcsR0FBRyxLQUFLLENBQUE7SUFDbkIsS0FBSyxHQUFHLFFBQVEsQ0FBQTtJQUVoQjs7OztPQUlHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBQztRQUN6QixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQ2hELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsV0FBVztRQUMvQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGdDQUFnQyxFQUFFLENBQUE7UUFFdEUsSUFBSSxRQUFRLEtBQUssU0FBUyxJQUFJLFdBQVcsR0FBRyxRQUFRLEVBQUUsQ0FBQztZQUNyRCxNQUFNLElBQUksNEJBQTRCLENBQUMsRUFBQyxXQUFXLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtRQUNqRSxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU87UUFDTCx3QkFBd0I7SUFDMUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxJQUFJLENBQUMsSUFBSTtRQUNQLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUViLE9BQU8sS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUMzQixRQUFPLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztnQkFDbEIsS0FBSyxRQUFRLENBQUM7Z0JBQ2QsS0FBSyxTQUFTLENBQUM7Z0JBQ2YsS0FBSyxzQkFBc0IsQ0FBQztnQkFDNUIsS0FBSyw2QkFBNkIsQ0FBQztnQkFDbkMsS0FBSyxjQUFjLENBQUM7Z0JBQ3BCLEtBQUssaUJBQWlCO29CQUNwQixLQUFLLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUE7b0JBQ2xDLE1BQUs7Z0JBQ1AsS0FBSyxXQUFXO29CQUNkLEtBQUssR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQTtvQkFDdEMsTUFBSztnQkFDUDtvQkFDRSxLQUFLLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFDdEMsQ0FBQztZQUVELElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO2dCQUNuQixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDN0IsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUs7UUFDbEIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUE7UUFFNUMsSUFBSSxZQUFZLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUN4QixJQUFJLElBQUksQ0FBQyxXQUFXO2dCQUFFLElBQUksQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUE7WUFFNUQsS0FBSyxJQUFJLFNBQVMsR0FBRyxLQUFLLEVBQUUsU0FBUyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsU0FBUyxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUNwRSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtZQUNqQyxDQUFDO1lBRUQsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFBO1FBQ3BCLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxXQUFXO1lBQUUsSUFBSSxDQUFDLFVBQVUsSUFBSSxZQUFZLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUVqRSxJQUFJLElBQUksQ0FBQTtRQUVSLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDMUIsSUFBSSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxZQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFDekQsQ0FBQzthQUFNLENBQUM7WUFDTix1REFBdUQ7WUFDdkQsS0FBSyxJQUFJLFNBQVMsR0FBRyxLQUFLLEVBQUUsU0FBUyxJQUFJLFlBQVksRUFBRSxTQUFTLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ3RFLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO1lBQ2pDLENBQUM7WUFFRCxJQUFJLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUNqRCxJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNoQixDQUFDO1FBRUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUVoQixPQUFPLFlBQVksR0FBRyxDQUFDLENBQUE7SUFDekIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsWUFBWSxDQUFDLElBQUksRUFBRSxLQUFLO1FBQ3RCLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsaUNBQWlDLENBQUMsQ0FBQTtRQUM3RSxJQUFJLElBQUksQ0FBQyxhQUFhLEtBQUssU0FBUztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtRQUUvRSxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzVFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLEdBQUcsa0JBQWtCLENBQUMsQ0FBQTtRQUVsRSxJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFBO1FBQ3pELElBQUksQ0FBQyxVQUFVLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUVuQyxJQUFJLElBQUksQ0FBQyxhQUFhLElBQUksSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDaEUsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBQ3hCLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUs7UUFDbEIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRXhCLElBQUksSUFBSSxDQUFDLFdBQVc7WUFBRSxJQUFJLENBQUMsVUFBVSxJQUFJLENBQUMsQ0FBQTtRQUUxQyxRQUFPLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNsQixLQUFLLGNBQWMsRUFBRSxDQUFDO2dCQUNwQixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQTtnQkFFOUMsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEtBQUssU0FBUztvQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixDQUFDLENBQUE7Z0JBQ3RGLElBQUksQ0FBQyxnQkFBZ0I7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxDQUFBO2dCQUV0RSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7Z0JBQzNCOztvQ0FFb0I7Z0JBQ3BCLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxJQUFJLENBQUMscUJBQXFCLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUVuRSxJQUFJLENBQUMscUJBQXFCLEdBQUcscUJBQXFCLENBQUE7Z0JBRWxELElBQUkscUJBQXFCLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7b0JBQ25ELElBQUksQ0FBQyxvQkFBb0IsR0FBRyxDQUFDLENBQUE7b0JBQzdCLElBQUksQ0FBQyxRQUFRLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtnQkFDcEMsQ0FBQztnQkFFRCxNQUFLO1lBQ1AsQ0FBQztZQUNELEtBQUssbUJBQW1CO2dCQUN0QixJQUFJLENBQUMsb0JBQW9CLEdBQUcsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUVoRSxJQUFJLElBQUksQ0FBQyxvQkFBb0IsSUFBSSxDQUFDLEVBQUUsQ0FBQztvQkFDbkMsSUFBSSxDQUFDLHFCQUFxQixHQUFHLENBQUMsQ0FBQTtvQkFDOUIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsQ0FBQTtnQkFDL0IsQ0FBQztnQkFFRCxNQUFLO1lBQ1AsS0FBSywyQkFBMkIsRUFBRSxDQUFDO2dCQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVk7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxDQUFBO2dCQUN4RSxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWU7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFBO2dCQUMvRSxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQjtvQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUE7Z0JBRWpGLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFBO2dCQUVuQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUVmLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQTtnQkFDN0UsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLDJCQUEyQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDckYsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLENBQUMsQ0FBQTtnQkFFckYsTUFBTSw0QkFBNEIsR0FBRyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUE7Z0JBQy9FLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQ3ZGLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLHlCQUF5QixDQUFDLENBQUE7Z0JBRXZGLElBQUksbUJBQW1CLElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO29CQUNoRCxJQUFJLENBQUMsWUFBWSxDQUFDLGNBQWMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO29CQUNyRCxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtvQkFDdkIsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO2dCQUN4QixDQUFDO3FCQUFNLElBQUksb0JBQW9CLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7b0JBQ3pELElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxDQUFDLG9CQUFvQixDQUFDLENBQUE7b0JBQ3RELElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO29CQUN2QixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7Z0JBQ3hCLENBQUM7cUJBQU0sSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO29CQUN2RSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtvQkFDdkIsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO2dCQUN4QixDQUFDO3FCQUFNLElBQUksSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLElBQUksSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxDQUFDO29CQUNqRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtvQkFFdkIsTUFBTSxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDekIsQ0FBQztnQkFFRCxNQUFLO1lBQ1AsQ0FBQztZQUNEO2dCQUNFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLEVBQUUsRUFBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUN0RixDQUFDO1FBRUQsT0FBTyxLQUFLLEdBQUcsQ0FBQyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLElBQUk7UUFDWixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBRTVELElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsYUFBYSxJQUFJLEVBQUUsRUFBRSxFQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFFcEYsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsY0FBYztRQUNaOzs0Q0FFb0M7UUFDcEMsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLEtBQUssTUFBTSxtQkFBbUIsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDckQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO1lBRXRELE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUMsR0FBRyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUE7UUFDOUMsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7T0FHRztJQUNILGdCQUFnQjtRQUNkLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUE7UUFFdEMsSUFBSSxDQUFDLFlBQVk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFFNUQsSUFBSSxDQUFDLFlBQVksR0FBRyxTQUFTLENBQUE7UUFDN0IsWUFBWSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBRXJCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxDQUFBO0lBQ2xELENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILGVBQWU7UUFDYixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksWUFBWSxFQUFFLENBQUE7UUFDdEMsSUFBSSxDQUFDLFFBQVEsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO0lBQzlDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixJQUFJLElBQUksQ0FBQyxLQUFLLElBQUksUUFBUSxFQUFFLENBQUM7WUFDM0IsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM1QixDQUFDO2FBQU0sSUFBSSxJQUFJLENBQUMsS0FBSyxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ25DLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDeEIsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUN4QyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDL0IsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQzNDLElBQUksSUFBSSxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNuQixJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtnQkFDeEIsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3hCLENBQUM7UUFDSCxDQUFDO2FBQU0sSUFBSSxJQUFJLENBQUMsS0FBSyxJQUFJLHNCQUFzQixFQUFFLENBQUM7WUFDaEQsSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO2dCQUM5QixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7WUFDeEIsQ0FBQztpQkFBTSxJQUFJLElBQUksSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDMUIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUN2QixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsSUFBSSxFQUFFLENBQUMsQ0FBQTtZQUN0RSxDQUFDO1FBQ0gsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSw2QkFBNkIsRUFBRSxDQUFDO1lBQ3ZELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUU1QyxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNYLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWTtvQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDLENBQUE7Z0JBRS9ELElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUNuQyxzQ0FBc0M7WUFDeEMsQ0FBQztpQkFBTSxJQUFJLElBQUksSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDMUIsSUFBSSxDQUFDLFFBQVEsQ0FBQywyQkFBMkIsQ0FBQyxDQUFBO1lBQzVDLENBQUM7UUFDSCxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQzlELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGtCQUFrQixDQUFDLElBQUk7UUFDckIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBRTNDLElBQUksS0FBSyxFQUFFLENBQUM7WUFDVixNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFN0MsT0FBTyxNQUFNLENBQUE7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVMsQ0FBQyxNQUFNO1FBQ2QsTUFBTSxhQUFhLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDL0MsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUV4RCw0RUFBNEU7UUFDNUUsNEVBQTRFO1FBQzVFLGlEQUFpRDtRQUNqRCxJQUFJLGNBQWMsSUFBSSx1QkFBdUIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUNqRSxjQUFjLENBQUMsS0FBSyxJQUFJLEtBQUssTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUE7UUFDbEQsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxHQUFHLE1BQU0sQ0FBQTtRQUM1QyxDQUFDO1FBRUQsSUFBSSxhQUFhLElBQUksZ0JBQWdCO1lBQUUsSUFBSSxDQUFDLGFBQWEsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUE7SUFDekYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxXQUFXLENBQUMsSUFBSTtRQUNkLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUU1QyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ1gsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLENBQUMsa0JBQWtCLE1BQU0sQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDLENBQUE7WUFDdEUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUN0QixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDcEMsQ0FBQzthQUFNLElBQUksSUFBSSxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQzFCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsV0FBVyxFQUFFLENBQUE7WUFFakQsSUFBSSxDQUFDLFVBQVU7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1lBRXZELElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDekMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3hCLENBQUM7aUJBQU0sSUFBSSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDO2dCQUNwQyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtnQkFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxDQUFDLENBQUE7Z0JBQ25CLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1lBQzlCLENBQUM7aUJBQU0sQ0FBQztnQkFDTixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtnQkFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxDQUFDLENBQUE7Z0JBRW5CLElBQUksSUFBSSxDQUFDLGFBQWEsS0FBSyxTQUFTLEVBQUUsQ0FBQztvQkFDckMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUM7d0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFBO29CQUVsRixJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFBO2dCQUNoRCxDQUFDO2dCQUVELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFBO2dCQUV0RyxJQUFJLEtBQUssRUFBRSxDQUFDO29CQUNWLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO29CQUN4QixJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssSUFBSSxDQUFDLFFBQVEsTUFBTSxDQUFBO29CQUM1QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxJQUFJLENBQUMsUUFBUSxNQUFNLENBQUE7b0JBQ3BELElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUE7b0JBQ2pELElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUE7b0JBQzlCLElBQUksQ0FBQyxRQUFRLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtnQkFDdkMsQ0FBQztxQkFBTSxJQUFJLElBQUksQ0FBQyxhQUFhLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLEtBQUssU0FBUyxFQUFFLENBQUM7b0JBQ3hFLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtnQkFDeEIsQ0FBQztxQkFBTSxDQUFDO29CQUNOOzswQ0FFc0I7b0JBQ3RCLElBQUksQ0FBQyxlQUFlLEdBQUcsRUFBRSxDQUFBO29CQUV6QixJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFBO2dCQUM1QixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGVBQWUsQ0FBQyxJQUFJO1FBQ2xCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsaUNBQWlDLENBQUMsQ0FBQTtRQUUzRCxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWCxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBQzdELENBQUM7UUFFRCxJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUMxQixJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUMzQixJQUFJLENBQUMsSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUNwQixJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3hCLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsb0JBQW9CLEVBQUUsRUFBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBQyxDQUFDLENBQUMsQ0FBQTtJQUN4SSxDQUFDO0lBRUQsZUFBZTtRQUNiLElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3pCLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3RFLENBQUM7UUFFRCxJQUFJLENBQUMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtRQUVoQyxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxrQkFBa0IsQ0FBQyxVQUFVO1FBQzNCLE9BQU8sQ0FBQyxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3pELENBQUM7SUFFRDs7O09BR0c7SUFDSCxpQkFBaUI7UUFDZixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsbUJBQW1CLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLENBQUE7UUFFbEYsT0FBTyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7SUFDdkQsQ0FBQztJQUVEOzs7T0FHRztJQUNILHFCQUFxQjtRQUNuQixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsRUFBRSxDQUFBO1FBQzFCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7UUFDakMsSUFBSSxDQUFDLHFCQUFxQixHQUFHLENBQUMsQ0FBQTtRQUM5QixJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBQy9CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsa0JBQWtCLENBQUMsSUFBSTtRQUNyQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7UUFFM0IsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFNO1FBRXBCLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUE7UUFFL0MsSUFBSSxDQUFDLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBRW5FLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBRTNDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLFNBQVMsRUFBRSxDQUFDLENBQUE7UUFFL0UsSUFBSSxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDaEMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsTUFBTSxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUE7UUFDNUIsSUFBSSxDQUFDLHFCQUFxQixHQUFHLENBQUMsQ0FBQTtRQUM5QixJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBQy9CLENBQUM7SUFFRDs7O09BR0c7SUFDSCxpQkFBaUI7UUFDZixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQzFCLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDckUsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLGdCQUFnQixDQUFBO0lBQzlCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsUUFBUSxDQUFDLFFBQVE7UUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEVBQUUsQ0FBQyx1QkFBdUIsSUFBSSxDQUFDLEtBQUssT0FBTyxRQUFRLEVBQUUsQ0FBQyxDQUFBO1FBQ25GLElBQUksQ0FBQyxLQUFLLEdBQUcsUUFBUSxDQUFBO0lBQ3ZCLENBQUM7SUFFRCxlQUFlLEdBQUcsR0FBRyxFQUFFO1FBQ3JCLElBQUksQ0FBQyxLQUFLLEdBQUcsUUFBUSxDQUFBLENBQUMsNkJBQTZCO1FBQ25ELElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFBO1FBRXJCLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsRUFBRSxLQUFLLEVBQUUsVUFBVSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQztZQUMxRSxJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQTtRQUNuQyxDQUFDO2FBQU0sSUFBSSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUNuQyxxQ0FBcUM7UUFDdkMsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQTtRQUNuQyxDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDL0IsQ0FBQyxDQUFBO0lBRUQsMEJBQTBCO1FBQ3hCLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2xCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRTNDLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFBO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0lBRUQsMEJBQTBCO1FBQ3hCLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2xCLElBQUksQ0FBQztnQkFDSCxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDcEQ7OytEQUUrQztnQkFDL0MsTUFBTSxjQUFjLEdBQUcsRUFBRSxDQUFBO2dCQUV6QixLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO29CQUN2RCxJQUFJLE9BQU8sS0FBSyxLQUFLLFdBQVcsRUFBRSxDQUFDO3dCQUNqQyxjQUFjLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFBO29CQUM3QixDQUFDO2dCQUNILENBQUM7Z0JBRUQsTUFBTSxjQUFjLEdBQUcsSUFBSSxjQUFjLENBQUMsY0FBYyxDQUFDLENBQUE7Z0JBQ3pELE1BQU0sU0FBUyxHQUFHLGNBQWMsQ0FBQyxRQUFRLEVBQUUsQ0FBQTtnQkFFM0MsV0FBVyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUE7WUFDckMsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxZQUFZLEdBQUcseUZBQXlGLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFFdEgsWUFBWSxDQUFDLGdCQUFnQixHQUFHO29CQUM5QixHQUFHLENBQUMsWUFBWSxDQUFDLGdCQUFnQixJQUFJLEVBQUUsQ0FBQztvQkFDeEMsY0FBYyxFQUFFO3dCQUNkLFdBQVcsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxFQUFFLEtBQUs7d0JBQ2xELFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVTt3QkFDM0IsYUFBYSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7d0JBQzVELElBQUksRUFBRSxJQUFJLENBQUMsSUFBSTt3QkFDZixlQUFlLEVBQUUsZUFBZSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7d0JBQy9DLEtBQUssRUFBRSwwQkFBMEI7cUJBQ2xDO2lCQUNGLENBQUE7Z0JBRUQsTUFBTSxZQUFZLENBQUE7WUFDcEIsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQgRm9ybURhdGFQYXJ0IGZyb20gXCIuL2Zvcm0tZGF0YS1wYXJ0LmpzXCJcbmltcG9ydCBIZWFkZXIgZnJvbSBcIi4vaGVhZGVyLmpzXCJcbmltcG9ydCB7SHR0cFJlcXVlc3RCb2R5VG9vTGFyZ2VFcnJvcn0gZnJvbSBcIi4uL2Vycm9ycy5qc1wiXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUGFyYW1zVG9PYmplY3QgZnJvbSBcIi4uL3BhcmFtcy10by1vYmplY3QuanNcIlxuaW1wb3J0IHF1ZXJ5c3RyaW5nIGZyb20gXCJxdWVyeXN0cmluZ1wiXG5cbi8qKlxuICogUmVxdWVzdCBoZWFkZXIgZmllbGRzIHdob3NlIHJlcGVhdGVkIHdpcmUgZmllbGRzIGNvbWJpbmUgaW50byBvbmUgdmFsdWVcbiAqIChSRkMgOTExMCDCpzUuMykgYmVmb3JlIHRoZSBzZXJ2ZXIgY29uc3VtZXMgdGhlbS5cbiAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbmNvbnN0IENPTUJJTklOR19IRUFERVJfRklFTERTID0gbmV3IFNldChbXCJhY2NlcHQtZW5jb2RpbmdcIl0pXG5cbi8qKlxuICogUnVucyB0cnVuY2F0ZSBwcmV2aWV3LlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGlucHV0IC0gSW5wdXQgc3RyaW5nLlxuICogQHBhcmFtIHtudW1iZXJ9IFtsaW1pdF0gLSBNYXggcHJldmlldyBsZW5ndGguXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRydW5jYXRlZCBwcmV2aWV3LlxuICovXG5mdW5jdGlvbiB0cnVuY2F0ZVByZXZpZXcoaW5wdXQsIGxpbWl0ID0gMzAwKSB7XG4gIGlmICh0eXBlb2YgaW5wdXQgIT09IFwic3RyaW5nXCIpIHJldHVybiB1bmRlZmluZWRcbiAgaWYgKGlucHV0Lmxlbmd0aCA8PSBsaW1pdCkgcmV0dXJuIGlucHV0XG5cbiAgcmV0dXJuIGAke2lucHV0LnNsaWNlKDAsIGxpbWl0KX0uLi5gXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlcXVlc3RCdWZmZXIge1xuICBib2R5TGVuZ3RoID0gMFxuXG4gIC8qKiBAdHlwZSB7QnVmZmVyW10gfCB1bmRlZmluZWR9ICovXG4gIHBvc3RCb2R5QnVmZmVycyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEYXRhLlxuICAgKiBAdHlwZSB7bnVtYmVyW119ICovXG4gIGRhdGEgPSBbXVxuXG4gIGV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gIC8qKlxuICAgKiBIZWFkZXJzIGJ5IG5hbWUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBIZWFkZXI+fSAqL1xuICBoZWFkZXJzQnlOYW1lID0ge31cbiAgLyoqXG4gICAqIENodW5rZWQgYm9keSBjaGFycy5cbiAgICogQHR5cGUge251bWJlcltdIHwgdW5kZWZpbmVkfSAqL1xuICBjaHVua2VkQm9keUNoYXJzID0gdW5kZWZpbmVkXG5cbiAgbXVsdGlQYXJ0eUZvcm1EYXRhID0gZmFsc2VcblxuICBjb21wbGV0ZWQgPSBmYWxzZVxuICBwYXJhbXMgPSB7fVxuICByZWFkaW5nQm9keSA9IGZhbHNlXG4gIHN0YXRlID0gXCJzdGF0dXNcIlxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9ufSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcywge2RlYnVnOiBmYWxzZX0pXG4gIH1cblxuICAvKipcbiAgICogUmFpc2VzIGJlZm9yZSBidWZmZXJpbmcgYSByZXF1ZXN0IGJvZHkgYmV5b25kIHRoZSBjb25maWd1cmVkIGJvdW5kLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYWN0dWFsQnl0ZXMgLSBEZWNsYXJlZCBvciBhY2N1bXVsYXRlZCBkZWNvZGVkIGJvZHkgYnl0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0UmVxdWVzdEJvZHlTaXplKGFjdHVhbEJ5dGVzKSB7XG4gICAgY29uc3QgbWF4Qnl0ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0SHR0cFNlcnZlck1heFJlcXVlc3RCb2R5Qnl0ZXMoKVxuXG4gICAgaWYgKG1heEJ5dGVzICE9PSB1bmRlZmluZWQgJiYgYWN0dWFsQnl0ZXMgPiBtYXhCeXRlcykge1xuICAgICAgdGhyb3cgbmV3IEh0dHBSZXF1ZXN0Qm9keVRvb0xhcmdlRXJyb3Ioe2FjdHVhbEJ5dGVzLCBtYXhCeXRlc30pXG4gICAgfVxuICB9XG5cbiAgZGVzdHJveSgpIHtcbiAgICAvLyBEbyBub3RoaW5nIGZvciBub3cuLi5cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZlZWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7QnVmZmVyIHwgdW5kZWZpbmVkfSAtIFJlbWFpbmluZyBkYXRhLCBpZiBhbnkuXG4gICAqL1xuICBmZWVkKGRhdGEpIHtcbiAgICBsZXQgaW5kZXggPSAwXG5cbiAgICB3aGlsZSAoaW5kZXggPCBkYXRhLmxlbmd0aCkge1xuICAgICAgc3dpdGNoKHRoaXMuc3RhdGUpIHtcbiAgICAgICAgY2FzZSBcInN0YXR1c1wiOlxuICAgICAgICBjYXNlIFwiaGVhZGVyc1wiOlxuICAgICAgICBjYXNlIFwibXVsdGktcGFydC1mb3JtLWRhdGFcIjpcbiAgICAgICAgY2FzZSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWhlYWRlclwiOlxuICAgICAgICBjYXNlIFwiY2h1bmtlZC1zaXplXCI6XG4gICAgICAgIGNhc2UgXCJjaHVua2VkLXRyYWlsZXJcIjpcbiAgICAgICAgICBpbmRleCA9IHRoaXMuZmVlZExpbmUoZGF0YSwgaW5kZXgpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSBcInBvc3QtYm9keVwiOlxuICAgICAgICAgIGluZGV4ID0gdGhpcy5mZWVkUG9zdEJvZHkoZGF0YSwgaW5kZXgpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBpbmRleCA9IHRoaXMuZmVlZEJ5dGUoZGF0YSwgaW5kZXgpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmNvbXBsZXRlZCkge1xuICAgICAgICByZXR1cm4gZGF0YS5zdWJhcnJheShpbmRleClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgYnl0ZXMgZm9yIHRoZSBsaW5lLWJhc2VkIHN0YXRlcyB1cCB0byBhbmQgaW5jbHVkaW5nIHRoZSBuZXh0IG5ld2xpbmUuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBSZWFkIHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5ldyByZWFkIHBvc2l0aW9uLlxuICAgKi9cbiAgZmVlZExpbmUoZGF0YSwgaW5kZXgpIHtcbiAgICBjb25zdCBuZXdsaW5lSW5kZXggPSBkYXRhLmluZGV4T2YoMTAsIGluZGV4KVxuXG4gICAgaWYgKG5ld2xpbmVJbmRleCA9PT0gLTEpIHtcbiAgICAgIGlmICh0aGlzLnJlYWRpbmdCb2R5KSB0aGlzLmJvZHlMZW5ndGggKz0gZGF0YS5sZW5ndGggLSBpbmRleFxuXG4gICAgICBmb3IgKGxldCBkYXRhSW5kZXggPSBpbmRleDsgZGF0YUluZGV4IDwgZGF0YS5sZW5ndGg7IGRhdGFJbmRleCArPSAxKSB7XG4gICAgICAgIHRoaXMuZGF0YS5wdXNoKGRhdGFbZGF0YUluZGV4XSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRhdGEubGVuZ3RoXG4gICAgfVxuXG4gICAgaWYgKHRoaXMucmVhZGluZ0JvZHkpIHRoaXMuYm9keUxlbmd0aCArPSBuZXdsaW5lSW5kZXggKyAxIC0gaW5kZXhcblxuICAgIGxldCBsaW5lXG5cbiAgICBpZiAodGhpcy5kYXRhLmxlbmd0aCA9PSAwKSB7XG4gICAgICBsaW5lID0gZGF0YS50b1N0cmluZyhcImxhdGluMVwiLCBpbmRleCwgbmV3bGluZUluZGV4ICsgMSlcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVGhlIHJlc3Qgb2YgYSBsaW5lIHRoYXQgc3RhcnRlZCBpbiBhIHByZXZpb3VzIGNodW5rLlxuICAgICAgZm9yIChsZXQgZGF0YUluZGV4ID0gaW5kZXg7IGRhdGFJbmRleCA8PSBuZXdsaW5lSW5kZXg7IGRhdGFJbmRleCArPSAxKSB7XG4gICAgICAgIHRoaXMuZGF0YS5wdXNoKGRhdGFbZGF0YUluZGV4XSlcbiAgICAgIH1cblxuICAgICAgbGluZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgdGhpcy5kYXRhKVxuICAgICAgdGhpcy5kYXRhID0gW11cbiAgICB9XG5cbiAgICB0aGlzLnBhcnNlKGxpbmUpXG5cbiAgICByZXR1cm4gbmV3bGluZUluZGV4ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIGZpeGVkLWxlbmd0aCByZXF1ZXN0IGJvZHkgYnl0ZXMgaW4gYnVsay5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFJlYWQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTmV3IHJlYWQgcG9zaXRpb24uXG4gICAqL1xuICBmZWVkUG9zdEJvZHkoZGF0YSwgaW5kZXgpIHtcbiAgICBpZiAoIXRoaXMucG9zdEJvZHlCdWZmZXJzKSB0aHJvdyBuZXcgRXJyb3IoXCJwb3N0Qm9keUJ1ZmZlcnMgbm90IGluaXRpYWxpemVkXCIpXG4gICAgaWYgKHRoaXMuY29udGVudExlbmd0aCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJDb250ZW50IGxlbmd0aCBub3Qgc2V0XCIpXG5cbiAgICBjb25zdCByZW1haW5pbmdCb2R5Qnl0ZXMgPSBNYXRoLm1heCgxLCB0aGlzLmNvbnRlbnRMZW5ndGggLSB0aGlzLmJvZHlMZW5ndGgpXG4gICAgY29uc3QgZW5kSW5kZXggPSBNYXRoLm1pbihkYXRhLmxlbmd0aCwgaW5kZXggKyByZW1haW5pbmdCb2R5Qnl0ZXMpXG5cbiAgICB0aGlzLnBvc3RCb2R5QnVmZmVycy5wdXNoKGRhdGEuc3ViYXJyYXkoaW5kZXgsIGVuZEluZGV4KSlcbiAgICB0aGlzLmJvZHlMZW5ndGggKz0gZW5kSW5kZXggLSBpbmRleFxuXG4gICAgaWYgKHRoaXMuY29udGVudExlbmd0aCAmJiB0aGlzLmJvZHlMZW5ndGggPj0gdGhpcy5jb250ZW50TGVuZ3RoKSB7XG4gICAgICB0aGlzLnBvc3RSZXF1ZXN0RG9uZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGVuZEluZGV4XG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgYSBzaW5nbGUgYnl0ZSBmb3IgdGhlIGJ5dGUtYmFzZWQgcGFyc2VyIHN0YXRlcy5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFJlYWQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTmV3IHJlYWQgcG9zaXRpb24uXG4gICAqL1xuICBmZWVkQnl0ZShkYXRhLCBpbmRleCkge1xuICAgIGNvbnN0IGNoYXIgPSBkYXRhW2luZGV4XVxuXG4gICAgaWYgKHRoaXMucmVhZGluZ0JvZHkpIHRoaXMuYm9keUxlbmd0aCArPSAxXG5cbiAgICBzd2l0Y2godGhpcy5zdGF0ZSkge1xuICAgICAgY2FzZSBcImNodW5rZWQtZGF0YVwiOiB7XG4gICAgICAgIGNvbnN0IGNodW5rZWRCb2R5Q2hhcnMgPSB0aGlzLmNodW5rZWRCb2R5Q2hhcnNcblxuICAgICAgICBpZiAodGhpcy5jdXJyZW50Q2h1bmtTaXplID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkNodW5rIHNpemUgbm90IGluaXRpYWxpemVkXCIpXG4gICAgICAgIGlmICghY2h1bmtlZEJvZHlDaGFycykgdGhyb3cgbmV3IEVycm9yKFwiQ2h1bmtlZCBib2R5IG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgICAgIGNodW5rZWRCb2R5Q2hhcnMucHVzaChjaGFyKVxuICAgICAgICAvKipcbiAgICAgICAgICogQ3VycmVudCBjaHVuayBieXRlcyByZWFkLlxuICAgICAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgICAgICBjb25zdCBjdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSAodGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgfHwgMCkgKyAxXG5cbiAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSBjdXJyZW50Q2h1bmtCeXRlc1JlYWRcblxuICAgICAgICBpZiAoY3VycmVudENodW5rQnl0ZXNSZWFkID49IHRoaXMuY3VycmVudENodW5rU2l6ZSkge1xuICAgICAgICAgIHRoaXMuY3VycmVudENodW5rQ3JsZlJlYWQgPSAwXG4gICAgICAgICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtZGF0YS1jcmxmXCIpXG4gICAgICAgIH1cblxuICAgICAgICBicmVha1xuICAgICAgfVxuICAgICAgY2FzZSBcImNodW5rZWQtZGF0YS1jcmxmXCI6XG4gICAgICAgIHRoaXMuY3VycmVudENodW5rQ3JsZlJlYWQgPSAodGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCB8fCAwKSArIDFcblxuICAgICAgICBpZiAodGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCA+PSAyKSB7XG4gICAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSAwXG4gICAgICAgICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtc2l6ZVwiKVxuICAgICAgICB9XG5cbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1ib2R5XCI6IHtcbiAgICAgICAgaWYgKCF0aGlzLmZvcm1EYXRhUGFydCkgdGhyb3cgbmV3IEVycm9yKFwiRm9ybURhdGEgcGFydCBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICAgICAgaWYgKCF0aGlzLmJvdW5kYXJ5TGluZUVuZCkgdGhyb3cgbmV3IEVycm9yKFwiQm91bmRhcnkgbGluZSBlbmQgbm90IGluaXRpYWxpemVkXCIpXG4gICAgICAgIGlmICghdGhpcy5ib3VuZGFyeUxpbmVOZXh0KSB0aHJvdyBuZXcgRXJyb3IoXCJCb3VuZGFyeSBsaW5lIG5leHQgbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICAgICAgY29uc3QgYm9keSA9IHRoaXMuZm9ybURhdGFQYXJ0LmJvZHlcblxuICAgICAgICBib2R5LnB1c2goY2hhcilcblxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5RW5kUG9zaXRpb24gPSBib2R5Lmxlbmd0aCAtIHRoaXMuYm91bmRhcnlMaW5lRW5kLmxlbmd0aFxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5RW5kQ2hhcnMgPSBib2R5LnNsaWNlKHBvc3NpYmxlQm91bmRhcnlFbmRQb3NpdGlvbiwgYm9keS5sZW5ndGgpXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlFbmQgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIHBvc3NpYmxlQm91bmRhcnlFbmRDaGFycylcblxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5TmV4dFBvc2l0aW9uID0gYm9keS5sZW5ndGggLSB0aGlzLmJvdW5kYXJ5TGluZU5leHQubGVuZ3RoXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlOZXh0Q2hhcnMgPSBib2R5LnNsaWNlKHBvc3NpYmxlQm91bmRhcnlOZXh0UG9zaXRpb24sIGJvZHkubGVuZ3RoKVxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5TmV4dCA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgcG9zc2libGVCb3VuZGFyeU5leHRDaGFycylcblxuICAgICAgICBpZiAocG9zc2libGVCb3VuZGFyeUVuZCA9PSB0aGlzLmJvdW5kYXJ5TGluZUVuZCkge1xuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0LnJlbW92ZUZyb21Cb2R5KHBvc3NpYmxlQm91bmRhcnlFbmQpXG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnREb25lKClcbiAgICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICAgIH0gZWxzZSBpZiAocG9zc2libGVCb3VuZGFyeU5leHQgPT0gdGhpcy5ib3VuZGFyeUxpbmVOZXh0KSB7XG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnQucmVtb3ZlRnJvbUJvZHkocG9zc2libGVCb3VuZGFyeU5leHQpXG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnREb25lKClcbiAgICAgICAgICB0aGlzLm5ld0Zvcm1EYXRhUGFydCgpXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5jb250ZW50TGVuZ3RoICYmIHRoaXMuYm9keUxlbmd0aCA+PSB0aGlzLmNvbnRlbnRMZW5ndGgpIHtcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuICAgICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmZvcm1EYXRhUGFydC5jb250ZW50TGVuZ3RoICYmIHRoaXMuYm9keUxlbmd0aCA+PSB0aGlzLmZvcm1EYXRhUGFydC5jb250ZW50TGVuZ3RoKSB7XG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnREb25lKClcblxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInN0dWJcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYFVua25vd24gc3RhdGUgZm9yIHJlcXVlc3QgYnVmZmVyYCwge3N0YXRlOiB0aGlzLnN0YXRlfV0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGluZGV4ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7SGVhZGVyfSAtIFRoZSBoZWFkZXIuXG4gICAqL1xuICBnZXRIZWFkZXIobmFtZSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuaGVhZGVyc0J5TmFtZVtuYW1lLnRvTG93ZXJDYXNlKCkudHJpbSgpXVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBbYGdldEhlYWRlciAke25hbWV9YCwge3Jlc3VsdDogcmVzdWx0Py50b1N0cmluZygpfV0pXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaGVhZGVycyBoYXNoLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBUaGUgaGVhZGVycyBoYXNoLlxuICAgKi9cbiAgZ2V0SGVhZGVyc0hhc2goKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlckZvcm1hdHRlZE5hbWUgaW4gdGhpcy5oZWFkZXJzQnlOYW1lKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSB0aGlzLmhlYWRlcnNCeU5hbWVbaGVhZGVyRm9ybWF0dGVkTmFtZV1cblxuICAgICAgcmVzdWx0W2hlYWRlci5nZXROYW1lKCldID0gaGVhZGVyLmdldFZhbHVlKClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtIGRhdGEgcGFydCBkb25lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBmb3JtRGF0YVBhcnREb25lKCkge1xuICAgIGNvbnN0IGZvcm1EYXRhUGFydCA9IHRoaXMuZm9ybURhdGFQYXJ0XG5cbiAgICBpZiAoIWZvcm1EYXRhUGFydCkgdGhyb3cgbmV3IEVycm9yKFwiZm9ybURhdGFQYXJ0IHdhc250IHNldFwiKVxuXG4gICAgdGhpcy5mb3JtRGF0YVBhcnQgPSB1bmRlZmluZWRcbiAgICBmb3JtRGF0YVBhcnQuZmluaXNoKClcblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJmb3JtLWRhdGEtcGFydFwiLCBmb3JtRGF0YVBhcnQpXG4gIH1cblxuICBpc011bHRpUGFydHlGb3JtRGF0YSgpIHtcbiAgICByZXR1cm4gdGhpcy5tdWx0aVBhcnR5Rm9ybURhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5ldyBmb3JtIGRhdGEgcGFydC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbmV3Rm9ybURhdGFQYXJ0KCkge1xuICAgIHRoaXMuZm9ybURhdGFQYXJ0ID0gbmV3IEZvcm1EYXRhUGFydCgpXG4gICAgdGhpcy5zZXRTdGF0ZShcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWhlYWRlclwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gTGluZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcGFyc2UobGluZSkge1xuICAgIGlmICh0aGlzLnN0YXRlID09IFwic3RhdHVzXCIpIHtcbiAgICAgIHRoaXMucGFyc2VTdGF0dXNMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwiaGVhZGVyc1wiKSB7XG4gICAgICB0aGlzLnBhcnNlSGVhZGVyKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwiY2h1bmtlZC1zaXplXCIpIHtcbiAgICAgIHRoaXMucGFyc2VDaHVua1NpemVMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwiY2h1bmtlZC10cmFpbGVyXCIpIHtcbiAgICAgIGlmIChsaW5lID09IFwiXFxyXFxuXCIpIHtcbiAgICAgICAgdGhpcy5maW5pc2hDaHVua2VkQm9keSgpXG4gICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YVwiKSB7XG4gICAgICBpZiAobGluZSA9PSB0aGlzLmJvdW5kYXJ5TGluZSkge1xuICAgICAgICB0aGlzLm5ld0Zvcm1EYXRhUGFydCgpXG4gICAgICB9IGVsc2UgaWYgKGxpbmUgPT0gXCJcXHJcXG5cIikge1xuICAgICAgICB0aGlzLnNldFN0YXRlKFwiZG9uZVwiKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBib3VuZGFyeSBsaW5lIGJ1dCBkaWRuJ3QgZ2V0IGl0OiAke2xpbmV9YClcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1oZWFkZXJcIikge1xuICAgICAgY29uc3QgaGVhZGVyID0gdGhpcy5yZWFkSGVhZGVyRnJvbUxpbmUobGluZSlcblxuICAgICAgaWYgKGhlYWRlcikge1xuICAgICAgICBpZiAoIXRoaXMuZm9ybURhdGFQYXJ0KSB0aHJvdyBuZXcgRXJyb3IoXCJmb3JtRGF0YVBhcnQgbm90IHNldFwiKVxuXG4gICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0LmFkZEhlYWRlcihoZWFkZXIpXG4gICAgICAgIC8vdGhpcy5zdGF0ZSA9PSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhXCJcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PSBcIlxcclxcblwiKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1ib2R5XCIpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBzdGF0ZSBwYXJzaW5nIGxpbmU6ICR7dGhpcy5zdGF0ZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgaGVhZGVyIGZyb20gbGluZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBMaW5lLlxuICAgKiBAcmV0dXJucyB7SGVhZGVyIHwgdW5kZWZpbmVkfSAtIFRoZSBoZWFkZXIgZnJvbSBsaW5lLlxuICAgKi9cbiAgcmVhZEhlYWRlckZyb21MaW5lKGxpbmUpIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oLispOiAoLispXFxyXFxuLylcblxuICAgIGlmIChtYXRjaCkge1xuICAgICAgY29uc3QgaGVhZGVyID0gbmV3IEhlYWRlcihtYXRjaFsxXSwgbWF0Y2hbMl0pXG5cbiAgICAgIHJldHVybiBoZWFkZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge0hlYWRlcn0gaGVhZGVyIC0gSGVhZGVyIHZhbHVlLlxuICAgKi9cbiAgYWRkSGVhZGVyKGhlYWRlcikge1xuICAgIGNvbnN0IGZvcm1hdHRlZE5hbWUgPSBoZWFkZXIuZ2V0Rm9ybWF0dGVkTmFtZSgpXG4gICAgY29uc3QgZXhpc3RpbmdIZWFkZXIgPSB0aGlzLmhlYWRlcnNCeU5hbWVbZm9ybWF0dGVkTmFtZV1cblxuICAgIC8vIFJGQyA5MTEwIMKnNS4zOiBhIGZpZWxkIG1heSBiZSByZXBlYXRlZDsgaXRzIHZhbHVlIGlzIHRoZSBjb25jYXRlbmF0aW9uIG9mXG4gICAgLy8gYWxsIGZpZWxkIHZhbHVlcyBzZXBhcmF0ZWQgYnkgY29tbWFzLCBpbiB3aXJlIG9yZGVyLiBPbmx5IEFjY2VwdC1FbmNvZGluZ1xuICAgIC8vIGlzIGNvbnN1bWVkIGFzIGEgY29tYmluZWQgZmllbGQgYnkgdGhlIHNlcnZlci5cbiAgICBpZiAoZXhpc3RpbmdIZWFkZXIgJiYgQ09NQklOSU5HX0hFQURFUl9GSUVMRFMuaGFzKGZvcm1hdHRlZE5hbWUpKSB7XG4gICAgICBleGlzdGluZ0hlYWRlci52YWx1ZSArPSBgLCAke2hlYWRlci5nZXRWYWx1ZSgpfWBcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5oZWFkZXJzQnlOYW1lW2Zvcm1hdHRlZE5hbWVdID0gaGVhZGVyXG4gICAgfVxuXG4gICAgaWYgKGZvcm1hdHRlZE5hbWUgPT0gXCJjb250ZW50LWxlbmd0aFwiKSB0aGlzLmNvbnRlbnRMZW5ndGggPSBwYXJzZUludChoZWFkZXIuZ2V0VmFsdWUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBMaW5lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwYXJzZUhlYWRlcihsaW5lKSB7XG4gICAgY29uc3QgaGVhZGVyID0gdGhpcy5yZWFkSGVhZGVyRnJvbUxpbmUobGluZSlcblxuICAgIGlmIChoZWFkZXIpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gYFBhcnNlZCBoZWFkZXI6ICR7aGVhZGVyLnRvU3RyaW5nKCl9YClcbiAgICAgIHRoaXMuYWRkSGVhZGVyKGhlYWRlcilcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJoZWFkZXJcIiwgaGVhZGVyKVxuICAgIH0gZWxzZSBpZiAobGluZSA9PSBcIlxcclxcblwiKSB7XG4gICAgICBjb25zdCBodHRwTWV0aG9kID0gdGhpcy5odHRwTWV0aG9kPy50b1VwcGVyQ2FzZSgpXG5cbiAgICAgIGlmICghaHR0cE1ldGhvZCkgdGhyb3cgbmV3IEVycm9yKFwiSFRUUCBtZXRob2Qgbm90IHNldFwiKVxuXG4gICAgICBpZiAoIXRoaXMuZXhwZWN0c1JlcXVlc3RCb2R5KGh0dHBNZXRob2QpKSB7XG4gICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5pc0NodW5rZWRFbmNvZGluZygpKSB7XG4gICAgICAgIHRoaXMucmVhZGluZ0JvZHkgPSB0cnVlXG4gICAgICAgIHRoaXMuYm9keUxlbmd0aCA9IDBcbiAgICAgICAgdGhpcy5pbml0aWFsaXplQ2h1bmtlZEJvZHkoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5yZWFkaW5nQm9keSA9IHRydWVcbiAgICAgICAgdGhpcy5ib2R5TGVuZ3RoID0gMFxuXG4gICAgICAgIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGhpcy5jb250ZW50TGVuZ3RoKSkgdGhyb3cgbmV3IEVycm9yKFwiQ29udGVudCBsZW5ndGggaXMgaW52YWxpZFwiKVxuXG4gICAgICAgICAgdGhpcy5hc3NlcnRSZXF1ZXN0Qm9keVNpemUodGhpcy5jb250ZW50TGVuZ3RoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbWF0Y2ggPSB0aGlzLmdldEhlYWRlcihcImNvbnRlbnQtdHlwZVwiKT8udmFsdWU/Lm1hdGNoKC9ebXVsdGlwYXJ0XFwvZm9ybS1kYXRhO1xccypib3VuZGFyeT0oLispJC9pKVxuXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIHRoaXMuYm91bmRhcnkgPSBtYXRjaFsxXVxuICAgICAgICAgIHRoaXMuYm91bmRhcnlMaW5lID0gYC0tJHt0aGlzLmJvdW5kYXJ5fVxcclxcbmBcbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5TGluZU5leHQgPSBgXFxyXFxuLS0ke3RoaXMuYm91bmRhcnl9XFxyXFxuYFxuICAgICAgICAgIHRoaXMuYm91bmRhcnlMaW5lRW5kID0gYFxcclxcbi0tJHt0aGlzLmJvdW5kYXJ5fS0tYFxuICAgICAgICAgIHRoaXMubXVsdGlQYXJ0eUZvcm1EYXRhID0gdHJ1ZVxuICAgICAgICAgIHRoaXMuc2V0U3RhdGUoXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YVwiKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuY29udGVudExlbmd0aCA9PT0gMCB8fCB0aGlzLmNvbnRlbnRMZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvKipcbiAgICAgICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgICAgICogQHR5cGUge0J1ZmZlcltdfSAqL1xuICAgICAgICAgIHRoaXMucG9zdEJvZHlCdWZmZXJzID0gW11cblxuICAgICAgICAgIHRoaXMuc2V0U3RhdGUoXCJwb3N0LWJvZHlcIilcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIHN0YXR1cyBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIExpbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHBhcnNlU3RhdHVzTGluZShsaW5lKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFtBLVotXSspICguKz8pIEhUVFBcXC8oLispXFxyXFxuLylcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgbWF0Y2ggc3RhdHVzIGxpbmUgZnJvbTogJHtsaW5lfWApXG4gICAgfVxuXG4gICAgdGhpcy5odHRwTWV0aG9kID0gbWF0Y2hbMV1cbiAgICB0aGlzLmh0dHBWZXJzaW9uID0gbWF0Y2hbM11cbiAgICB0aGlzLnBhdGggPSBtYXRjaFsyXVxuICAgIHRoaXMuc2V0U3RhdGUoXCJoZWFkZXJzXCIpXG4gICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBbXCJQYXJzZWQgc3RhdHVzIGxpbmVcIiwge2h0dHBNZXRob2Q6IHRoaXMuaHR0cE1ldGhvZCwgaHR0cFZlcnNpb246IHRoaXMuaHR0cFZlcnNpb24sIHBhdGg6IHRoaXMucGF0aH1dKVxuICB9XG5cbiAgcG9zdFJlcXVlc3REb25lKCkge1xuICAgIGlmICh0aGlzLnBvc3RCb2R5QnVmZmVycykge1xuICAgICAgdGhpcy5wb3N0Qm9keSA9IEJ1ZmZlci5jb25jYXQodGhpcy5wb3N0Qm9keUJ1ZmZlcnMpLnRvU3RyaW5nKFwidXRmOFwiKVxuICAgIH1cblxuICAgIHRoaXMucG9zdEJvZHlCdWZmZXJzID0gdW5kZWZpbmVkXG5cbiAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBlY3RzIHJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGh0dHBNZXRob2QgLSBIVFRQIG1ldGhvZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCBleHBlY3RzIGEgYm9keS5cbiAgICovXG4gIGV4cGVjdHNSZXF1ZXN0Qm9keShodHRwTWV0aG9kKSB7XG4gICAgcmV0dXJuICFbXCJHRVRcIiwgXCJPUFRJT05TXCIsIFwiSEVBRFwiXS5pbmNsdWRlcyhodHRwTWV0aG9kKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgY2h1bmtlZCBlbmNvZGluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCB1c2VzIGNodW5rZWQgdHJhbnNmZXIgZW5jb2RpbmcuXG4gICAqL1xuICBpc0NodW5rZWRFbmNvZGluZygpIHtcbiAgICBjb25zdCB0cmFuc2ZlckVuY29kaW5nID0gdGhpcy5nZXRIZWFkZXIoXCJ0cmFuc2Zlci1lbmNvZGluZ1wiKT8udmFsdWU/LnRvTG93ZXJDYXNlKClcblxuICAgIHJldHVybiBCb29sZWFuKHRyYW5zZmVyRW5jb2Rpbmc/LmluY2x1ZGVzKFwiY2h1bmtlZFwiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgY2h1bmtlZCBib2R5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBpbml0aWFsaXplQ2h1bmtlZEJvZHkoKSB7XG4gICAgdGhpcy5jaHVua2VkQm9keUNoYXJzID0gW11cbiAgICB0aGlzLmN1cnJlbnRDaHVua1NpemUgPSB1bmRlZmluZWRcbiAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IDBcbiAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1zaXplXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBjaHVuayBzaXplIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gQ2h1bmsgc2l6ZSBsaW5lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwYXJzZUNodW5rU2l6ZUxpbmUobGluZSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKVxuXG4gICAgaWYgKCF0cmltbWVkKSByZXR1cm5cblxuICAgIGNvbnN0IHNpemVUb2tlbiA9IHRyaW1tZWQuc3BsaXQoXCI7XCIpWzBdPy50cmltKClcblxuICAgIGlmICghc2l6ZVRva2VuKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY2h1bmsgc2l6ZSBsaW5lOiAke2xpbmV9YClcblxuICAgIGNvbnN0IHNpemUgPSBOdW1iZXIucGFyc2VJbnQoc2l6ZVRva2VuLCAxNilcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNpemUpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY2h1bmsgc2l6ZTogJHtzaXplVG9rZW59YClcblxuICAgIGlmIChzaXplID09PSAwKSB7XG4gICAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC10cmFpbGVyXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmFzc2VydFJlcXVlc3RCb2R5U2l6ZSgodGhpcy5jaHVua2VkQm9keUNoYXJzPy5sZW5ndGggfHwgMCkgKyBzaXplKVxuXG4gICAgdGhpcy5jdXJyZW50Q2h1bmtTaXplID0gc2l6ZVxuICAgIHRoaXMuY3VycmVudENodW5rQnl0ZXNSZWFkID0gMFxuICAgIHRoaXMuc2V0U3RhdGUoXCJjaHVua2VkLWRhdGFcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmlzaCBjaHVua2VkIGJvZHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGZpbmlzaENodW5rZWRCb2R5KCkge1xuICAgIGlmICh0aGlzLmNodW5rZWRCb2R5Q2hhcnMpIHtcbiAgICAgIHRoaXMucG9zdEJvZHkgPSBCdWZmZXIuZnJvbSh0aGlzLmNodW5rZWRCb2R5Q2hhcnMpLnRvU3RyaW5nKFwidXRmOFwiKVxuICAgIH1cblxuICAgIGRlbGV0ZSB0aGlzLmNodW5rZWRCb2R5Q2hhcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBzdGF0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld1N0YXRlIC0gTmV3IHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRTdGF0ZShuZXdTdGF0ZSkge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gYENoYW5naW5nIHN0YXRlIGZyb20gJHt0aGlzLnN0YXRlfSB0byAke25ld1N0YXRlfWApXG4gICAgdGhpcy5zdGF0ZSA9IG5ld1N0YXRlXG4gIH1cblxuICBjb21wbGV0ZVJlcXVlc3QgPSAoKSA9PiB7XG4gICAgdGhpcy5zdGF0ZSA9IFwic3RhdHVzXCIgLy8gUmVzZXQgc3RhdGUgdG8gbmV3IHJlcXVlc3RcbiAgICB0aGlzLmNvbXBsZXRlZCA9IHRydWVcblxuICAgIGlmICh0aGlzLmdldEhlYWRlcihcImNvbnRlbnQtdHlwZVwiKT8udmFsdWU/LnN0YXJ0c1dpdGgoXCJhcHBsaWNhdGlvbi9qc29uXCIpKSB7XG4gICAgICB0aGlzLnBhcnNlQXBwbGljYXRpb25Kc29uUGFyYW1zKClcbiAgICB9IGVsc2UgaWYgKHRoaXMubXVsdGlQYXJ0eUZvcm1EYXRhKSB7XG4gICAgICAvLyBEb25lIGFmdGVyIGVhY2ggbmV3IGZvcm0gZGF0YSBwYXJ0XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGFyc2VRdWVyeVN0cmluZ1Bvc3RQYXJhbXMoKVxuICAgIH1cblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjb21wbGV0ZWRcIilcbiAgfVxuXG4gIHBhcnNlQXBwbGljYXRpb25Kc29uUGFyYW1zKCkge1xuICAgIGlmICh0aGlzLnBvc3RCb2R5KSB7XG4gICAgICBjb25zdCBuZXdQYXJhbXMgPSBKU09OLnBhcnNlKHRoaXMucG9zdEJvZHkpXG5cbiAgICAgIGluY29ycG9yYXRlKHRoaXMucGFyYW1zLCBuZXdQYXJhbXMpXG4gICAgfVxuICB9XG5cbiAgcGFyc2VRdWVyeVN0cmluZ1Bvc3RQYXJhbXMoKSB7XG4gICAgaWYgKHRoaXMucG9zdEJvZHkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZFF1ZXJ5ID0gcXVlcnlzdHJpbmcucGFyc2UodGhpcy5wb3N0Qm9keSlcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFVucGFyc2VkIHBhcmFtcy5cbiAgICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gKi9cbiAgICAgICAgY29uc3QgdW5wYXJzZWRQYXJhbXMgPSB7fVxuXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBhcnNlZFF1ZXJ5KSkge1xuICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgIHVucGFyc2VkUGFyYW1zW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBhcmFtc1RvT2JqZWN0ID0gbmV3IFBhcmFtc1RvT2JqZWN0KHVucGFyc2VkUGFyYW1zKVxuICAgICAgICBjb25zdCBuZXdQYXJhbXMgPSBwYXJhbXNUb09iamVjdC50b09iamVjdCgpXG5cbiAgICAgICAgaW5jb3Jwb3JhdGUodGhpcy5wYXJhbXMsIG5ld1BhcmFtcylcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVuc3VyZWRFcnJvciA9IC8qKiBAdHlwZSB7RXJyb3IgJiB7dmVsb2Npb3VzQ29udGV4dD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovIChlcnJvcilcblxuICAgICAgICBlbnN1cmVkRXJyb3IudmVsb2Npb3VzQ29udGV4dCA9IHtcbiAgICAgICAgICAuLi4oZW5zdXJlZEVycm9yLnZlbG9jaW91c0NvbnRleHQgfHwge30pLFxuICAgICAgICAgIHJlcXVlc3RQYXJzaW5nOiB7XG4gICAgICAgICAgICBjb250ZW50VHlwZTogdGhpcy5nZXRIZWFkZXIoXCJjb250ZW50LXR5cGVcIik/LnZhbHVlLFxuICAgICAgICAgICAgaHR0cE1ldGhvZDogdGhpcy5odHRwTWV0aG9kLFxuICAgICAgICAgICAgcGFyYW1ldGVyS2V5czogT2JqZWN0LmtleXMocXVlcnlzdHJpbmcucGFyc2UodGhpcy5wb3N0Qm9keSkpLFxuICAgICAgICAgICAgcGF0aDogdGhpcy5wYXRoLFxuICAgICAgICAgICAgcG9zdEJvZHlQcmV2aWV3OiB0cnVuY2F0ZVByZXZpZXcodGhpcy5wb3N0Qm9keSksXG4gICAgICAgICAgICBzdGFnZTogXCJxdWVyeS1zdHJpbmctcG9zdC1wYXJhbXNcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IGVuc3VyZWRFcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIl19