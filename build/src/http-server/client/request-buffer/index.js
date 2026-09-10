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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtYnVmZmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSxpQ0FBaUMsQ0FBQTtBQUMxRCxPQUFPLFlBQVksTUFBTSxxQkFBcUIsQ0FBQTtBQUM5QyxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxFQUFDLDRCQUE0QixFQUFDLE1BQU0sY0FBYyxDQUFBO0FBQ3pELE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sb0JBQW9CLENBQUE7QUFDdkMsT0FBTyxjQUFjLE1BQU0sd0JBQXdCLENBQUE7QUFDbkQsT0FBTyxXQUFXLE1BQU0sYUFBYSxDQUFBO0FBRXJDOzs7eUJBR3lCO0FBQ3pCLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUE7QUFFNUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGVBQWUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxHQUFHLEdBQUc7SUFDekMsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFDL0MsSUFBSSxLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUs7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUV2QyxPQUFPLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQTtBQUN0QyxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDLFVBQVUsR0FBRyxDQUFDLENBQUE7SUFFZCxtQ0FBbUM7SUFDbkMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtJQUUzQjs7MEJBRXNCO0lBQ3RCLElBQUksR0FBRyxFQUFFLENBQUE7SUFFVCxNQUFN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LFlBQVksQ0FBQyxnQkFBZ0IsR0FBRztvQkFDOUIsR0FBRyxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7b0JBQ3hDLGNBQWMsRUFBRTt3QkFDZCxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsRUFBRSxLQUFLO3dCQUNsRCxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7d0JBQzNCLGFBQWEsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO3dCQUM1RCxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7d0JBQ2YsZUFBZSxFQUFFLGVBQWUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO3dCQUMvQyxLQUFLLEVBQUUsMEJBQTBCO3FCQUNsQztpQkFDRixDQUFBO2dCQUVELE1BQU0sWUFBWSxDQUFBO1lBQ3BCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uLy4uLy4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IEZvcm1EYXRhUGFydCBmcm9tIFwiLi9mb3JtLWRhdGEtcGFydC5qc1wiXG5pbXBvcnQgSGVhZGVyIGZyb20gXCIuL2hlYWRlci5qc1wiXG5pbXBvcnQge0h0dHBSZXF1ZXN0Qm9keVRvb0xhcmdlRXJyb3J9IGZyb20gXCIuLi9lcnJvcnMuanNcIlxuaW1wb3J0IHtpbmNvcnBvcmF0ZX0gZnJvbSBcImluY29ycG9yYXRvclwiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IFBhcmFtc1RvT2JqZWN0IGZyb20gXCIuLi9wYXJhbXMtdG8tb2JqZWN0LmpzXCJcbmltcG9ydCBxdWVyeXN0cmluZyBmcm9tIFwicXVlcnlzdHJpbmdcIlxuXG4vKipcbiAqIFJlcXVlc3QgaGVhZGVyIGZpZWxkcyB3aG9zZSByZXBlYXRlZCB3aXJlIGZpZWxkcyBjb21iaW5lIGludG8gb25lIHZhbHVlXG4gKiAoUkZDIDkxMTAgwqc1LjMpIGJlZm9yZSB0aGUgc2VydmVyIGNvbnN1bWVzIHRoZW0uXG4gKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG5jb25zdCBDT01CSU5JTkdfSEVBREVSX0ZJRUxEUyA9IG5ldyBTZXQoW1wiYWNjZXB0LWVuY29kaW5nXCJdKVxuXG4vKipcbiAqIFJ1bnMgdHJ1bmNhdGUgcHJldmlldy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBpbnB1dCAtIElucHV0IHN0cmluZy5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbbGltaXRdIC0gTWF4IHByZXZpZXcgbGVuZ3RoLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUcnVuY2F0ZWQgcHJldmlldy5cbiAqL1xuZnVuY3Rpb24gdHJ1bmNhdGVQcmV2aWV3KGlucHV0LCBsaW1pdCA9IDMwMCkge1xuICBpZiAodHlwZW9mIGlucHV0ICE9PSBcInN0cmluZ1wiKSByZXR1cm4gdW5kZWZpbmVkXG4gIGlmIChpbnB1dC5sZW5ndGggPD0gbGltaXQpIHJldHVybiBpbnB1dFxuXG4gIHJldHVybiBgJHtpbnB1dC5zbGljZSgwLCBsaW1pdCl9Li4uYFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBSZXF1ZXN0QnVmZmVyIHtcbiAgYm9keUxlbmd0aCA9IDBcblxuICAvKiogQHR5cGUge0J1ZmZlcltdIHwgdW5kZWZpbmVkfSAqL1xuICBwb3N0Qm9keUJ1ZmZlcnMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGF0YS5cbiAgICogQHR5cGUge251bWJlcltdfSAqL1xuICBkYXRhID0gW11cblxuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICAvKipcbiAgICogSGVhZGVycyBieSBuYW1lLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgSGVhZGVyPn0gKi9cbiAgaGVhZGVyc0J5TmFtZSA9IHt9XG4gIC8qKlxuICAgKiBDaHVua2VkIGJvZHkgY2hhcnMuXG4gICAqIEB0eXBlIHtudW1iZXJbXSB8IHVuZGVmaW5lZH0gKi9cbiAgY2h1bmtlZEJvZHlDaGFycyA9IHVuZGVmaW5lZFxuXG4gIG11bHRpUGFydHlGb3JtRGF0YSA9IGZhbHNlXG5cbiAgY29tcGxldGVkID0gZmFsc2VcbiAgcGFyYW1zID0ge31cbiAgcmVhZGluZ0JvZHkgPSBmYWxzZVxuICBzdGF0ZSA9IFwic3RhdHVzXCJcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMsIHtkZWJ1ZzogZmFsc2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJhaXNlcyBiZWZvcmUgYnVmZmVyaW5nIGEgcmVxdWVzdCBib2R5IGJleW9uZCB0aGUgY29uZmlndXJlZCBib3VuZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFjdHVhbEJ5dGVzIC0gRGVjbGFyZWQgb3IgYWNjdW11bGF0ZWQgZGVjb2RlZCBib2R5IGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFJlcXVlc3RCb2R5U2l6ZShhY3R1YWxCeXRlcykge1xuICAgIGNvbnN0IG1heEJ5dGVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEh0dHBTZXJ2ZXJNYXhSZXF1ZXN0Qm9keUJ5dGVzKClcblxuICAgIGlmIChtYXhCeXRlcyAhPT0gdW5kZWZpbmVkICYmIGFjdHVhbEJ5dGVzID4gbWF4Qnl0ZXMpIHtcbiAgICAgIHRocm93IG5ldyBIdHRwUmVxdWVzdEJvZHlUb29MYXJnZUVycm9yKHthY3R1YWxCeXRlcywgbWF4Qnl0ZXN9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGJ5dGVzIGNvbnN1bWVkIGFmdGVyIHJlcXVlc3QgaGVhZGVycy4gTXVsdGlwYXJ0IHBhcnNpbmcgY2FuIGFjY2VwdFxuICAgKiBhbiB1bmZyYW1lZCBib2R5LCBzbyBlbmZvcmNlIGl0cyBjb25maWd1cmVkIGJvdW5kIGR1cmluZyBhY2N1bXVsYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBieXRlcyAtIE5ld2x5IGNvbnN1bWVkIGJvZHkgYnl0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQm9keUJ5dGVzKGJ5dGVzKSB7XG4gICAgdGhpcy5ib2R5TGVuZ3RoICs9IGJ5dGVzXG5cbiAgICBpZiAodGhpcy5tdWx0aVBhcnR5Rm9ybURhdGEpIHRoaXMuYXNzZXJ0UmVxdWVzdEJvZHlTaXplKHRoaXMuYm9keUxlbmd0aClcbiAgfVxuXG4gIGRlc3Ryb3koKSB7XG4gICAgLy8gRG8gbm90aGluZyBmb3Igbm93Li4uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmZWVkLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge0J1ZmZlciB8IHVuZGVmaW5lZH0gLSBSZW1haW5pbmcgZGF0YSwgaWYgYW55LlxuICAgKi9cbiAgZmVlZChkYXRhKSB7XG4gICAgbGV0IGluZGV4ID0gMFxuXG4gICAgd2hpbGUgKGluZGV4IDwgZGF0YS5sZW5ndGgpIHtcbiAgICAgIHN3aXRjaCh0aGlzLnN0YXRlKSB7XG4gICAgICAgIGNhc2UgXCJzdGF0dXNcIjpcbiAgICAgICAgY2FzZSBcImhlYWRlcnNcIjpcbiAgICAgICAgY2FzZSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhXCI6XG4gICAgICAgIGNhc2UgXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1oZWFkZXJcIjpcbiAgICAgICAgY2FzZSBcImNodW5rZWQtc2l6ZVwiOlxuICAgICAgICBjYXNlIFwiY2h1bmtlZC10cmFpbGVyXCI6XG4gICAgICAgICAgaW5kZXggPSB0aGlzLmZlZWRMaW5lKGRhdGEsIGluZGV4KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgXCJwb3N0LWJvZHlcIjpcbiAgICAgICAgICBpbmRleCA9IHRoaXMuZmVlZFBvc3RCb2R5KGRhdGEsIGluZGV4KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgaW5kZXggPSB0aGlzLmZlZWRCeXRlKGRhdGEsIGluZGV4KVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5jb21wbGV0ZWQpIHtcbiAgICAgICAgcmV0dXJuIGRhdGEuc3ViYXJyYXkoaW5kZXgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIGJ5dGVzIGZvciB0aGUgbGluZS1iYXNlZCBzdGF0ZXMgdXAgdG8gYW5kIGluY2x1ZGluZyB0aGUgbmV4dCBuZXdsaW5lLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGluZGV4IC0gUmVhZCBwb3NpdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOZXcgcmVhZCBwb3NpdGlvbi5cbiAgICovXG4gIGZlZWRMaW5lKGRhdGEsIGluZGV4KSB7XG4gICAgY29uc3QgbmV3bGluZUluZGV4ID0gZGF0YS5pbmRleE9mKDEwLCBpbmRleClcblxuICAgIGlmIChuZXdsaW5lSW5kZXggPT09IC0xKSB7XG4gICAgICBpZiAodGhpcy5yZWFkaW5nQm9keSkgdGhpcy5yZWNvcmRCb2R5Qnl0ZXMoZGF0YS5sZW5ndGggLSBpbmRleClcblxuICAgICAgZm9yIChsZXQgZGF0YUluZGV4ID0gaW5kZXg7IGRhdGFJbmRleCA8IGRhdGEubGVuZ3RoOyBkYXRhSW5kZXggKz0gMSkge1xuICAgICAgICB0aGlzLmRhdGEucHVzaChkYXRhW2RhdGFJbmRleF0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBkYXRhLmxlbmd0aFxuICAgIH1cblxuICAgIGlmICh0aGlzLnJlYWRpbmdCb2R5KSB0aGlzLnJlY29yZEJvZHlCeXRlcyhuZXdsaW5lSW5kZXggKyAxIC0gaW5kZXgpXG5cbiAgICBsZXQgbGluZVxuXG4gICAgaWYgKHRoaXMuZGF0YS5sZW5ndGggPT0gMCkge1xuICAgICAgbGluZSA9IGRhdGEudG9TdHJpbmcoXCJsYXRpbjFcIiwgaW5kZXgsIG5ld2xpbmVJbmRleCArIDEpXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoZSByZXN0IG9mIGEgbGluZSB0aGF0IHN0YXJ0ZWQgaW4gYSBwcmV2aW91cyBjaHVuay5cbiAgICAgIGZvciAobGV0IGRhdGFJbmRleCA9IGluZGV4OyBkYXRhSW5kZXggPD0gbmV3bGluZUluZGV4OyBkYXRhSW5kZXggKz0gMSkge1xuICAgICAgICB0aGlzLmRhdGEucHVzaChkYXRhW2RhdGFJbmRleF0pXG4gICAgICB9XG5cbiAgICAgIGxpbmUgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIHRoaXMuZGF0YSlcbiAgICAgIHRoaXMuZGF0YSA9IFtdXG4gICAgfVxuXG4gICAgdGhpcy5wYXJzZShsaW5lKVxuXG4gICAgcmV0dXJuIG5ld2xpbmVJbmRleCArIDFcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyBmaXhlZC1sZW5ndGggcmVxdWVzdCBib2R5IGJ5dGVzIGluIGJ1bGsuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBSZWFkIHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5ldyByZWFkIHBvc2l0aW9uLlxuICAgKi9cbiAgZmVlZFBvc3RCb2R5KGRhdGEsIGluZGV4KSB7XG4gICAgaWYgKCF0aGlzLnBvc3RCb2R5QnVmZmVycykgdGhyb3cgbmV3IEVycm9yKFwicG9zdEJvZHlCdWZmZXJzIG5vdCBpbml0aWFsaXplZFwiKVxuICAgIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiQ29udGVudCBsZW5ndGggbm90IHNldFwiKVxuXG4gICAgY29uc3QgcmVtYWluaW5nQm9keUJ5dGVzID0gTWF0aC5tYXgoMSwgdGhpcy5jb250ZW50TGVuZ3RoIC0gdGhpcy5ib2R5TGVuZ3RoKVxuICAgIGNvbnN0IGVuZEluZGV4ID0gTWF0aC5taW4oZGF0YS5sZW5ndGgsIGluZGV4ICsgcmVtYWluaW5nQm9keUJ5dGVzKVxuXG4gICAgdGhpcy5wb3N0Qm9keUJ1ZmZlcnMucHVzaChkYXRhLnN1YmFycmF5KGluZGV4LCBlbmRJbmRleCkpXG4gICAgdGhpcy5yZWNvcmRCb2R5Qnl0ZXMoZW5kSW5kZXggLSBpbmRleClcblxuICAgIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggJiYgdGhpcy5ib2R5TGVuZ3RoID49IHRoaXMuY29udGVudExlbmd0aCkge1xuICAgICAgdGhpcy5wb3N0UmVxdWVzdERvbmUoKVxuICAgIH1cblxuICAgIHJldHVybiBlbmRJbmRleFxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIGEgc2luZ2xlIGJ5dGUgZm9yIHRoZSBieXRlLWJhc2VkIHBhcnNlciBzdGF0ZXMuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBSZWFkIHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5ldyByZWFkIHBvc2l0aW9uLlxuICAgKi9cbiAgZmVlZEJ5dGUoZGF0YSwgaW5kZXgpIHtcbiAgICBjb25zdCBjaGFyID0gZGF0YVtpbmRleF1cblxuICAgIGlmICh0aGlzLnJlYWRpbmdCb2R5KSB0aGlzLnJlY29yZEJvZHlCeXRlcygxKVxuXG4gICAgc3dpdGNoKHRoaXMuc3RhdGUpIHtcbiAgICAgIGNhc2UgXCJjaHVua2VkLWRhdGFcIjoge1xuICAgICAgICBjb25zdCBjaHVua2VkQm9keUNoYXJzID0gdGhpcy5jaHVua2VkQm9keUNoYXJzXG5cbiAgICAgICAgaWYgKHRoaXMuY3VycmVudENodW5rU2l6ZSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJDaHVuayBzaXplIG5vdCBpbml0aWFsaXplZFwiKVxuICAgICAgICBpZiAoIWNodW5rZWRCb2R5Q2hhcnMpIHRocm93IG5ldyBFcnJvcihcIkNodW5rZWQgYm9keSBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgICAgICBjaHVua2VkQm9keUNoYXJzLnB1c2goY2hhcilcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEN1cnJlbnQgY2h1bmsgYnl0ZXMgcmVhZC5cbiAgICAgICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICAgICAgY29uc3QgY3VycmVudENodW5rQnl0ZXNSZWFkID0gKHRoaXMuY3VycmVudENodW5rQnl0ZXNSZWFkIHx8IDApICsgMVxuXG4gICAgICAgIHRoaXMuY3VycmVudENodW5rQnl0ZXNSZWFkID0gY3VycmVudENodW5rQnl0ZXNSZWFkXG5cbiAgICAgICAgaWYgKGN1cnJlbnRDaHVua0J5dGVzUmVhZCA+PSB0aGlzLmN1cnJlbnRDaHVua1NpemUpIHtcbiAgICAgICAgICB0aGlzLmN1cnJlbnRDaHVua0NybGZSZWFkID0gMFxuICAgICAgICAgIHRoaXMuc2V0U3RhdGUoXCJjaHVua2VkLWRhdGEtY3JsZlwiKVxuICAgICAgICB9XG5cbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJjaHVua2VkLWRhdGEtY3JsZlwiOlxuICAgICAgICB0aGlzLmN1cnJlbnRDaHVua0NybGZSZWFkID0gKHRoaXMuY3VycmVudENodW5rQ3JsZlJlYWQgfHwgMCkgKyAxXG5cbiAgICAgICAgaWYgKHRoaXMuY3VycmVudENodW5rQ3JsZlJlYWQgPj0gMikge1xuICAgICAgICAgIHRoaXMuY3VycmVudENodW5rQnl0ZXNSZWFkID0gMFxuICAgICAgICAgIHRoaXMuc2V0U3RhdGUoXCJjaHVua2VkLXNpemVcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlIFwibXVsdGktcGFydC1mb3JtLWRhdGEtYm9keVwiOiB7XG4gICAgICAgIGlmICghdGhpcy5mb3JtRGF0YVBhcnQpIHRocm93IG5ldyBFcnJvcihcIkZvcm1EYXRhIHBhcnQgbm90IGluaXRpYWxpemVkXCIpXG4gICAgICAgIGlmICghdGhpcy5ib3VuZGFyeUxpbmVFbmQpIHRocm93IG5ldyBFcnJvcihcIkJvdW5kYXJ5IGxpbmUgZW5kIG5vdCBpbml0aWFsaXplZFwiKVxuICAgICAgICBpZiAoIXRoaXMuYm91bmRhcnlMaW5lTmV4dCkgdGhyb3cgbmV3IEVycm9yKFwiQm91bmRhcnkgbGluZSBuZXh0IG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgICAgIGNvbnN0IGJvZHkgPSB0aGlzLmZvcm1EYXRhUGFydC5ib2R5XG5cbiAgICAgICAgYm9keS5wdXNoKGNoYXIpXG5cbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeUVuZFBvc2l0aW9uID0gYm9keS5sZW5ndGggLSB0aGlzLmJvdW5kYXJ5TGluZUVuZC5sZW5ndGhcbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeUVuZENoYXJzID0gYm9keS5zbGljZShwb3NzaWJsZUJvdW5kYXJ5RW5kUG9zaXRpb24sIGJvZHkubGVuZ3RoKVxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5RW5kID0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBwb3NzaWJsZUJvdW5kYXJ5RW5kQ2hhcnMpXG5cbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeU5leHRQb3NpdGlvbiA9IGJvZHkubGVuZ3RoIC0gdGhpcy5ib3VuZGFyeUxpbmVOZXh0Lmxlbmd0aFxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5TmV4dENoYXJzID0gYm9keS5zbGljZShwb3NzaWJsZUJvdW5kYXJ5TmV4dFBvc2l0aW9uLCBib2R5Lmxlbmd0aClcbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeU5leHQgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIHBvc3NpYmxlQm91bmRhcnlOZXh0Q2hhcnMpXG5cbiAgICAgICAgaWYgKHBvc3NpYmxlQm91bmRhcnlFbmQgPT0gdGhpcy5ib3VuZGFyeUxpbmVFbmQpIHtcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydC5yZW1vdmVGcm9tQm9keShwb3NzaWJsZUJvdW5kYXJ5RW5kKVxuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0RG9uZSgpXG4gICAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgICB9IGVsc2UgaWYgKHBvc3NpYmxlQm91bmRhcnlOZXh0ID09IHRoaXMuYm91bmRhcnlMaW5lTmV4dCkge1xuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0LnJlbW92ZUZyb21Cb2R5KHBvc3NpYmxlQm91bmRhcnlOZXh0KVxuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0RG9uZSgpXG4gICAgICAgICAgdGhpcy5uZXdGb3JtRGF0YVBhcnQoKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuY29udGVudExlbmd0aCAmJiB0aGlzLmJvZHlMZW5ndGggPj0gdGhpcy5jb250ZW50TGVuZ3RoKSB7XG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnREb25lKClcbiAgICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5mb3JtRGF0YVBhcnQuY29udGVudExlbmd0aCAmJiB0aGlzLmJvZHlMZW5ndGggPj0gdGhpcy5mb3JtRGF0YVBhcnQuY29udGVudExlbmd0aCkge1xuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0RG9uZSgpXG5cbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdHViXCIpXG4gICAgICAgIH1cblxuICAgICAgICBicmVha1xuICAgICAgfVxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BVbmtub3duIHN0YXRlIGZvciByZXF1ZXN0IGJ1ZmZlcmAsIHtzdGF0ZTogdGhpcy5zdGF0ZX1dKVxuICAgIH1cblxuICAgIHJldHVybiBpbmRleCArIDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge0hlYWRlcn0gLSBUaGUgaGVhZGVyLlxuICAgKi9cbiAgZ2V0SGVhZGVyKG5hbWUpIHtcbiAgICBjb25zdCByZXN1bHQgPSB0aGlzLmhlYWRlcnNCeU5hbWVbbmFtZS50b0xvd2VyQ2FzZSgpLnRyaW0oKV1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gW2BnZXRIZWFkZXIgJHtuYW1lfWAsIHtyZXN1bHQ6IHJlc3VsdD8udG9TdHJpbmcoKX1dKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGhlYWRlcnMgaGFzaC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gVGhlIGhlYWRlcnMgaGFzaC5cbiAgICovXG4gIGdldEhlYWRlcnNIYXNoKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJGb3JtYXR0ZWROYW1lIGluIHRoaXMuaGVhZGVyc0J5TmFtZSkge1xuICAgICAgY29uc3QgaGVhZGVyID0gdGhpcy5oZWFkZXJzQnlOYW1lW2hlYWRlckZvcm1hdHRlZE5hbWVdXG5cbiAgICAgIHJlc3VsdFtoZWFkZXIuZ2V0TmFtZSgpXSA9IGhlYWRlci5nZXRWYWx1ZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybSBkYXRhIHBhcnQgZG9uZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZm9ybURhdGFQYXJ0RG9uZSgpIHtcbiAgICBjb25zdCBmb3JtRGF0YVBhcnQgPSB0aGlzLmZvcm1EYXRhUGFydFxuXG4gICAgaWYgKCFmb3JtRGF0YVBhcnQpIHRocm93IG5ldyBFcnJvcihcImZvcm1EYXRhUGFydCB3YXNudCBzZXRcIilcblxuICAgIHRoaXMuZm9ybURhdGFQYXJ0ID0gdW5kZWZpbmVkXG4gICAgZm9ybURhdGFQYXJ0LmZpbmlzaCgpXG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiZm9ybS1kYXRhLXBhcnRcIiwgZm9ybURhdGFQYXJ0KVxuICB9XG5cbiAgaXNNdWx0aVBhcnR5Rm9ybURhdGEoKSB7XG4gICAgcmV0dXJuIHRoaXMubXVsdGlQYXJ0eUZvcm1EYXRhXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXcgZm9ybSBkYXRhIHBhcnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG5ld0Zvcm1EYXRhUGFydCgpIHtcbiAgICB0aGlzLmZvcm1EYXRhUGFydCA9IG5ldyBGb3JtRGF0YVBhcnQoKVxuICAgIHRoaXMuc2V0U3RhdGUoXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1oZWFkZXJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIExpbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHBhcnNlKGxpbmUpIHtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PSBcInN0YXR1c1wiKSB7XG4gICAgICB0aGlzLnBhcnNlU3RhdHVzTGluZShsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcImhlYWRlcnNcIikge1xuICAgICAgdGhpcy5wYXJzZUhlYWRlcihsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcImNodW5rZWQtc2l6ZVwiKSB7XG4gICAgICB0aGlzLnBhcnNlQ2h1bmtTaXplTGluZShsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcImNodW5rZWQtdHJhaWxlclwiKSB7XG4gICAgICBpZiAobGluZSA9PSBcIlxcclxcblwiKSB7XG4gICAgICAgIHRoaXMuZmluaXNoQ2h1bmtlZEJvZHkoKVxuICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwibXVsdGktcGFydC1mb3JtLWRhdGFcIikge1xuICAgICAgaWYgKGxpbmUgPT0gdGhpcy5ib3VuZGFyeUxpbmUpIHtcbiAgICAgICAgdGhpcy5uZXdGb3JtRGF0YVBhcnQoKVxuICAgICAgfSBlbHNlIGlmIChsaW5lID09IFwiXFxyXFxuXCIpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZShcImRvbmVcIilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYm91bmRhcnkgbGluZSBidXQgZGlkbid0IGdldCBpdDogJHtsaW5lfWApXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwibXVsdGktcGFydC1mb3JtLWRhdGEtaGVhZGVyXCIpIHtcbiAgICAgIGNvbnN0IGhlYWRlciA9IHRoaXMucmVhZEhlYWRlckZyb21MaW5lKGxpbmUpXG5cbiAgICAgIGlmIChoZWFkZXIpIHtcbiAgICAgICAgaWYgKCF0aGlzLmZvcm1EYXRhUGFydCkgdGhyb3cgbmV3IEVycm9yKFwiZm9ybURhdGFQYXJ0IG5vdCBzZXRcIilcblxuICAgICAgICB0aGlzLmZvcm1EYXRhUGFydC5hZGRIZWFkZXIoaGVhZGVyKVxuICAgICAgICAvL3RoaXMuc3RhdGUgPT0gXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YVwiXG4gICAgICB9IGVsc2UgaWYgKGxpbmUgPT0gXCJcXHJcXG5cIikge1xuICAgICAgICB0aGlzLnNldFN0YXRlKFwibXVsdGktcGFydC1mb3JtLWRhdGEtYm9keVwiKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gc3RhdGUgcGFyc2luZyBsaW5lOiAke3RoaXMuc3RhdGV9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGhlYWRlciBmcm9tIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gTGluZS5cbiAgICogQHJldHVybnMge0hlYWRlciB8IHVuZGVmaW5lZH0gLSBUaGUgaGVhZGVyIGZyb20gbGluZS5cbiAgICovXG4gIHJlYWRIZWFkZXJGcm9tTGluZShsaW5lKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKC4rKTogKC4rKVxcclxcbi8pXG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGNvbnN0IGhlYWRlciA9IG5ldyBIZWFkZXIobWF0Y2hbMV0sIG1hdGNoWzJdKVxuXG4gICAgICByZXR1cm4gaGVhZGVyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGhlYWRlci5cbiAgICogQHBhcmFtIHtIZWFkZXJ9IGhlYWRlciAtIEhlYWRlciB2YWx1ZS5cbiAgICovXG4gIGFkZEhlYWRlcihoZWFkZXIpIHtcbiAgICBjb25zdCBmb3JtYXR0ZWROYW1lID0gaGVhZGVyLmdldEZvcm1hdHRlZE5hbWUoKVxuICAgIGNvbnN0IGV4aXN0aW5nSGVhZGVyID0gdGhpcy5oZWFkZXJzQnlOYW1lW2Zvcm1hdHRlZE5hbWVdXG5cbiAgICAvLyBSRkMgOTExMCDCpzUuMzogYSBmaWVsZCBtYXkgYmUgcmVwZWF0ZWQ7IGl0cyB2YWx1ZSBpcyB0aGUgY29uY2F0ZW5hdGlvbiBvZlxuICAgIC8vIGFsbCBmaWVsZCB2YWx1ZXMgc2VwYXJhdGVkIGJ5IGNvbW1hcywgaW4gd2lyZSBvcmRlci4gT25seSBBY2NlcHQtRW5jb2RpbmdcbiAgICAvLyBpcyBjb25zdW1lZCBhcyBhIGNvbWJpbmVkIGZpZWxkIGJ5IHRoZSBzZXJ2ZXIuXG4gICAgaWYgKGV4aXN0aW5nSGVhZGVyICYmIENPTUJJTklOR19IRUFERVJfRklFTERTLmhhcyhmb3JtYXR0ZWROYW1lKSkge1xuICAgICAgZXhpc3RpbmdIZWFkZXIudmFsdWUgKz0gYCwgJHtoZWFkZXIuZ2V0VmFsdWUoKX1gXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuaGVhZGVyc0J5TmFtZVtmb3JtYXR0ZWROYW1lXSA9IGhlYWRlclxuICAgIH1cblxuICAgIGlmIChmb3JtYXR0ZWROYW1lID09IFwiY29udGVudC1sZW5ndGhcIikgdGhpcy5jb250ZW50TGVuZ3RoID0gcGFyc2VJbnQoaGVhZGVyLmdldFZhbHVlKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gTGluZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcGFyc2VIZWFkZXIobGluZSkge1xuICAgIGNvbnN0IGhlYWRlciA9IHRoaXMucmVhZEhlYWRlckZyb21MaW5lKGxpbmUpXG5cbiAgICBpZiAoaGVhZGVyKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBQYXJzZWQgaGVhZGVyOiAke2hlYWRlci50b1N0cmluZygpfWApXG4gICAgICB0aGlzLmFkZEhlYWRlcihoZWFkZXIpXG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwiaGVhZGVyXCIsIGhlYWRlcilcbiAgICB9IGVsc2UgaWYgKGxpbmUgPT0gXCJcXHJcXG5cIikge1xuICAgICAgY29uc3QgaHR0cE1ldGhvZCA9IHRoaXMuaHR0cE1ldGhvZD8udG9VcHBlckNhc2UoKVxuXG4gICAgICBpZiAoIWh0dHBNZXRob2QpIHRocm93IG5ldyBFcnJvcihcIkhUVFAgbWV0aG9kIG5vdCBzZXRcIilcblxuICAgICAgaWYgKCF0aGlzLmV4cGVjdHNSZXF1ZXN0Qm9keShodHRwTWV0aG9kKSkge1xuICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuaXNDaHVua2VkRW5jb2RpbmcoKSkge1xuICAgICAgICB0aGlzLnJlYWRpbmdCb2R5ID0gdHJ1ZVxuICAgICAgICB0aGlzLmJvZHlMZW5ndGggPSAwXG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZUNodW5rZWRCb2R5KClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVhZGluZ0JvZHkgPSB0cnVlXG4gICAgICAgIHRoaXMuYm9keUxlbmd0aCA9IDBcblxuICAgICAgICBpZiAodGhpcy5jb250ZW50TGVuZ3RoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRoaXMuY29udGVudExlbmd0aCkpIHRocm93IG5ldyBFcnJvcihcIkNvbnRlbnQgbGVuZ3RoIGlzIGludmFsaWRcIilcblxuICAgICAgICAgIHRoaXMuYXNzZXJ0UmVxdWVzdEJvZHlTaXplKHRoaXMuY29udGVudExlbmd0aClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1hdGNoID0gdGhpcy5nZXRIZWFkZXIoXCJjb250ZW50LXR5cGVcIik/LnZhbHVlPy5tYXRjaCgvXm11bHRpcGFydFxcL2Zvcm0tZGF0YTtcXHMqYm91bmRhcnk9KC4rKSQvaSlcblxuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5ID0gbWF0Y2hbMV1cbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5TGluZSA9IGAtLSR7dGhpcy5ib3VuZGFyeX1cXHJcXG5gXG4gICAgICAgICAgdGhpcy5ib3VuZGFyeUxpbmVOZXh0ID0gYFxcclxcbi0tJHt0aGlzLmJvdW5kYXJ5fVxcclxcbmBcbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5TGluZUVuZCA9IGBcXHJcXG4tLSR7dGhpcy5ib3VuZGFyeX0tLWBcbiAgICAgICAgICB0aGlzLm11bHRpUGFydHlGb3JtRGF0YSA9IHRydWVcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwibXVsdGktcGFydC1mb3JtLWRhdGFcIilcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggPT09IDAgfHwgdGhpcy5jb250ZW50TGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLyoqXG4gICAgICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICAgICAqIEB0eXBlIHtCdWZmZXJbXX0gKi9cbiAgICAgICAgICB0aGlzLnBvc3RCb2R5QnVmZmVycyA9IFtdXG5cbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwicG9zdC1ib2R5XCIpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBzdGF0dXMgbGluZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBMaW5lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwYXJzZVN0YXR1c0xpbmUobGluZSkge1xuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihbQS1aLV0rKSAoLis/KSBIVFRQXFwvKC4rKVxcclxcbi8pXG5cbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IG1hdGNoIHN0YXR1cyBsaW5lIGZyb206ICR7bGluZX1gKVxuICAgIH1cblxuICAgIHRoaXMuaHR0cE1ldGhvZCA9IG1hdGNoWzFdXG4gICAgdGhpcy5odHRwVmVyc2lvbiA9IG1hdGNoWzNdXG4gICAgdGhpcy5wYXRoID0gbWF0Y2hbMl1cbiAgICB0aGlzLnNldFN0YXRlKFwiaGVhZGVyc1wiKVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnTG93TGV2ZWwoKCkgPT4gW1wiUGFyc2VkIHN0YXR1cyBsaW5lXCIsIHtodHRwTWV0aG9kOiB0aGlzLmh0dHBNZXRob2QsIGh0dHBWZXJzaW9uOiB0aGlzLmh0dHBWZXJzaW9uLCBwYXRoOiB0aGlzLnBhdGh9XSlcbiAgfVxuXG4gIHBvc3RSZXF1ZXN0RG9uZSgpIHtcbiAgICBpZiAodGhpcy5wb3N0Qm9keUJ1ZmZlcnMpIHtcbiAgICAgIHRoaXMucG9zdEJvZHkgPSBCdWZmZXIuY29uY2F0KHRoaXMucG9zdEJvZHlCdWZmZXJzKS50b1N0cmluZyhcInV0ZjhcIilcbiAgICB9XG5cbiAgICB0aGlzLnBvc3RCb2R5QnVmZmVycyA9IHVuZGVmaW5lZFxuXG4gICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhwZWN0cyByZXF1ZXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBodHRwTWV0aG9kIC0gSFRUUCBtZXRob2QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgZXhwZWN0cyBhIGJvZHkuXG4gICAqL1xuICBleHBlY3RzUmVxdWVzdEJvZHkoaHR0cE1ldGhvZCkge1xuICAgIHJldHVybiAhW1wiR0VUXCIsIFwiT1BUSU9OU1wiLCBcIkhFQURcIl0uaW5jbHVkZXMoaHR0cE1ldGhvZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGNodW5rZWQgZW5jb2RpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgdXNlcyBjaHVua2VkIHRyYW5zZmVyIGVuY29kaW5nLlxuICAgKi9cbiAgaXNDaHVua2VkRW5jb2RpbmcoKSB7XG4gICAgY29uc3QgdHJhbnNmZXJFbmNvZGluZyA9IHRoaXMuZ2V0SGVhZGVyKFwidHJhbnNmZXItZW5jb2RpbmdcIik/LnZhbHVlPy50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gQm9vbGVhbih0cmFuc2ZlckVuY29kaW5nPy5pbmNsdWRlcyhcImNodW5rZWRcIikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIGNodW5rZWQgYm9keS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgaW5pdGlhbGl6ZUNodW5rZWRCb2R5KCkge1xuICAgIHRoaXMuY2h1bmtlZEJvZHlDaGFycyA9IFtdXG4gICAgdGhpcy5jdXJyZW50Q2h1bmtTaXplID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSAwXG4gICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtc2l6ZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgY2h1bmsgc2l6ZSBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIENodW5rIHNpemUgbGluZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcGFyc2VDaHVua1NpemVMaW5lKGxpbmUpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKClcblxuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuXG5cbiAgICBjb25zdCBzaXplVG9rZW4gPSB0cmltbWVkLnNwbGl0KFwiO1wiKVswXT8udHJpbSgpXG5cbiAgICBpZiAoIXNpemVUb2tlbikgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNodW5rIHNpemUgbGluZTogJHtsaW5lfWApXG5cbiAgICBjb25zdCBzaXplID0gTnVtYmVyLnBhcnNlSW50KHNpemVUb2tlbiwgMTYpXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShzaXplKSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNodW5rIHNpemU6ICR7c2l6ZVRva2VufWApXG5cbiAgICBpZiAoc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtdHJhaWxlclwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5hc3NlcnRSZXF1ZXN0Qm9keVNpemUoKHRoaXMuY2h1bmtlZEJvZHlDaGFycz8ubGVuZ3RoIHx8IDApICsgc2l6ZSlcblxuICAgIHRoaXMuY3VycmVudENodW5rU2l6ZSA9IHNpemVcbiAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IDBcbiAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1kYXRhXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5pc2ggY2h1bmtlZCBib2R5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBmaW5pc2hDaHVua2VkQm9keSgpIHtcbiAgICBpZiAodGhpcy5jaHVua2VkQm9keUNoYXJzKSB7XG4gICAgICB0aGlzLnBvc3RCb2R5ID0gQnVmZmVyLmZyb20odGhpcy5jaHVua2VkQm9keUNoYXJzKS50b1N0cmluZyhcInV0ZjhcIilcbiAgICB9XG5cbiAgICBkZWxldGUgdGhpcy5jaHVua2VkQm9keUNoYXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdTdGF0ZSAtIE5ldyBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RhdGUobmV3U3RhdGUpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBDaGFuZ2luZyBzdGF0ZSBmcm9tICR7dGhpcy5zdGF0ZX0gdG8gJHtuZXdTdGF0ZX1gKVxuICAgIHRoaXMuc3RhdGUgPSBuZXdTdGF0ZVxuICB9XG5cbiAgY29tcGxldGVSZXF1ZXN0ID0gKCkgPT4ge1xuICAgIHRoaXMuc3RhdGUgPSBcInN0YXR1c1wiIC8vIFJlc2V0IHN0YXRlIHRvIG5ldyByZXF1ZXN0XG4gICAgdGhpcy5jb21wbGV0ZWQgPSB0cnVlXG5cbiAgICBpZiAodGhpcy5nZXRIZWFkZXIoXCJjb250ZW50LXR5cGVcIik/LnZhbHVlPy5zdGFydHNXaXRoKFwiYXBwbGljYXRpb24vanNvblwiKSkge1xuICAgICAgdGhpcy5wYXJzZUFwcGxpY2F0aW9uSnNvblBhcmFtcygpXG4gICAgfSBlbHNlIGlmICh0aGlzLm11bHRpUGFydHlGb3JtRGF0YSkge1xuICAgICAgLy8gRG9uZSBhZnRlciBlYWNoIG5ldyBmb3JtIGRhdGEgcGFydFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBhcnNlUXVlcnlTdHJpbmdQb3N0UGFyYW1zKClcbiAgICB9XG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY29tcGxldGVkXCIpXG4gIH1cblxuICBwYXJzZUFwcGxpY2F0aW9uSnNvblBhcmFtcygpIHtcbiAgICBpZiAodGhpcy5wb3N0Qm9keSkge1xuICAgICAgY29uc3QgbmV3UGFyYW1zID0gSlNPTi5wYXJzZSh0aGlzLnBvc3RCb2R5KVxuXG4gICAgICBpbmNvcnBvcmF0ZSh0aGlzLnBhcmFtcywgbmV3UGFyYW1zKVxuICAgIH1cbiAgfVxuXG4gIHBhcnNlUXVlcnlTdHJpbmdQb3N0UGFyYW1zKCkge1xuICAgIGlmICh0aGlzLnBvc3RCb2R5KSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwYXJzZWRRdWVyeSA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHRoaXMucG9zdEJvZHkpXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBVbnBhcnNlZCBwYXJhbXMuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59ICovXG4gICAgICAgIGNvbnN0IHVucGFyc2VkUGFyYW1zID0ge31cblxuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwYXJzZWRRdWVyeSkpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICB1bnBhcnNlZFBhcmFtc1trZXldID0gdmFsdWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwYXJhbXNUb09iamVjdCA9IG5ldyBQYXJhbXNUb09iamVjdCh1bnBhcnNlZFBhcmFtcylcbiAgICAgICAgY29uc3QgbmV3UGFyYW1zID0gcGFyYW1zVG9PYmplY3QudG9PYmplY3QoKVxuXG4gICAgICAgIGluY29ycG9yYXRlKHRoaXMucGFyYW1zLCBuZXdQYXJhbXMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBlbnN1cmVkRXJyb3IgPSAvKiogQHR5cGUge0Vycm9yICYge3ZlbG9jaW91c0NvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqLyAoZXJyb3IpXG5cbiAgICAgICAgZW5zdXJlZEVycm9yLnZlbG9jaW91c0NvbnRleHQgPSB7XG4gICAgICAgICAgLi4uKGVuc3VyZWRFcnJvci52ZWxvY2lvdXNDb250ZXh0IHx8IHt9KSxcbiAgICAgICAgICByZXF1ZXN0UGFyc2luZzoge1xuICAgICAgICAgICAgY29udGVudFR5cGU6IHRoaXMuZ2V0SGVhZGVyKFwiY29udGVudC10eXBlXCIpPy52YWx1ZSxcbiAgICAgICAgICAgIGh0dHBNZXRob2Q6IHRoaXMuaHR0cE1ldGhvZCxcbiAgICAgICAgICAgIHBhcmFtZXRlcktleXM6IE9iamVjdC5rZXlzKHF1ZXJ5c3RyaW5nLnBhcnNlKHRoaXMucG9zdEJvZHkpKSxcbiAgICAgICAgICAgIHBhdGg6IHRoaXMucGF0aCxcbiAgICAgICAgICAgIHBvc3RCb2R5UHJldmlldzogdHJ1bmNhdGVQcmV2aWV3KHRoaXMucG9zdEJvZHkpLFxuICAgICAgICAgICAgc3RhZ2U6IFwicXVlcnktc3RyaW5nLXBvc3QtcGFyYW1zXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlbnN1cmVkRXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==