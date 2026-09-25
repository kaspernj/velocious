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
    /** @type {import("../../../configuration-types.js").ResolvedHttpRequestBodyPolicy | undefined} */
    requestBodyPolicy = undefined;
    /** @type {Buffer | undefined} */
    rawBodyBuffer = undefined;
    destroyed = false;
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
        const maxBytes = this.requestBodyPolicy?.maxRequestBodyBytes ?? this.configuration.getHttpServerMaxRequestBodyBytes();
        if (maxBytes !== undefined && actualBytes > maxBytes) {
            throw new HttpRequestBodyTooLargeError({ actualBytes, maxBytes });
        }
    }
    /**
     * Records bytes consumed after request headers. Multipart parsing can accept
     * an unframed body, so enforce its configured bound during accumulation.
     * @param {number} bytes - Newly consumed body bytes.
     * @returns {void}
     */
    recordBodyBytes(bytes) {
        this.bodyLength += bytes;
        if (this.multiPartyFormData)
            this.assertRequestBodySize(this.bodyLength);
    }
    destroy() {
        this.destroyed = true;
        this.rawBodyBuffer = undefined;
        this.postBody = undefined;
        this.postBodyBuffers = undefined;
        this.chunkedBodyChars = undefined;
        this.data = [];
        this.formDataPart = undefined;
    }
    /**
     * Returns exact request body bytes for a completed request whose policy selected raw mode.
     * @returns {Buffer} - A copy of the exact request body bytes.
     */
    getRawBody() {
        if (this.destroyed)
            throw new Error("Raw request body is unavailable after request cleanup");
        if (this.requestBodyPolicy?.mode !== "raw")
            throw new Error("Raw request body is available only when the request body policy selects raw mode");
        if (!this.completed || !this.rawBodyBuffer)
            throw new Error("Raw request body is unavailable before request parsing completes");
        return Buffer.from(this.rawBodyBuffer);
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
                this.recordBodyBytes(data.length - index);
            for (let dataIndex = index; dataIndex < data.length; dataIndex += 1) {
                this.data.push(data[dataIndex]);
            }
            return data.length;
        }
        if (this.readingBody)
            this.recordBodyBytes(newlineIndex + 1 - index);
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
        this.recordBodyBytes(endIndex - index);
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
            this.recordBodyBytes(1);
        switch (this.state) {
            case "chunked-data": {
                const chunkedBodyChars = this.chunkedBodyChars;
                if (this.currentChunkSize === undefined)
                    throw new Error("Chunk size not initialized");
                if (!chunkedBodyChars)
                    throw new Error("Chunked body not initialized");
                this.assertRequestBodySize(chunkedBodyChars.length + 1);
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
            if (!this.path)
                throw new Error("HTTP path not set");
            this.requestBodyPolicy = this.configuration.resolveHttpRequestBodyPolicy({
                headers: this.getHeadersHash(),
                httpMethod,
                path: this.path
            });
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
                const match = this.requestBodyPolicy.mode === "parsed"
                    ? this.getHeader("content-type")?.value?.match(/^multipart\/form-data;\s*boundary=(.+)$/i)
                    : null;
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
            const bodyBuffer = Buffer.concat(this.postBodyBuffers);
            if (this.requestBodyPolicy?.mode === "raw") {
                this.rawBodyBuffer = bodyBuffer;
            }
            else {
                this.postBody = bodyBuffer.toString("utf8");
            }
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
        if (!/^[0-9a-f]+$/iu.test(sizeToken))
            throw new Error(`Invalid chunk size: ${sizeToken}`);
        const size = Number.parseInt(sizeToken, 16);
        if (!Number.isSafeInteger(size))
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
            const bodyBuffer = Buffer.from(this.chunkedBodyChars);
            if (this.requestBodyPolicy?.mode === "raw") {
                this.rawBodyBuffer = bodyBuffer;
            }
            else {
                this.postBody = bodyBuffer.toString("utf8");
            }
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
        if (this.requestBodyPolicy?.mode === "raw") {
            this.rawBodyBuffer ||= Buffer.alloc(0);
        }
        else if (this.getHeader("content-type")?.value?.startsWith("application/json")) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtYnVmZmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSxpQ0FBaUMsQ0FBQTtBQUMxRCxPQUFPLFlBQVksTUFBTSxxQkFBcUIsQ0FBQTtBQUM5QyxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxFQUFDLDRCQUE0QixFQUFDLE1BQU0sY0FBYyxDQUFBO0FBQ3pELE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sb0JBQW9CLENBQUE7QUFDdkMsT0FBTyxjQUFjLE1BQU0sd0JBQXdCLENBQUE7QUFDbkQsT0FBTyxXQUFXLE1BQU0sYUFBYSxDQUFBO0FBRXJDOzs7eUJBR3lCO0FBQ3pCLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUE7QUFFNUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGVBQWUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxHQUFHLEdBQUc7SUFDekMsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFDL0MsSUFBSSxLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUs7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUV2QyxPQUFPLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQTtBQUN0QyxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDLFVBQVUsR0FBRyxDQUFDLENBQUE7SUFFZCxrR0FBa0c7SUFDbEcsaUJBQWlCLEdBQUcsU0FBUyxDQUFBO0lBRTdCLGlDQUFpQztJQUNqQyxhQUFhLEdBQUcsU0FBUyxDQUFBO0lBRXpCLFNB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QUFJLENBQUMsVUFBVTt3QkFDM0IsYUFBYSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7d0JBQzVELElBQUksRUFBRSxJQUFJLENBQUMsSUFBSTt3QkFDZixlQUFlLEVBQUUsZUFBZSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7d0JBQy9DLEtBQUssRUFBRSwwQkFBMEI7cUJBQ2xDO2lCQUNGLENBQUE7Z0JBRUQsTUFBTSxZQUFZLENBQUE7WUFDcEIsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQgRm9ybURhdGFQYXJ0IGZyb20gXCIuL2Zvcm0tZGF0YS1wYXJ0LmpzXCJcbmltcG9ydCBIZWFkZXIgZnJvbSBcIi4vaGVhZGVyLmpzXCJcbmltcG9ydCB7SHR0cFJlcXVlc3RCb2R5VG9vTGFyZ2VFcnJvcn0gZnJvbSBcIi4uL2Vycm9ycy5qc1wiXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUGFyYW1zVG9PYmplY3QgZnJvbSBcIi4uL3BhcmFtcy10by1vYmplY3QuanNcIlxuaW1wb3J0IHF1ZXJ5c3RyaW5nIGZyb20gXCJxdWVyeXN0cmluZ1wiXG5cbi8qKlxuICogUmVxdWVzdCBoZWFkZXIgZmllbGRzIHdob3NlIHJlcGVhdGVkIHdpcmUgZmllbGRzIGNvbWJpbmUgaW50byBvbmUgdmFsdWVcbiAqIChSRkMgOTExMCDCpzUuMykgYmVmb3JlIHRoZSBzZXJ2ZXIgY29uc3VtZXMgdGhlbS5cbiAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbmNvbnN0IENPTUJJTklOR19IRUFERVJfRklFTERTID0gbmV3IFNldChbXCJhY2NlcHQtZW5jb2RpbmdcIl0pXG5cbi8qKlxuICogUnVucyB0cnVuY2F0ZSBwcmV2aWV3LlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGlucHV0IC0gSW5wdXQgc3RyaW5nLlxuICogQHBhcmFtIHtudW1iZXJ9IFtsaW1pdF0gLSBNYXggcHJldmlldyBsZW5ndGguXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRydW5jYXRlZCBwcmV2aWV3LlxuICovXG5mdW5jdGlvbiB0cnVuY2F0ZVByZXZpZXcoaW5wdXQsIGxpbWl0ID0gMzAwKSB7XG4gIGlmICh0eXBlb2YgaW5wdXQgIT09IFwic3RyaW5nXCIpIHJldHVybiB1bmRlZmluZWRcbiAgaWYgKGlucHV0Lmxlbmd0aCA8PSBsaW1pdCkgcmV0dXJuIGlucHV0XG5cbiAgcmV0dXJuIGAke2lucHV0LnNsaWNlKDAsIGxpbWl0KX0uLi5gXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlcXVlc3RCdWZmZXIge1xuICBib2R5TGVuZ3RoID0gMFxuXG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEh0dHBSZXF1ZXN0Qm9keVBvbGljeSB8IHVuZGVmaW5lZH0gKi9cbiAgcmVxdWVzdEJvZHlQb2xpY3kgPSB1bmRlZmluZWRcblxuICAvKiogQHR5cGUge0J1ZmZlciB8IHVuZGVmaW5lZH0gKi9cbiAgcmF3Qm9keUJ1ZmZlciA9IHVuZGVmaW5lZFxuXG4gIGRlc3Ryb3llZCA9IGZhbHNlXG5cbiAgLyoqIEB0eXBlIHtCdWZmZXJbXSB8IHVuZGVmaW5lZH0gKi9cbiAgcG9zdEJvZHlCdWZmZXJzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERhdGEuXG4gICAqIEB0eXBlIHtudW1iZXJbXX0gKi9cbiAgZGF0YSA9IFtdXG5cbiAgZXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbiAgLyoqXG4gICAqIEhlYWRlcnMgYnkgbmFtZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEhlYWRlcj59ICovXG4gIGhlYWRlcnNCeU5hbWUgPSB7fVxuICAvKipcbiAgICogQ2h1bmtlZCBib2R5IGNoYXJzLlxuICAgKiBAdHlwZSB7bnVtYmVyW10gfCB1bmRlZmluZWR9ICovXG4gIGNodW5rZWRCb2R5Q2hhcnMgPSB1bmRlZmluZWRcblxuICBtdWx0aVBhcnR5Rm9ybURhdGEgPSBmYWxzZVxuXG4gIGNvbXBsZXRlZCA9IGZhbHNlXG4gIHBhcmFtcyA9IHt9XG4gIHJlYWRpbmdCb2R5ID0gZmFsc2VcbiAgc3RhdGUgPSBcInN0YXR1c1wiXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb259KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzLCB7ZGVidWc6IGZhbHNlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlzZXMgYmVmb3JlIGJ1ZmZlcmluZyBhIHJlcXVlc3QgYm9keSBiZXlvbmQgdGhlIGNvbmZpZ3VyZWQgYm91bmQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhY3R1YWxCeXRlcyAtIERlY2xhcmVkIG9yIGFjY3VtdWxhdGVkIGRlY29kZWQgYm9keSBieXRlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRSZXF1ZXN0Qm9keVNpemUoYWN0dWFsQnl0ZXMpIHtcbiAgICBjb25zdCBtYXhCeXRlcyA9IHRoaXMucmVxdWVzdEJvZHlQb2xpY3k/Lm1heFJlcXVlc3RCb2R5Qnl0ZXMgPz8gdGhpcy5jb25maWd1cmF0aW9uLmdldEh0dHBTZXJ2ZXJNYXhSZXF1ZXN0Qm9keUJ5dGVzKClcblxuICAgIGlmIChtYXhCeXRlcyAhPT0gdW5kZWZpbmVkICYmIGFjdHVhbEJ5dGVzID4gbWF4Qnl0ZXMpIHtcbiAgICAgIHRocm93IG5ldyBIdHRwUmVxdWVzdEJvZHlUb29MYXJnZUVycm9yKHthY3R1YWxCeXRlcywgbWF4Qnl0ZXN9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGJ5dGVzIGNvbnN1bWVkIGFmdGVyIHJlcXVlc3QgaGVhZGVycy4gTXVsdGlwYXJ0IHBhcnNpbmcgY2FuIGFjY2VwdFxuICAgKiBhbiB1bmZyYW1lZCBib2R5LCBzbyBlbmZvcmNlIGl0cyBjb25maWd1cmVkIGJvdW5kIGR1cmluZyBhY2N1bXVsYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBieXRlcyAtIE5ld2x5IGNvbnN1bWVkIGJvZHkgYnl0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQm9keUJ5dGVzKGJ5dGVzKSB7XG4gICAgdGhpcy5ib2R5TGVuZ3RoICs9IGJ5dGVzXG5cbiAgICBpZiAodGhpcy5tdWx0aVBhcnR5Rm9ybURhdGEpIHRoaXMuYXNzZXJ0UmVxdWVzdEJvZHlTaXplKHRoaXMuYm9keUxlbmd0aClcbiAgfVxuXG4gIGRlc3Ryb3koKSB7XG4gICAgdGhpcy5kZXN0cm95ZWQgPSB0cnVlXG4gICAgdGhpcy5yYXdCb2R5QnVmZmVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5wb3N0Qm9keSA9IHVuZGVmaW5lZFxuICAgIHRoaXMucG9zdEJvZHlCdWZmZXJzID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jaHVua2VkQm9keUNoYXJzID0gdW5kZWZpbmVkXG4gICAgdGhpcy5kYXRhID0gW11cbiAgICB0aGlzLmZvcm1EYXRhUGFydCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgZXhhY3QgcmVxdWVzdCBib2R5IGJ5dGVzIGZvciBhIGNvbXBsZXRlZCByZXF1ZXN0IHdob3NlIHBvbGljeSBzZWxlY3RlZCByYXcgbW9kZS5cbiAgICogQHJldHVybnMge0J1ZmZlcn0gLSBBIGNvcHkgb2YgdGhlIGV4YWN0IHJlcXVlc3QgYm9keSBieXRlcy5cbiAgICovXG4gIGdldFJhd0JvZHkoKSB7XG4gICAgaWYgKHRoaXMuZGVzdHJveWVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSYXcgcmVxdWVzdCBib2R5IGlzIHVuYXZhaWxhYmxlIGFmdGVyIHJlcXVlc3QgY2xlYW51cFwiKVxuICAgIGlmICh0aGlzLnJlcXVlc3RCb2R5UG9saWN5Py5tb2RlICE9PSBcInJhd1wiKSB0aHJvdyBuZXcgRXJyb3IoXCJSYXcgcmVxdWVzdCBib2R5IGlzIGF2YWlsYWJsZSBvbmx5IHdoZW4gdGhlIHJlcXVlc3QgYm9keSBwb2xpY3kgc2VsZWN0cyByYXcgbW9kZVwiKVxuICAgIGlmICghdGhpcy5jb21wbGV0ZWQgfHwgIXRoaXMucmF3Qm9keUJ1ZmZlcikgdGhyb3cgbmV3IEVycm9yKFwiUmF3IHJlcXVlc3QgYm9keSBpcyB1bmF2YWlsYWJsZSBiZWZvcmUgcmVxdWVzdCBwYXJzaW5nIGNvbXBsZXRlc1wiKVxuXG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKHRoaXMucmF3Qm9keUJ1ZmZlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZlZWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7QnVmZmVyIHwgdW5kZWZpbmVkfSAtIFJlbWFpbmluZyBkYXRhLCBpZiBhbnkuXG4gICAqL1xuICBmZWVkKGRhdGEpIHtcbiAgICBsZXQgaW5kZXggPSAwXG5cbiAgICB3aGlsZSAoaW5kZXggPCBkYXRhLmxlbmd0aCkge1xuICAgICAgc3dpdGNoKHRoaXMuc3RhdGUpIHtcbiAgICAgICAgY2FzZSBcInN0YXR1c1wiOlxuICAgICAgICBjYXNlIFwiaGVhZGVyc1wiOlxuICAgICAgICBjYXNlIFwibXVsdGktcGFydC1mb3JtLWRhdGFcIjpcbiAgICAgICAgY2FzZSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWhlYWRlclwiOlxuICAgICAgICBjYXNlIFwiY2h1bmtlZC1zaXplXCI6XG4gICAgICAgIGNhc2UgXCJjaHVua2VkLXRyYWlsZXJcIjpcbiAgICAgICAgICBpbmRleCA9IHRoaXMuZmVlZExpbmUoZGF0YSwgaW5kZXgpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSBcInBvc3QtYm9keVwiOlxuICAgICAgICAgIGluZGV4ID0gdGhpcy5mZWVkUG9zdEJvZHkoZGF0YSwgaW5kZXgpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBpbmRleCA9IHRoaXMuZmVlZEJ5dGUoZGF0YSwgaW5kZXgpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmNvbXBsZXRlZCkge1xuICAgICAgICByZXR1cm4gZGF0YS5zdWJhcnJheShpbmRleClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgYnl0ZXMgZm9yIHRoZSBsaW5lLWJhc2VkIHN0YXRlcyB1cCB0byBhbmQgaW5jbHVkaW5nIHRoZSBuZXh0IG5ld2xpbmUuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBSZWFkIHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5ldyByZWFkIHBvc2l0aW9uLlxuICAgKi9cbiAgZmVlZExpbmUoZGF0YSwgaW5kZXgpIHtcbiAgICBjb25zdCBuZXdsaW5lSW5kZXggPSBkYXRhLmluZGV4T2YoMTAsIGluZGV4KVxuXG4gICAgaWYgKG5ld2xpbmVJbmRleCA9PT0gLTEpIHtcbiAgICAgIGlmICh0aGlzLnJlYWRpbmdCb2R5KSB0aGlzLnJlY29yZEJvZHlCeXRlcyhkYXRhLmxlbmd0aCAtIGluZGV4KVxuXG4gICAgICBmb3IgKGxldCBkYXRhSW5kZXggPSBpbmRleDsgZGF0YUluZGV4IDwgZGF0YS5sZW5ndGg7IGRhdGFJbmRleCArPSAxKSB7XG4gICAgICAgIHRoaXMuZGF0YS5wdXNoKGRhdGFbZGF0YUluZGV4XSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRhdGEubGVuZ3RoXG4gICAgfVxuXG4gICAgaWYgKHRoaXMucmVhZGluZ0JvZHkpIHRoaXMucmVjb3JkQm9keUJ5dGVzKG5ld2xpbmVJbmRleCArIDEgLSBpbmRleClcblxuICAgIGxldCBsaW5lXG5cbiAgICBpZiAodGhpcy5kYXRhLmxlbmd0aCA9PSAwKSB7XG4gICAgICBsaW5lID0gZGF0YS50b1N0cmluZyhcImxhdGluMVwiLCBpbmRleCwgbmV3bGluZUluZGV4ICsgMSlcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVGhlIHJlc3Qgb2YgYSBsaW5lIHRoYXQgc3RhcnRlZCBpbiBhIHByZXZpb3VzIGNodW5rLlxuICAgICAgZm9yIChsZXQgZGF0YUluZGV4ID0gaW5kZXg7IGRhdGFJbmRleCA8PSBuZXdsaW5lSW5kZXg7IGRhdGFJbmRleCArPSAxKSB7XG4gICAgICAgIHRoaXMuZGF0YS5wdXNoKGRhdGFbZGF0YUluZGV4XSlcbiAgICAgIH1cblxuICAgICAgbGluZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgdGhpcy5kYXRhKVxuICAgICAgdGhpcy5kYXRhID0gW11cbiAgICB9XG5cbiAgICB0aGlzLnBhcnNlKGxpbmUpXG5cbiAgICByZXR1cm4gbmV3bGluZUluZGV4ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIGZpeGVkLWxlbmd0aCByZXF1ZXN0IGJvZHkgYnl0ZXMgaW4gYnVsay5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFJlYWQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTmV3IHJlYWQgcG9zaXRpb24uXG4gICAqL1xuICBmZWVkUG9zdEJvZHkoZGF0YSwgaW5kZXgpIHtcbiAgICBpZiAoIXRoaXMucG9zdEJvZHlCdWZmZXJzKSB0aHJvdyBuZXcgRXJyb3IoXCJwb3N0Qm9keUJ1ZmZlcnMgbm90IGluaXRpYWxpemVkXCIpXG4gICAgaWYgKHRoaXMuY29udGVudExlbmd0aCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJDb250ZW50IGxlbmd0aCBub3Qgc2V0XCIpXG5cbiAgICBjb25zdCByZW1haW5pbmdCb2R5Qnl0ZXMgPSBNYXRoLm1heCgxLCB0aGlzLmNvbnRlbnRMZW5ndGggLSB0aGlzLmJvZHlMZW5ndGgpXG4gICAgY29uc3QgZW5kSW5kZXggPSBNYXRoLm1pbihkYXRhLmxlbmd0aCwgaW5kZXggKyByZW1haW5pbmdCb2R5Qnl0ZXMpXG5cbiAgICB0aGlzLnBvc3RCb2R5QnVmZmVycy5wdXNoKGRhdGEuc3ViYXJyYXkoaW5kZXgsIGVuZEluZGV4KSlcbiAgICB0aGlzLnJlY29yZEJvZHlCeXRlcyhlbmRJbmRleCAtIGluZGV4KVxuXG4gICAgaWYgKHRoaXMuY29udGVudExlbmd0aCAmJiB0aGlzLmJvZHlMZW5ndGggPj0gdGhpcy5jb250ZW50TGVuZ3RoKSB7XG4gICAgICB0aGlzLnBvc3RSZXF1ZXN0RG9uZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGVuZEluZGV4XG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgYSBzaW5nbGUgYnl0ZSBmb3IgdGhlIGJ5dGUtYmFzZWQgcGFyc2VyIHN0YXRlcy5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFJlYWQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTmV3IHJlYWQgcG9zaXRpb24uXG4gICAqL1xuICBmZWVkQnl0ZShkYXRhLCBpbmRleCkge1xuICAgIGNvbnN0IGNoYXIgPSBkYXRhW2luZGV4XVxuXG4gICAgaWYgKHRoaXMucmVhZGluZ0JvZHkpIHRoaXMucmVjb3JkQm9keUJ5dGVzKDEpXG5cbiAgICBzd2l0Y2godGhpcy5zdGF0ZSkge1xuICAgICAgY2FzZSBcImNodW5rZWQtZGF0YVwiOiB7XG4gICAgICAgIGNvbnN0IGNodW5rZWRCb2R5Q2hhcnMgPSB0aGlzLmNodW5rZWRCb2R5Q2hhcnNcblxuICAgICAgICBpZiAodGhpcy5jdXJyZW50Q2h1bmtTaXplID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkNodW5rIHNpemUgbm90IGluaXRpYWxpemVkXCIpXG4gICAgICAgIGlmICghY2h1bmtlZEJvZHlDaGFycykgdGhyb3cgbmV3IEVycm9yKFwiQ2h1bmtlZCBib2R5IG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgICAgIHRoaXMuYXNzZXJ0UmVxdWVzdEJvZHlTaXplKGNodW5rZWRCb2R5Q2hhcnMubGVuZ3RoICsgMSlcbiAgICAgICAgY2h1bmtlZEJvZHlDaGFycy5wdXNoKGNoYXIpXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDdXJyZW50IGNodW5rIGJ5dGVzIHJlYWQuXG4gICAgICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgICAgIGNvbnN0IGN1cnJlbnRDaHVua0J5dGVzUmVhZCA9ICh0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCB8fCAwKSArIDFcblxuICAgICAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IGN1cnJlbnRDaHVua0J5dGVzUmVhZFxuXG4gICAgICAgIGlmIChjdXJyZW50Q2h1bmtCeXRlc1JlYWQgPj0gdGhpcy5jdXJyZW50Q2h1bmtTaXplKSB7XG4gICAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCA9IDBcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1kYXRhLWNybGZcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgICBjYXNlIFwiY2h1bmtlZC1kYXRhLWNybGZcIjpcbiAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCA9ICh0aGlzLmN1cnJlbnRDaHVua0NybGZSZWFkIHx8IDApICsgMVxuXG4gICAgICAgIGlmICh0aGlzLmN1cnJlbnRDaHVua0NybGZSZWFkID49IDIpIHtcbiAgICAgICAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IDBcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1zaXplXCIpXG4gICAgICAgIH1cblxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWJvZHlcIjoge1xuICAgICAgICBpZiAoIXRoaXMuZm9ybURhdGFQYXJ0KSB0aHJvdyBuZXcgRXJyb3IoXCJGb3JtRGF0YSBwYXJ0IG5vdCBpbml0aWFsaXplZFwiKVxuICAgICAgICBpZiAoIXRoaXMuYm91bmRhcnlMaW5lRW5kKSB0aHJvdyBuZXcgRXJyb3IoXCJCb3VuZGFyeSBsaW5lIGVuZCBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICAgICAgaWYgKCF0aGlzLmJvdW5kYXJ5TGluZU5leHQpIHRocm93IG5ldyBFcnJvcihcIkJvdW5kYXJ5IGxpbmUgbmV4dCBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgICAgICBjb25zdCBib2R5ID0gdGhpcy5mb3JtRGF0YVBhcnQuYm9keVxuXG4gICAgICAgIGJvZHkucHVzaChjaGFyKVxuXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlFbmRQb3NpdGlvbiA9IGJvZHkubGVuZ3RoIC0gdGhpcy5ib3VuZGFyeUxpbmVFbmQubGVuZ3RoXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlFbmRDaGFycyA9IGJvZHkuc2xpY2UocG9zc2libGVCb3VuZGFyeUVuZFBvc2l0aW9uLCBib2R5Lmxlbmd0aClcbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeUVuZCA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgcG9zc2libGVCb3VuZGFyeUVuZENoYXJzKVxuXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlOZXh0UG9zaXRpb24gPSBib2R5Lmxlbmd0aCAtIHRoaXMuYm91bmRhcnlMaW5lTmV4dC5sZW5ndGhcbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeU5leHRDaGFycyA9IGJvZHkuc2xpY2UocG9zc2libGVCb3VuZGFyeU5leHRQb3NpdGlvbiwgYm9keS5sZW5ndGgpXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlOZXh0ID0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBwb3NzaWJsZUJvdW5kYXJ5TmV4dENoYXJzKVxuXG4gICAgICAgIGlmIChwb3NzaWJsZUJvdW5kYXJ5RW5kID09IHRoaXMuYm91bmRhcnlMaW5lRW5kKSB7XG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnQucmVtb3ZlRnJvbUJvZHkocG9zc2libGVCb3VuZGFyeUVuZClcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuICAgICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgICAgfSBlbHNlIGlmIChwb3NzaWJsZUJvdW5kYXJ5TmV4dCA9PSB0aGlzLmJvdW5kYXJ5TGluZU5leHQpIHtcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydC5yZW1vdmVGcm9tQm9keShwb3NzaWJsZUJvdW5kYXJ5TmV4dClcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuICAgICAgICAgIHRoaXMubmV3Rm9ybURhdGFQYXJ0KClcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggJiYgdGhpcy5ib2R5TGVuZ3RoID49IHRoaXMuY29udGVudExlbmd0aCkge1xuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0RG9uZSgpXG4gICAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZm9ybURhdGFQYXJ0LmNvbnRlbnRMZW5ndGggJiYgdGhpcy5ib2R5TGVuZ3RoID49IHRoaXMuZm9ybURhdGFQYXJ0LmNvbnRlbnRMZW5ndGgpIHtcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3R1YlwiKVxuICAgICAgICB9XG5cbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgVW5rbm93biBzdGF0ZSBmb3IgcmVxdWVzdCBidWZmZXJgLCB7c3RhdGU6IHRoaXMuc3RhdGV9XSlcbiAgICB9XG5cbiAgICByZXR1cm4gaW5kZXggKyAxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtIZWFkZXJ9IC0gVGhlIGhlYWRlci5cbiAgICovXG4gIGdldEhlYWRlcihuYW1lKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5oZWFkZXJzQnlOYW1lW25hbWUudG9Mb3dlckNhc2UoKS50cmltKCldXG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IFtgZ2V0SGVhZGVyICR7bmFtZX1gLCB7cmVzdWx0OiByZXN1bHQ/LnRvU3RyaW5nKCl9XSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBoZWFkZXJzIGhhc2guXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIFRoZSBoZWFkZXJzIGhhc2guXG4gICAqL1xuICBnZXRIZWFkZXJzSGFzaCgpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGZvciAoY29uc3QgaGVhZGVyRm9ybWF0dGVkTmFtZSBpbiB0aGlzLmhlYWRlcnNCeU5hbWUpIHtcbiAgICAgIGNvbnN0IGhlYWRlciA9IHRoaXMuaGVhZGVyc0J5TmFtZVtoZWFkZXJGb3JtYXR0ZWROYW1lXVxuXG4gICAgICByZXN1bHRbaGVhZGVyLmdldE5hbWUoKV0gPSBoZWFkZXIuZ2V0VmFsdWUoKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm0gZGF0YSBwYXJ0IGRvbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGZvcm1EYXRhUGFydERvbmUoKSB7XG4gICAgY29uc3QgZm9ybURhdGFQYXJ0ID0gdGhpcy5mb3JtRGF0YVBhcnRcblxuICAgIGlmICghZm9ybURhdGFQYXJ0KSB0aHJvdyBuZXcgRXJyb3IoXCJmb3JtRGF0YVBhcnQgd2FzbnQgc2V0XCIpXG5cbiAgICB0aGlzLmZvcm1EYXRhUGFydCA9IHVuZGVmaW5lZFxuICAgIGZvcm1EYXRhUGFydC5maW5pc2goKVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImZvcm0tZGF0YS1wYXJ0XCIsIGZvcm1EYXRhUGFydClcbiAgfVxuXG4gIGlzTXVsdGlQYXJ0eUZvcm1EYXRhKCkge1xuICAgIHJldHVybiB0aGlzLm11bHRpUGFydHlGb3JtRGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IGZvcm0gZGF0YSBwYXJ0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBuZXdGb3JtRGF0YVBhcnQoKSB7XG4gICAgdGhpcy5mb3JtRGF0YVBhcnQgPSBuZXcgRm9ybURhdGFQYXJ0KClcbiAgICB0aGlzLnNldFN0YXRlKFwibXVsdGktcGFydC1mb3JtLWRhdGEtaGVhZGVyXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBMaW5lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwYXJzZShsaW5lKSB7XG4gICAgaWYgKHRoaXMuc3RhdGUgPT0gXCJzdGF0dXNcIikge1xuICAgICAgdGhpcy5wYXJzZVN0YXR1c0xpbmUobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJoZWFkZXJzXCIpIHtcbiAgICAgIHRoaXMucGFyc2VIZWFkZXIobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJjaHVua2VkLXNpemVcIikge1xuICAgICAgdGhpcy5wYXJzZUNodW5rU2l6ZUxpbmUobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJjaHVua2VkLXRyYWlsZXJcIikge1xuICAgICAgaWYgKGxpbmUgPT0gXCJcXHJcXG5cIikge1xuICAgICAgICB0aGlzLmZpbmlzaENodW5rZWRCb2R5KClcbiAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhXCIpIHtcbiAgICAgIGlmIChsaW5lID09IHRoaXMuYm91bmRhcnlMaW5lKSB7XG4gICAgICAgIHRoaXMubmV3Rm9ybURhdGFQYXJ0KClcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PSBcIlxcclxcblwiKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoXCJkb25lXCIpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGJvdW5kYXJ5IGxpbmUgYnV0IGRpZG4ndCBnZXQgaXQ6ICR7bGluZX1gKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWhlYWRlclwiKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSB0aGlzLnJlYWRIZWFkZXJGcm9tTGluZShsaW5lKVxuXG4gICAgICBpZiAoaGVhZGVyKSB7XG4gICAgICAgIGlmICghdGhpcy5mb3JtRGF0YVBhcnQpIHRocm93IG5ldyBFcnJvcihcImZvcm1EYXRhUGFydCBub3Qgc2V0XCIpXG5cbiAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnQuYWRkSGVhZGVyKGhlYWRlcilcbiAgICAgICAgLy90aGlzLnN0YXRlID09IFwibXVsdGktcGFydC1mb3JtLWRhdGFcIlxuICAgICAgfSBlbHNlIGlmIChsaW5lID09IFwiXFxyXFxuXCIpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZShcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWJvZHlcIilcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHN0YXRlIHBhcnNpbmcgbGluZTogJHt0aGlzLnN0YXRlfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBoZWFkZXIgZnJvbSBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIExpbmUuXG4gICAqIEByZXR1cm5zIHtIZWFkZXIgfCB1bmRlZmluZWR9IC0gVGhlIGhlYWRlciBmcm9tIGxpbmUuXG4gICAqL1xuICByZWFkSGVhZGVyRnJvbUxpbmUobGluZSkge1xuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXiguKyk6ICguKylcXHJcXG4vKVxuXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSBuZXcgSGVhZGVyKG1hdGNoWzFdLCBtYXRjaFsyXSlcblxuICAgICAgcmV0dXJuIGhlYWRlclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBoZWFkZXIuXG4gICAqIEBwYXJhbSB7SGVhZGVyfSBoZWFkZXIgLSBIZWFkZXIgdmFsdWUuXG4gICAqL1xuICBhZGRIZWFkZXIoaGVhZGVyKSB7XG4gICAgY29uc3QgZm9ybWF0dGVkTmFtZSA9IGhlYWRlci5nZXRGb3JtYXR0ZWROYW1lKClcbiAgICBjb25zdCBleGlzdGluZ0hlYWRlciA9IHRoaXMuaGVhZGVyc0J5TmFtZVtmb3JtYXR0ZWROYW1lXVxuXG4gICAgLy8gUkZDIDkxMTAgwqc1LjM6IGEgZmllbGQgbWF5IGJlIHJlcGVhdGVkOyBpdHMgdmFsdWUgaXMgdGhlIGNvbmNhdGVuYXRpb24gb2ZcbiAgICAvLyBhbGwgZmllbGQgdmFsdWVzIHNlcGFyYXRlZCBieSBjb21tYXMsIGluIHdpcmUgb3JkZXIuIE9ubHkgQWNjZXB0LUVuY29kaW5nXG4gICAgLy8gaXMgY29uc3VtZWQgYXMgYSBjb21iaW5lZCBmaWVsZCBieSB0aGUgc2VydmVyLlxuICAgIGlmIChleGlzdGluZ0hlYWRlciAmJiBDT01CSU5JTkdfSEVBREVSX0ZJRUxEUy5oYXMoZm9ybWF0dGVkTmFtZSkpIHtcbiAgICAgIGV4aXN0aW5nSGVhZGVyLnZhbHVlICs9IGAsICR7aGVhZGVyLmdldFZhbHVlKCl9YFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmhlYWRlcnNCeU5hbWVbZm9ybWF0dGVkTmFtZV0gPSBoZWFkZXJcbiAgICB9XG5cbiAgICBpZiAoZm9ybWF0dGVkTmFtZSA9PSBcImNvbnRlbnQtbGVuZ3RoXCIpIHRoaXMuY29udGVudExlbmd0aCA9IHBhcnNlSW50KGhlYWRlci5nZXRWYWx1ZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIExpbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHBhcnNlSGVhZGVyKGxpbmUpIHtcbiAgICBjb25zdCBoZWFkZXIgPSB0aGlzLnJlYWRIZWFkZXJGcm9tTGluZShsaW5lKVxuXG4gICAgaWYgKGhlYWRlcikge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBgUGFyc2VkIGhlYWRlcjogJHtoZWFkZXIudG9TdHJpbmcoKX1gKVxuICAgICAgdGhpcy5hZGRIZWFkZXIoaGVhZGVyKVxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImhlYWRlclwiLCBoZWFkZXIpXG4gICAgfSBlbHNlIGlmIChsaW5lID09IFwiXFxyXFxuXCIpIHtcbiAgICAgIGNvbnN0IGh0dHBNZXRob2QgPSB0aGlzLmh0dHBNZXRob2Q/LnRvVXBwZXJDYXNlKClcblxuICAgICAgaWYgKCFodHRwTWV0aG9kKSB0aHJvdyBuZXcgRXJyb3IoXCJIVFRQIG1ldGhvZCBub3Qgc2V0XCIpXG4gICAgICBpZiAoIXRoaXMucGF0aCkgdGhyb3cgbmV3IEVycm9yKFwiSFRUUCBwYXRoIG5vdCBzZXRcIilcblxuICAgICAgdGhpcy5yZXF1ZXN0Qm9keVBvbGljeSA9IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlSHR0cFJlcXVlc3RCb2R5UG9saWN5KHtcbiAgICAgICAgaGVhZGVyczogdGhpcy5nZXRIZWFkZXJzSGFzaCgpLFxuICAgICAgICBodHRwTWV0aG9kLFxuICAgICAgICBwYXRoOiB0aGlzLnBhdGhcbiAgICAgIH0pXG5cbiAgICAgIGlmICghdGhpcy5leHBlY3RzUmVxdWVzdEJvZHkoaHR0cE1ldGhvZCkpIHtcbiAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgfSBlbHNlIGlmICh0aGlzLmlzQ2h1bmtlZEVuY29kaW5nKCkpIHtcbiAgICAgICAgdGhpcy5yZWFkaW5nQm9keSA9IHRydWVcbiAgICAgICAgdGhpcy5ib2R5TGVuZ3RoID0gMFxuICAgICAgICB0aGlzLmluaXRpYWxpemVDaHVua2VkQm9keSgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlYWRpbmdCb2R5ID0gdHJ1ZVxuICAgICAgICB0aGlzLmJvZHlMZW5ndGggPSAwXG5cbiAgICAgICAgaWYgKHRoaXMuY29udGVudExlbmd0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKE51bWJlci5pc05hTih0aGlzLmNvbnRlbnRMZW5ndGgpKSB0aHJvdyBuZXcgRXJyb3IoXCJDb250ZW50IGxlbmd0aCBpcyBpbnZhbGlkXCIpXG5cbiAgICAgICAgICB0aGlzLmFzc2VydFJlcXVlc3RCb2R5U2l6ZSh0aGlzLmNvbnRlbnRMZW5ndGgpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYXRjaCA9IHRoaXMucmVxdWVzdEJvZHlQb2xpY3kubW9kZSA9PT0gXCJwYXJzZWRcIlxuICAgICAgICAgID8gdGhpcy5nZXRIZWFkZXIoXCJjb250ZW50LXR5cGVcIik/LnZhbHVlPy5tYXRjaCgvXm11bHRpcGFydFxcL2Zvcm0tZGF0YTtcXHMqYm91bmRhcnk9KC4rKSQvaSlcbiAgICAgICAgICA6IG51bGxcblxuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5ID0gbWF0Y2hbMV1cbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5TGluZSA9IGAtLSR7dGhpcy5ib3VuZGFyeX1cXHJcXG5gXG4gICAgICAgICAgdGhpcy5ib3VuZGFyeUxpbmVOZXh0ID0gYFxcclxcbi0tJHt0aGlzLmJvdW5kYXJ5fVxcclxcbmBcbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5TGluZUVuZCA9IGBcXHJcXG4tLSR7dGhpcy5ib3VuZGFyeX0tLWBcbiAgICAgICAgICB0aGlzLm11bHRpUGFydHlGb3JtRGF0YSA9IHRydWVcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwibXVsdGktcGFydC1mb3JtLWRhdGFcIilcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggPT09IDAgfHwgdGhpcy5jb250ZW50TGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICAgICAqIEB0eXBlIHtCdWZmZXJbXX0gKi9cbiAgICAgICAgICB0aGlzLnBvc3RCb2R5QnVmZmVycyA9IFtdXG5cbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwicG9zdC1ib2R5XCIpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBzdGF0dXMgbGluZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBMaW5lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwYXJzZVN0YXR1c0xpbmUobGluZSkge1xuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihbQS1aLV0rKSAoLis/KSBIVFRQXFwvKC4rKVxcclxcbi8pXG5cbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IG1hdGNoIHN0YXR1cyBsaW5lIGZyb206ICR7bGluZX1gKVxuICAgIH1cblxuICAgIHRoaXMuaHR0cE1ldGhvZCA9IG1hdGNoWzFdXG4gICAgdGhpcy5odHRwVmVyc2lvbiA9IG1hdGNoWzNdXG4gICAgdGhpcy5wYXRoID0gbWF0Y2hbMl1cbiAgICB0aGlzLnNldFN0YXRlKFwiaGVhZGVyc1wiKVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gW1wiUGFyc2VkIHN0YXR1cyBsaW5lXCIsIHtodHRwTWV0aG9kOiB0aGlzLmh0dHBNZXRob2QsIGh0dHBWZXJzaW9uOiB0aGlzLmh0dHBWZXJzaW9uLCBwYXRoOiB0aGlzLnBhdGh9XSlcbiAgfVxuXG4gIHBvc3RSZXF1ZXN0RG9uZSgpIHtcbiAgICBpZiAodGhpcy5wb3N0Qm9keUJ1ZmZlcnMpIHtcbiAgICAgIGNvbnN0IGJvZHlCdWZmZXIgPSBCdWZmZXIuY29uY2F0KHRoaXMucG9zdEJvZHlCdWZmZXJzKVxuXG4gICAgICBpZiAodGhpcy5yZXF1ZXN0Qm9keVBvbGljeT8ubW9kZSA9PT0gXCJyYXdcIikge1xuICAgICAgICB0aGlzLnJhd0JvZHlCdWZmZXIgPSBib2R5QnVmZmVyXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBvc3RCb2R5ID0gYm9keUJ1ZmZlci50b1N0cmluZyhcInV0ZjhcIilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnBvc3RCb2R5QnVmZmVycyA9IHVuZGVmaW5lZFxuXG4gICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwZWN0cyByZXF1ZXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBodHRwTWV0aG9kIC0gSFRUUCBtZXRob2QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgZXhwZWN0cyBhIGJvZHkuXG4gICAqL1xuICBleHBlY3RzUmVxdWVzdEJvZHkoaHR0cE1ldGhvZCkge1xuICAgIHJldHVybiAhW1wiR0VUXCIsIFwiT1BUSU9OU1wiLCBcIkhFQURcIl0uaW5jbHVkZXMoaHR0cE1ldGhvZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGNodW5rZWQgZW5jb2RpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgdXNlcyBjaHVua2VkIHRyYW5zZmVyIGVuY29kaW5nLlxuICAgKi9cbiAgaXNDaHVua2VkRW5jb2RpbmcoKSB7XG4gICAgY29uc3QgdHJhbnNmZXJFbmNvZGluZyA9IHRoaXMuZ2V0SGVhZGVyKFwidHJhbnNmZXItZW5jb2RpbmdcIik/LnZhbHVlPy50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gQm9vbGVhbih0cmFuc2ZlckVuY29kaW5nPy5pbmNsdWRlcyhcImNodW5rZWRcIikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIGNodW5rZWQgYm9keS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgaW5pdGlhbGl6ZUNodW5rZWRCb2R5KCkge1xuICAgIHRoaXMuY2h1bmtlZEJvZHlDaGFycyA9IFtdXG4gICAgdGhpcy5jdXJyZW50Q2h1bmtTaXplID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSAwXG4gICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtc2l6ZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgY2h1bmsgc2l6ZSBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIENodW5rIHNpemUgbGluZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcGFyc2VDaHVua1NpemVMaW5lKGxpbmUpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKClcblxuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuXG5cbiAgICBjb25zdCBzaXplVG9rZW4gPSB0cmltbWVkLnNwbGl0KFwiO1wiKVswXT8udHJpbSgpXG5cbiAgICBpZiAoIXNpemVUb2tlbikgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNodW5rIHNpemUgbGluZTogJHtsaW5lfWApXG5cbiAgICBpZiAoIS9eWzAtOWEtZl0rJC9pdS50ZXN0KHNpemVUb2tlbikpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjaHVuayBzaXplOiAke3NpemVUb2tlbn1gKVxuXG4gICAgY29uc3Qgc2l6ZSA9IE51bWJlci5wYXJzZUludChzaXplVG9rZW4sIDE2KVxuXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihzaXplKSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNodW5rIHNpemU6ICR7c2l6ZVRva2VufWApXG5cbiAgICBpZiAoc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtdHJhaWxlclwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5hc3NlcnRSZXF1ZXN0Qm9keVNpemUoKHRoaXMuY2h1bmtlZEJvZHlDaGFycz8ubGVuZ3RoIHx8IDApICsgc2l6ZSlcblxuICAgIHRoaXMuY3VycmVudENodW5rU2l6ZSA9IHNpemVcbiAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IDBcbiAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1kYXRhXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5pc2ggY2h1bmtlZCBib2R5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBmaW5pc2hDaHVua2VkQm9keSgpIHtcbiAgICBpZiAodGhpcy5jaHVua2VkQm9keUNoYXJzKSB7XG4gICAgICBjb25zdCBib2R5QnVmZmVyID0gQnVmZmVyLmZyb20odGhpcy5jaHVua2VkQm9keUNoYXJzKVxuXG4gICAgICBpZiAodGhpcy5yZXF1ZXN0Qm9keVBvbGljeT8ubW9kZSA9PT0gXCJyYXdcIikge1xuICAgICAgICB0aGlzLnJhd0JvZHlCdWZmZXIgPSBib2R5QnVmZmVyXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBvc3RCb2R5ID0gYm9keUJ1ZmZlci50b1N0cmluZyhcInV0ZjhcIilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBkZWxldGUgdGhpcy5jaHVua2VkQm9keUNoYXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdTdGF0ZSAtIE5ldyBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RhdGUobmV3U3RhdGUpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBDaGFuZ2luZyBzdGF0ZSBmcm9tICR7dGhpcy5zdGF0ZX0gdG8gJHtuZXdTdGF0ZX1gKVxuICAgIHRoaXMuc3RhdGUgPSBuZXdTdGF0ZVxuICB9XG5cbiAgY29tcGxldGVSZXF1ZXN0ID0gKCkgPT4ge1xuICAgIHRoaXMuc3RhdGUgPSBcInN0YXR1c1wiIC8vIFJlc2V0IHN0YXRlIHRvIG5ldyByZXF1ZXN0XG4gICAgdGhpcy5jb21wbGV0ZWQgPSB0cnVlXG5cbiAgICBpZiAodGhpcy5yZXF1ZXN0Qm9keVBvbGljeT8ubW9kZSA9PT0gXCJyYXdcIikge1xuICAgICAgdGhpcy5yYXdCb2R5QnVmZmVyIHx8PSBCdWZmZXIuYWxsb2MoMClcbiAgICB9IGVsc2UgaWYgKHRoaXMuZ2V0SGVhZGVyKFwiY29udGVudC10eXBlXCIpPy52YWx1ZT8uc3RhcnRzV2l0aChcImFwcGxpY2F0aW9uL2pzb25cIikpIHtcbiAgICAgIHRoaXMucGFyc2VBcHBsaWNhdGlvbkpzb25QYXJhbXMoKVxuICAgIH0gZWxzZSBpZiAodGhpcy5tdWx0aVBhcnR5Rm9ybURhdGEpIHtcbiAgICAgIC8vIERvbmUgYWZ0ZXIgZWFjaCBuZXcgZm9ybSBkYXRhIHBhcnRcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wYXJzZVF1ZXJ5U3RyaW5nUG9zdFBhcmFtcygpXG4gICAgfVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNvbXBsZXRlZFwiKVxuICB9XG5cbiAgcGFyc2VBcHBsaWNhdGlvbkpzb25QYXJhbXMoKSB7XG4gICAgaWYgKHRoaXMucG9zdEJvZHkpIHtcbiAgICAgIGNvbnN0IG5ld1BhcmFtcyA9IEpTT04ucGFyc2UodGhpcy5wb3N0Qm9keSlcblxuICAgICAgaW5jb3Jwb3JhdGUodGhpcy5wYXJhbXMsIG5ld1BhcmFtcylcbiAgICB9XG4gIH1cblxuICBwYXJzZVF1ZXJ5U3RyaW5nUG9zdFBhcmFtcygpIHtcbiAgICBpZiAodGhpcy5wb3N0Qm9keSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkUXVlcnkgPSBxdWVyeXN0cmluZy5wYXJzZSh0aGlzLnBvc3RCb2R5KVxuICAgICAgICAvKipcbiAgICAgICAgICogVW5wYXJzZWQgcGFyYW1zLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAqL1xuICAgICAgICBjb25zdCB1bnBhcnNlZFBhcmFtcyA9IHt9XG5cbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGFyc2VkUXVlcnkpKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgdW5wYXJzZWRQYXJhbXNba2V5XSA9IHZhbHVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGFyYW1zVG9PYmplY3QgPSBuZXcgUGFyYW1zVG9PYmplY3QodW5wYXJzZWRQYXJhbXMpXG4gICAgICAgIGNvbnN0IG5ld1BhcmFtcyA9IHBhcmFtc1RvT2JqZWN0LnRvT2JqZWN0KClcblxuICAgICAgICBpbmNvcnBvcmF0ZSh0aGlzLnBhcmFtcywgbmV3UGFyYW1zKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZW5zdXJlZEVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKGVycm9yKVxuXG4gICAgICAgIGVuc3VyZWRFcnJvci52ZWxvY2lvdXNDb250ZXh0ID0ge1xuICAgICAgICAgIC4uLihlbnN1cmVkRXJyb3IudmVsb2Npb3VzQ29udGV4dCB8fCB7fSksXG4gICAgICAgICAgcmVxdWVzdFBhcnNpbmc6IHtcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiB0aGlzLmdldEhlYWRlcihcImNvbnRlbnQtdHlwZVwiKT8udmFsdWUsXG4gICAgICAgICAgICBodHRwTWV0aG9kOiB0aGlzLmh0dHBNZXRob2QsXG4gICAgICAgICAgICBwYXJhbWV0ZXJLZXlzOiBPYmplY3Qua2V5cyhxdWVyeXN0cmluZy5wYXJzZSh0aGlzLnBvc3RCb2R5KSksXG4gICAgICAgICAgICBwYXRoOiB0aGlzLnBhdGgsXG4gICAgICAgICAgICBwb3N0Qm9keVByZXZpZXc6IHRydW5jYXRlUHJldmlldyh0aGlzLnBvc3RCb2R5KSxcbiAgICAgICAgICAgIHN0YWdlOiBcInF1ZXJ5LXN0cmluZy1wb3N0LXBhcmFtc1wiXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgZW5zdXJlZEVycm9yXG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=