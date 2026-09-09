// @ts-check
import EventEmitter from "../../../utils/event-emitter.js";
import FormDataPart from "./form-data-part.js";
import Header from "./header.js";
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
                else if (Number.isNaN(this.contentLength)) {
                    throw new Error("Content length is invalid");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtYnVmZmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSxpQ0FBaUMsQ0FBQTtBQUMxRCxPQUFPLFlBQVksTUFBTSxxQkFBcUIsQ0FBQTtBQUM5QyxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxFQUFDLFdBQVcsRUFBQyxNQUFNLGNBQWMsQ0FBQTtBQUN4QyxPQUFPLE1BQU0sTUFBTSxvQkFBb0IsQ0FBQTtBQUN2QyxPQUFPLGNBQWMsTUFBTSx3QkFBd0IsQ0FBQTtBQUNuRCxPQUFPLFdBQVcsTUFBTSxhQUFhLENBQUE7QUFFckM7Ozt5QkFHeUI7QUFDekIsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQTtBQUU1RDs7Ozs7R0FLRztBQUNILFNBQVMsZUFBZSxDQUFDLEtBQUssRUFBRSxLQUFLLEdBQUcsR0FBRztJQUN6QyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7UUFBRSxPQUFPLFNBQVMsQ0FBQTtJQUMvQyxJQUFJLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSztRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRXZDLE9BQU8sR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFBO0FBQ3RDLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWE7SUFDaEMsVUFBVSxHQUFHLENBQUMsQ0FBQTtJQUVkLG1DQUFtQztJQUNuQyxlQUFlLEdBQUcsU0FBUyxDQUFBO0lBRTNCOzswQkFFc0I7SUFDdEIsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUVULE1BQU0sR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFBO0lBRTNCOzt3Q0FFb0M7SUFD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QztnQkFDSCxDQUFDO2dCQUVELE1BQU0sY0FBYyxHQUFHLElBQUksY0FBYyxDQUFDLGNBQWMsQ0FBQyxDQUFBO2dCQUN6RCxNQUFNLFNBQVMsR0FBRyxjQUFjLENBQUMsUUFBUSxFQUFFLENBQUE7Z0JBRTNDLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFBO1lBQ3JDLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sWUFBWSxHQUFHLHlGQUF5RixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7Z0JBRXRILFlBQVksQ0FBQyxnQkFBZ0IsR0FBRztvQkFDOUIsR0FBRyxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7b0JBQ3hDLGNBQWMsRUFBRTt3QkFDZCxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsRUFBRSxLQUFLO3dCQUNsRCxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7d0JBQzNCLGFBQWEsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO3dCQUM1RCxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7d0JBQ2YsZUFBZSxFQUFFLGVBQWUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO3dCQUMvQyxLQUFLLEVBQUUsMEJBQTBCO3FCQUNsQztpQkFDRixDQUFBO2dCQUVELE1BQU0sWUFBWSxDQUFBO1lBQ3BCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uLy4uLy4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IEZvcm1EYXRhUGFydCBmcm9tIFwiLi9mb3JtLWRhdGEtcGFydC5qc1wiXG5pbXBvcnQgSGVhZGVyIGZyb20gXCIuL2hlYWRlci5qc1wiXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUGFyYW1zVG9PYmplY3QgZnJvbSBcIi4uL3BhcmFtcy10by1vYmplY3QuanNcIlxuaW1wb3J0IHF1ZXJ5c3RyaW5nIGZyb20gXCJxdWVyeXN0cmluZ1wiXG5cbi8qKlxuICogUmVxdWVzdCBoZWFkZXIgZmllbGRzIHdob3NlIHJlcGVhdGVkIHdpcmUgZmllbGRzIGNvbWJpbmUgaW50byBvbmUgdmFsdWVcbiAqIChSRkMgOTExMCDCpzUuMykgYmVmb3JlIHRoZSBzZXJ2ZXIgY29uc3VtZXMgdGhlbS5cbiAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbmNvbnN0IENPTUJJTklOR19IRUFERVJfRklFTERTID0gbmV3IFNldChbXCJhY2NlcHQtZW5jb2RpbmdcIl0pXG5cbi8qKlxuICogUnVucyB0cnVuY2F0ZSBwcmV2aWV3LlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGlucHV0IC0gSW5wdXQgc3RyaW5nLlxuICogQHBhcmFtIHtudW1iZXJ9IFtsaW1pdF0gLSBNYXggcHJldmlldyBsZW5ndGguXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRydW5jYXRlZCBwcmV2aWV3LlxuICovXG5mdW5jdGlvbiB0cnVuY2F0ZVByZXZpZXcoaW5wdXQsIGxpbWl0ID0gMzAwKSB7XG4gIGlmICh0eXBlb2YgaW5wdXQgIT09IFwic3RyaW5nXCIpIHJldHVybiB1bmRlZmluZWRcbiAgaWYgKGlucHV0Lmxlbmd0aCA8PSBsaW1pdCkgcmV0dXJuIGlucHV0XG5cbiAgcmV0dXJuIGAke2lucHV0LnNsaWNlKDAsIGxpbWl0KX0uLi5gXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlcXVlc3RCdWZmZXIge1xuICBib2R5TGVuZ3RoID0gMFxuXG4gIC8qKiBAdHlwZSB7QnVmZmVyW10gfCB1bmRlZmluZWR9ICovXG4gIHBvc3RCb2R5QnVmZmVycyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEYXRhLlxuICAgKiBAdHlwZSB7bnVtYmVyW119ICovXG4gIGRhdGEgPSBbXVxuXG4gIGV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gIC8qKlxuICAgKiBIZWFkZXJzIGJ5IG5hbWUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBIZWFkZXI+fSAqL1xuICBoZWFkZXJzQnlOYW1lID0ge31cbiAgLyoqXG4gICAqIENodW5rZWQgYm9keSBjaGFycy5cbiAgICogQHR5cGUge251bWJlcltdIHwgdW5kZWZpbmVkfSAqL1xuICBjaHVua2VkQm9keUNoYXJzID0gdW5kZWZpbmVkXG5cbiAgbXVsdGlQYXJ0eUZvcm1EYXRhID0gZmFsc2VcblxuICBjb21wbGV0ZWQgPSBmYWxzZVxuICBwYXJhbXMgPSB7fVxuICByZWFkaW5nQm9keSA9IGZhbHNlXG4gIHN0YXRlID0gXCJzdGF0dXNcIlxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9ufSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcywge2RlYnVnOiBmYWxzZX0pXG4gIH1cblxuICBkZXN0cm95KCkge1xuICAgIC8vIERvIG5vdGhpbmcgZm9yIG5vdy4uLlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmVlZC5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtCdWZmZXIgfCB1bmRlZmluZWR9IC0gUmVtYWluaW5nIGRhdGEsIGlmIGFueS5cbiAgICovXG4gIGZlZWQoZGF0YSkge1xuICAgIGxldCBpbmRleCA9IDBcblxuICAgIHdoaWxlIChpbmRleCA8IGRhdGEubGVuZ3RoKSB7XG4gICAgICBzd2l0Y2godGhpcy5zdGF0ZSkge1xuICAgICAgICBjYXNlIFwic3RhdHVzXCI6XG4gICAgICAgIGNhc2UgXCJoZWFkZXJzXCI6XG4gICAgICAgIGNhc2UgXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YVwiOlxuICAgICAgICBjYXNlIFwibXVsdGktcGFydC1mb3JtLWRhdGEtaGVhZGVyXCI6XG4gICAgICAgIGNhc2UgXCJjaHVua2VkLXNpemVcIjpcbiAgICAgICAgY2FzZSBcImNodW5rZWQtdHJhaWxlclwiOlxuICAgICAgICAgIGluZGV4ID0gdGhpcy5mZWVkTGluZShkYXRhLCBpbmRleClcbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIFwicG9zdC1ib2R5XCI6XG4gICAgICAgICAgaW5kZXggPSB0aGlzLmZlZWRQb3N0Qm9keShkYXRhLCBpbmRleClcbiAgICAgICAgICBicmVha1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIGluZGV4ID0gdGhpcy5mZWVkQnl0ZShkYXRhLCBpbmRleClcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuY29tcGxldGVkKSB7XG4gICAgICAgIHJldHVybiBkYXRhLnN1YmFycmF5KGluZGV4KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyBieXRlcyBmb3IgdGhlIGxpbmUtYmFzZWQgc3RhdGVzIHVwIHRvIGFuZCBpbmNsdWRpbmcgdGhlIG5leHQgbmV3bGluZS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFJlYWQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTmV3IHJlYWQgcG9zaXRpb24uXG4gICAqL1xuICBmZWVkTGluZShkYXRhLCBpbmRleCkge1xuICAgIGNvbnN0IG5ld2xpbmVJbmRleCA9IGRhdGEuaW5kZXhPZigxMCwgaW5kZXgpXG5cbiAgICBpZiAobmV3bGluZUluZGV4ID09PSAtMSkge1xuICAgICAgaWYgKHRoaXMucmVhZGluZ0JvZHkpIHRoaXMuYm9keUxlbmd0aCArPSBkYXRhLmxlbmd0aCAtIGluZGV4XG5cbiAgICAgIGZvciAobGV0IGRhdGFJbmRleCA9IGluZGV4OyBkYXRhSW5kZXggPCBkYXRhLmxlbmd0aDsgZGF0YUluZGV4ICs9IDEpIHtcbiAgICAgICAgdGhpcy5kYXRhLnB1c2goZGF0YVtkYXRhSW5kZXhdKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGF0YS5sZW5ndGhcbiAgICB9XG5cbiAgICBpZiAodGhpcy5yZWFkaW5nQm9keSkgdGhpcy5ib2R5TGVuZ3RoICs9IG5ld2xpbmVJbmRleCArIDEgLSBpbmRleFxuXG4gICAgbGV0IGxpbmVcblxuICAgIGlmICh0aGlzLmRhdGEubGVuZ3RoID09IDApIHtcbiAgICAgIGxpbmUgPSBkYXRhLnRvU3RyaW5nKFwibGF0aW4xXCIsIGluZGV4LCBuZXdsaW5lSW5kZXggKyAxKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUaGUgcmVzdCBvZiBhIGxpbmUgdGhhdCBzdGFydGVkIGluIGEgcHJldmlvdXMgY2h1bmsuXG4gICAgICBmb3IgKGxldCBkYXRhSW5kZXggPSBpbmRleDsgZGF0YUluZGV4IDw9IG5ld2xpbmVJbmRleDsgZGF0YUluZGV4ICs9IDEpIHtcbiAgICAgICAgdGhpcy5kYXRhLnB1c2goZGF0YVtkYXRhSW5kZXhdKVxuICAgICAgfVxuXG4gICAgICBsaW5lID0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCB0aGlzLmRhdGEpXG4gICAgICB0aGlzLmRhdGEgPSBbXVxuICAgIH1cblxuICAgIHRoaXMucGFyc2UobGluZSlcblxuICAgIHJldHVybiBuZXdsaW5lSW5kZXggKyAxXG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgZml4ZWQtbGVuZ3RoIHJlcXVlc3QgYm9keSBieXRlcyBpbiBidWxrLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGluZGV4IC0gUmVhZCBwb3NpdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOZXcgcmVhZCBwb3NpdGlvbi5cbiAgICovXG4gIGZlZWRQb3N0Qm9keShkYXRhLCBpbmRleCkge1xuICAgIGlmICghdGhpcy5wb3N0Qm9keUJ1ZmZlcnMpIHRocm93IG5ldyBFcnJvcihcInBvc3RCb2R5QnVmZmVycyBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAodGhpcy5jb250ZW50TGVuZ3RoID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkNvbnRlbnQgbGVuZ3RoIG5vdCBzZXRcIilcblxuICAgIGNvbnN0IHJlbWFpbmluZ0JvZHlCeXRlcyA9IE1hdGgubWF4KDEsIHRoaXMuY29udGVudExlbmd0aCAtIHRoaXMuYm9keUxlbmd0aClcbiAgICBjb25zdCBlbmRJbmRleCA9IE1hdGgubWluKGRhdGEubGVuZ3RoLCBpbmRleCArIHJlbWFpbmluZ0JvZHlCeXRlcylcblxuICAgIHRoaXMucG9zdEJvZHlCdWZmZXJzLnB1c2goZGF0YS5zdWJhcnJheShpbmRleCwgZW5kSW5kZXgpKVxuICAgIHRoaXMuYm9keUxlbmd0aCArPSBlbmRJbmRleCAtIGluZGV4XG5cbiAgICBpZiAodGhpcy5jb250ZW50TGVuZ3RoICYmIHRoaXMuYm9keUxlbmd0aCA+PSB0aGlzLmNvbnRlbnRMZW5ndGgpIHtcbiAgICAgIHRoaXMucG9zdFJlcXVlc3REb25lKClcbiAgICB9XG5cbiAgICByZXR1cm4gZW5kSW5kZXhcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyBhIHNpbmdsZSBieXRlIGZvciB0aGUgYnl0ZS1iYXNlZCBwYXJzZXIgc3RhdGVzLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGluZGV4IC0gUmVhZCBwb3NpdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOZXcgcmVhZCBwb3NpdGlvbi5cbiAgICovXG4gIGZlZWRCeXRlKGRhdGEsIGluZGV4KSB7XG4gICAgY29uc3QgY2hhciA9IGRhdGFbaW5kZXhdXG5cbiAgICBpZiAodGhpcy5yZWFkaW5nQm9keSkgdGhpcy5ib2R5TGVuZ3RoICs9IDFcblxuICAgIHN3aXRjaCh0aGlzLnN0YXRlKSB7XG4gICAgICBjYXNlIFwiY2h1bmtlZC1kYXRhXCI6IHtcbiAgICAgICAgY29uc3QgY2h1bmtlZEJvZHlDaGFycyA9IHRoaXMuY2h1bmtlZEJvZHlDaGFyc1xuXG4gICAgICAgIGlmICh0aGlzLmN1cnJlbnRDaHVua1NpemUgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiQ2h1bmsgc2l6ZSBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICAgICAgaWYgKCFjaHVua2VkQm9keUNoYXJzKSB0aHJvdyBuZXcgRXJyb3IoXCJDaHVua2VkIGJvZHkgbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICAgICAgY2h1bmtlZEJvZHlDaGFycy5wdXNoKGNoYXIpXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDdXJyZW50IGNodW5rIGJ5dGVzIHJlYWQuXG4gICAgICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgICAgIGNvbnN0IGN1cnJlbnRDaHVua0J5dGVzUmVhZCA9ICh0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCB8fCAwKSArIDFcblxuICAgICAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IGN1cnJlbnRDaHVua0J5dGVzUmVhZFxuXG4gICAgICAgIGlmIChjdXJyZW50Q2h1bmtCeXRlc1JlYWQgPj0gdGhpcy5jdXJyZW50Q2h1bmtTaXplKSB7XG4gICAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCA9IDBcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1kYXRhLWNybGZcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgICBjYXNlIFwiY2h1bmtlZC1kYXRhLWNybGZcIjpcbiAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCA9ICh0aGlzLmN1cnJlbnRDaHVua0NybGZSZWFkIHx8IDApICsgMVxuXG4gICAgICAgIGlmICh0aGlzLmN1cnJlbnRDaHVua0NybGZSZWFkID49IDIpIHtcbiAgICAgICAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IDBcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1zaXplXCIpXG4gICAgICAgIH1cblxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWJvZHlcIjoge1xuICAgICAgICBpZiAoIXRoaXMuZm9ybURhdGFQYXJ0KSB0aHJvdyBuZXcgRXJyb3IoXCJGb3JtRGF0YSBwYXJ0IG5vdCBpbml0aWFsaXplZFwiKVxuICAgICAgICBpZiAoIXRoaXMuYm91bmRhcnlMaW5lRW5kKSB0aHJvdyBuZXcgRXJyb3IoXCJCb3VuZGFyeSBsaW5lIGVuZCBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICAgICAgaWYgKCF0aGlzLmJvdW5kYXJ5TGluZU5leHQpIHRocm93IG5ldyBFcnJvcihcIkJvdW5kYXJ5IGxpbmUgbmV4dCBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgICAgICBjb25zdCBib2R5ID0gdGhpcy5mb3JtRGF0YVBhcnQuYm9keVxuXG4gICAgICAgIGJvZHkucHVzaChjaGFyKVxuXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlFbmRQb3NpdGlvbiA9IGJvZHkubGVuZ3RoIC0gdGhpcy5ib3VuZGFyeUxpbmVFbmQubGVuZ3RoXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlFbmRDaGFycyA9IGJvZHkuc2xpY2UocG9zc2libGVCb3VuZGFyeUVuZFBvc2l0aW9uLCBib2R5Lmxlbmd0aClcbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeUVuZCA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgcG9zc2libGVCb3VuZGFyeUVuZENoYXJzKVxuXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlOZXh0UG9zaXRpb24gPSBib2R5Lmxlbmd0aCAtIHRoaXMuYm91bmRhcnlMaW5lTmV4dC5sZW5ndGhcbiAgICAgICAgY29uc3QgcG9zc2libGVCb3VuZGFyeU5leHRDaGFycyA9IGJvZHkuc2xpY2UocG9zc2libGVCb3VuZGFyeU5leHRQb3NpdGlvbiwgYm9keS5sZW5ndGgpXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlOZXh0ID0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBwb3NzaWJsZUJvdW5kYXJ5TmV4dENoYXJzKVxuXG4gICAgICAgIGlmIChwb3NzaWJsZUJvdW5kYXJ5RW5kID09IHRoaXMuYm91bmRhcnlMaW5lRW5kKSB7XG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnQucmVtb3ZlRnJvbUJvZHkocG9zc2libGVCb3VuZGFyeUVuZClcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuICAgICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgICAgfSBlbHNlIGlmIChwb3NzaWJsZUJvdW5kYXJ5TmV4dCA9PSB0aGlzLmJvdW5kYXJ5TGluZU5leHQpIHtcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydC5yZW1vdmVGcm9tQm9keShwb3NzaWJsZUJvdW5kYXJ5TmV4dClcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuICAgICAgICAgIHRoaXMubmV3Rm9ybURhdGFQYXJ0KClcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmNvbnRlbnRMZW5ndGggJiYgdGhpcy5ib2R5TGVuZ3RoID49IHRoaXMuY29udGVudExlbmd0aCkge1xuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0RG9uZSgpXG4gICAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZm9ybURhdGFQYXJ0LmNvbnRlbnRMZW5ndGggJiYgdGhpcy5ib2R5TGVuZ3RoID49IHRoaXMuZm9ybURhdGFQYXJ0LmNvbnRlbnRMZW5ndGgpIHtcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3R1YlwiKVxuICAgICAgICB9XG5cbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgVW5rbm93biBzdGF0ZSBmb3IgcmVxdWVzdCBidWZmZXJgLCB7c3RhdGU6IHRoaXMuc3RhdGV9XSlcbiAgICB9XG5cbiAgICByZXR1cm4gaW5kZXggKyAxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtIZWFkZXJ9IC0gVGhlIGhlYWRlci5cbiAgICovXG4gIGdldEhlYWRlcihuYW1lKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5oZWFkZXJzQnlOYW1lW25hbWUudG9Mb3dlckNhc2UoKS50cmltKCldXG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IFtgZ2V0SGVhZGVyICR7bmFtZX1gLCB7cmVzdWx0OiByZXN1bHQ/LnRvU3RyaW5nKCl9XSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBoZWFkZXJzIGhhc2guXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIFRoZSBoZWFkZXJzIGhhc2guXG4gICAqL1xuICBnZXRIZWFkZXJzSGFzaCgpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGZvciAoY29uc3QgaGVhZGVyRm9ybWF0dGVkTmFtZSBpbiB0aGlzLmhlYWRlcnNCeU5hbWUpIHtcbiAgICAgIGNvbnN0IGhlYWRlciA9IHRoaXMuaGVhZGVyc0J5TmFtZVtoZWFkZXJGb3JtYXR0ZWROYW1lXVxuXG4gICAgICByZXN1bHRbaGVhZGVyLmdldE5hbWUoKV0gPSBoZWFkZXIuZ2V0VmFsdWUoKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm0gZGF0YSBwYXJ0IGRvbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGZvcm1EYXRhUGFydERvbmUoKSB7XG4gICAgY29uc3QgZm9ybURhdGFQYXJ0ID0gdGhpcy5mb3JtRGF0YVBhcnRcblxuICAgIGlmICghZm9ybURhdGFQYXJ0KSB0aHJvdyBuZXcgRXJyb3IoXCJmb3JtRGF0YVBhcnQgd2FzbnQgc2V0XCIpXG5cbiAgICB0aGlzLmZvcm1EYXRhUGFydCA9IHVuZGVmaW5lZFxuICAgIGZvcm1EYXRhUGFydC5maW5pc2goKVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImZvcm0tZGF0YS1wYXJ0XCIsIGZvcm1EYXRhUGFydClcbiAgfVxuXG4gIGlzTXVsdGlQYXJ0eUZvcm1EYXRhKCkge1xuICAgIHJldHVybiB0aGlzLm11bHRpUGFydHlGb3JtRGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IGZvcm0gZGF0YSBwYXJ0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBuZXdGb3JtRGF0YVBhcnQoKSB7XG4gICAgdGhpcy5mb3JtRGF0YVBhcnQgPSBuZXcgRm9ybURhdGFQYXJ0KClcbiAgICB0aGlzLnNldFN0YXRlKFwibXVsdGktcGFydC1mb3JtLWRhdGEtaGVhZGVyXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBMaW5lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwYXJzZShsaW5lKSB7XG4gICAgaWYgKHRoaXMuc3RhdGUgPT0gXCJzdGF0dXNcIikge1xuICAgICAgdGhpcy5wYXJzZVN0YXR1c0xpbmUobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJoZWFkZXJzXCIpIHtcbiAgICAgIHRoaXMucGFyc2VIZWFkZXIobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJjaHVua2VkLXNpemVcIikge1xuICAgICAgdGhpcy5wYXJzZUNodW5rU2l6ZUxpbmUobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJjaHVua2VkLXRyYWlsZXJcIikge1xuICAgICAgaWYgKGxpbmUgPT0gXCJcXHJcXG5cIikge1xuICAgICAgICB0aGlzLmZpbmlzaENodW5rZWRCb2R5KClcbiAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhXCIpIHtcbiAgICAgIGlmIChsaW5lID09IHRoaXMuYm91bmRhcnlMaW5lKSB7XG4gICAgICAgIHRoaXMubmV3Rm9ybURhdGFQYXJ0KClcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PSBcIlxcclxcblwiKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoXCJkb25lXCIpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGJvdW5kYXJ5IGxpbmUgYnV0IGRpZG4ndCBnZXQgaXQ6ICR7bGluZX1gKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWhlYWRlclwiKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSB0aGlzLnJlYWRIZWFkZXJGcm9tTGluZShsaW5lKVxuXG4gICAgICBpZiAoaGVhZGVyKSB7XG4gICAgICAgIGlmICghdGhpcy5mb3JtRGF0YVBhcnQpIHRocm93IG5ldyBFcnJvcihcImZvcm1EYXRhUGFydCBub3Qgc2V0XCIpXG5cbiAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnQuYWRkSGVhZGVyKGhlYWRlcilcbiAgICAgICAgLy90aGlzLnN0YXRlID09IFwibXVsdGktcGFydC1mb3JtLWRhdGFcIlxuICAgICAgfSBlbHNlIGlmIChsaW5lID09IFwiXFxyXFxuXCIpIHtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZShcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWJvZHlcIilcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHN0YXRlIHBhcnNpbmcgbGluZTogJHt0aGlzLnN0YXRlfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBoZWFkZXIgZnJvbSBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIExpbmUuXG4gICAqIEByZXR1cm5zIHtIZWFkZXIgfCB1bmRlZmluZWR9IC0gVGhlIGhlYWRlciBmcm9tIGxpbmUuXG4gICAqL1xuICByZWFkSGVhZGVyRnJvbUxpbmUobGluZSkge1xuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXiguKyk6ICguKylcXHJcXG4vKVxuXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSBuZXcgSGVhZGVyKG1hdGNoWzFdLCBtYXRjaFsyXSlcblxuICAgICAgcmV0dXJuIGhlYWRlclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBoZWFkZXIuXG4gICAqIEBwYXJhbSB7SGVhZGVyfSBoZWFkZXIgLSBIZWFkZXIgdmFsdWUuXG4gICAqL1xuICBhZGRIZWFkZXIoaGVhZGVyKSB7XG4gICAgY29uc3QgZm9ybWF0dGVkTmFtZSA9IGhlYWRlci5nZXRGb3JtYXR0ZWROYW1lKClcbiAgICBjb25zdCBleGlzdGluZ0hlYWRlciA9IHRoaXMuaGVhZGVyc0J5TmFtZVtmb3JtYXR0ZWROYW1lXVxuXG4gICAgLy8gUkZDIDkxMTAgwqc1LjM6IGEgZmllbGQgbWF5IGJlIHJlcGVhdGVkOyBpdHMgdmFsdWUgaXMgdGhlIGNvbmNhdGVuYXRpb24gb2ZcbiAgICAvLyBhbGwgZmllbGQgdmFsdWVzIHNlcGFyYXRlZCBieSBjb21tYXMsIGluIHdpcmUgb3JkZXIuIE9ubHkgQWNjZXB0LUVuY29kaW5nXG4gICAgLy8gaXMgY29uc3VtZWQgYXMgYSBjb21iaW5lZCBmaWVsZCBieSB0aGUgc2VydmVyLlxuICAgIGlmIChleGlzdGluZ0hlYWRlciAmJiBDT01CSU5JTkdfSEVBREVSX0ZJRUxEUy5oYXMoZm9ybWF0dGVkTmFtZSkpIHtcbiAgICAgIGV4aXN0aW5nSGVhZGVyLnZhbHVlICs9IGAsICR7aGVhZGVyLmdldFZhbHVlKCl9YFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmhlYWRlcnNCeU5hbWVbZm9ybWF0dGVkTmFtZV0gPSBoZWFkZXJcbiAgICB9XG5cbiAgICBpZiAoZm9ybWF0dGVkTmFtZSA9PSBcImNvbnRlbnQtbGVuZ3RoXCIpIHRoaXMuY29udGVudExlbmd0aCA9IHBhcnNlSW50KGhlYWRlci5nZXRWYWx1ZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIExpbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHBhcnNlSGVhZGVyKGxpbmUpIHtcbiAgICBjb25zdCBoZWFkZXIgPSB0aGlzLnJlYWRIZWFkZXJGcm9tTGluZShsaW5lKVxuXG4gICAgaWYgKGhlYWRlcikge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBgUGFyc2VkIGhlYWRlcjogJHtoZWFkZXIudG9TdHJpbmcoKX1gKVxuICAgICAgdGhpcy5hZGRIZWFkZXIoaGVhZGVyKVxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImhlYWRlclwiLCBoZWFkZXIpXG4gICAgfSBlbHNlIGlmIChsaW5lID09IFwiXFxyXFxuXCIpIHtcbiAgICAgIGNvbnN0IGh0dHBNZXRob2QgPSB0aGlzLmh0dHBNZXRob2Q/LnRvVXBwZXJDYXNlKClcblxuICAgICAgaWYgKCFodHRwTWV0aG9kKSB0aHJvdyBuZXcgRXJyb3IoXCJIVFRQIG1ldGhvZCBub3Qgc2V0XCIpXG5cbiAgICAgIGlmICghdGhpcy5leHBlY3RzUmVxdWVzdEJvZHkoaHR0cE1ldGhvZCkpIHtcbiAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgfSBlbHNlIGlmICh0aGlzLmlzQ2h1bmtlZEVuY29kaW5nKCkpIHtcbiAgICAgICAgdGhpcy5yZWFkaW5nQm9keSA9IHRydWVcbiAgICAgICAgdGhpcy5ib2R5TGVuZ3RoID0gMFxuICAgICAgICB0aGlzLmluaXRpYWxpemVDaHVua2VkQm9keSgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlYWRpbmdCb2R5ID0gdHJ1ZVxuICAgICAgICB0aGlzLmJvZHlMZW5ndGggPSAwXG5cbiAgICAgICAgY29uc3QgbWF0Y2ggPSB0aGlzLmdldEhlYWRlcihcImNvbnRlbnQtdHlwZVwiKT8udmFsdWU/Lm1hdGNoKC9ebXVsdGlwYXJ0XFwvZm9ybS1kYXRhO1xccypib3VuZGFyeT0oLispJC9pKVxuXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIHRoaXMuYm91bmRhcnkgPSBtYXRjaFsxXVxuICAgICAgICAgIHRoaXMuYm91bmRhcnlMaW5lID0gYC0tJHt0aGlzLmJvdW5kYXJ5fVxcclxcbmBcbiAgICAgICAgICB0aGlzLmJvdW5kYXJ5TGluZU5leHQgPSBgXFxyXFxuLS0ke3RoaXMuYm91bmRhcnl9XFxyXFxuYFxuICAgICAgICAgIHRoaXMuYm91bmRhcnlMaW5lRW5kID0gYFxcclxcbi0tJHt0aGlzLmJvdW5kYXJ5fS0tYFxuICAgICAgICAgIHRoaXMubXVsdGlQYXJ0eUZvcm1EYXRhID0gdHJ1ZVxuICAgICAgICAgIHRoaXMuc2V0U3RhdGUoXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YVwiKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuY29udGVudExlbmd0aCA9PT0gMCB8fCB0aGlzLmNvbnRlbnRMZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgICAgfSBlbHNlIGlmIChOdW1iZXIuaXNOYU4odGhpcy5jb250ZW50TGVuZ3RoKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRlbnQgbGVuZ3RoIGlzIGludmFsaWRcIilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvKipcbiAgICAgICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgICAgICogQHR5cGUge0J1ZmZlcltdfSAqL1xuICAgICAgICAgIHRoaXMucG9zdEJvZHlCdWZmZXJzID0gW11cblxuICAgICAgICAgIHRoaXMuc2V0U3RhdGUoXCJwb3N0LWJvZHlcIilcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIHN0YXR1cyBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGluZSAtIExpbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHBhcnNlU3RhdHVzTGluZShsaW5lKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFtBLVotXSspICguKz8pIEhUVFBcXC8oLispXFxyXFxuLylcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgbWF0Y2ggc3RhdHVzIGxpbmUgZnJvbTogJHtsaW5lfWApXG4gICAgfVxuXG4gICAgdGhpcy5odHRwTWV0aG9kID0gbWF0Y2hbMV1cbiAgICB0aGlzLmh0dHBWZXJzaW9uID0gbWF0Y2hbM11cbiAgICB0aGlzLnBhdGggPSBtYXRjaFsyXVxuICAgIHRoaXMuc2V0U3RhdGUoXCJoZWFkZXJzXCIpXG4gICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBbXCJQYXJzZWQgc3RhdHVzIGxpbmVcIiwge2h0dHBNZXRob2Q6IHRoaXMuaHR0cE1ldGhvZCwgaHR0cFZlcnNpb246IHRoaXMuaHR0cFZlcnNpb24sIHBhdGg6IHRoaXMucGF0aH1dKVxuICB9XG5cbiAgcG9zdFJlcXVlc3REb25lKCkge1xuICAgIGlmICh0aGlzLnBvc3RCb2R5QnVmZmVycykge1xuICAgICAgdGhpcy5wb3N0Qm9keSA9IEJ1ZmZlci5jb25jYXQodGhpcy5wb3N0Qm9keUJ1ZmZlcnMpLnRvU3RyaW5nKFwidXRmOFwiKVxuICAgIH1cblxuICAgIHRoaXMucG9zdEJvZHlCdWZmZXJzID0gdW5kZWZpbmVkXG5cbiAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBlY3RzIHJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGh0dHBNZXRob2QgLSBIVFRQIG1ldGhvZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCBleHBlY3RzIGEgYm9keS5cbiAgICovXG4gIGV4cGVjdHNSZXF1ZXN0Qm9keShodHRwTWV0aG9kKSB7XG4gICAgcmV0dXJuICFbXCJHRVRcIiwgXCJPUFRJT05TXCIsIFwiSEVBRFwiXS5pbmNsdWRlcyhodHRwTWV0aG9kKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgY2h1bmtlZCBlbmNvZGluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCB1c2VzIGNodW5rZWQgdHJhbnNmZXIgZW5jb2RpbmcuXG4gICAqL1xuICBpc0NodW5rZWRFbmNvZGluZygpIHtcbiAgICBjb25zdCB0cmFuc2ZlckVuY29kaW5nID0gdGhpcy5nZXRIZWFkZXIoXCJ0cmFuc2Zlci1lbmNvZGluZ1wiKT8udmFsdWU/LnRvTG93ZXJDYXNlKClcblxuICAgIHJldHVybiBCb29sZWFuKHRyYW5zZmVyRW5jb2Rpbmc/LmluY2x1ZGVzKFwiY2h1bmtlZFwiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgY2h1bmtlZCBib2R5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBpbml0aWFsaXplQ2h1bmtlZEJvZHkoKSB7XG4gICAgdGhpcy5jaHVua2VkQm9keUNoYXJzID0gW11cbiAgICB0aGlzLmN1cnJlbnRDaHVua1NpemUgPSB1bmRlZmluZWRcbiAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IDBcbiAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1zaXplXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBjaHVuayBzaXplIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gQ2h1bmsgc2l6ZSBsaW5lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwYXJzZUNodW5rU2l6ZUxpbmUobGluZSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKVxuXG4gICAgaWYgKCF0cmltbWVkKSByZXR1cm5cblxuICAgIGNvbnN0IHNpemVUb2tlbiA9IHRyaW1tZWQuc3BsaXQoXCI7XCIpWzBdPy50cmltKClcblxuICAgIGlmICghc2l6ZVRva2VuKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY2h1bmsgc2l6ZSBsaW5lOiAke2xpbmV9YClcblxuICAgIGNvbnN0IHNpemUgPSBOdW1iZXIucGFyc2VJbnQoc2l6ZVRva2VuLCAxNilcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHNpemUpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY2h1bmsgc2l6ZTogJHtzaXplVG9rZW59YClcblxuICAgIGlmIChzaXplID09PSAwKSB7XG4gICAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC10cmFpbGVyXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmN1cnJlbnRDaHVua1NpemUgPSBzaXplXG4gICAgdGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSAwXG4gICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtZGF0YVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluaXNoIGNodW5rZWQgYm9keS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZmluaXNoQ2h1bmtlZEJvZHkoKSB7XG4gICAgaWYgKHRoaXMuY2h1bmtlZEJvZHlDaGFycykge1xuICAgICAgdGhpcy5wb3N0Qm9keSA9IEJ1ZmZlci5mcm9tKHRoaXMuY2h1bmtlZEJvZHlDaGFycykudG9TdHJpbmcoXCJ1dGY4XCIpXG4gICAgfVxuXG4gICAgZGVsZXRlIHRoaXMuY2h1bmtlZEJvZHlDaGFyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHN0YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3U3RhdGUgLSBOZXcgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFN0YXRlKG5ld1N0YXRlKSB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBgQ2hhbmdpbmcgc3RhdGUgZnJvbSAke3RoaXMuc3RhdGV9IHRvICR7bmV3U3RhdGV9YClcbiAgICB0aGlzLnN0YXRlID0gbmV3U3RhdGVcbiAgfVxuXG4gIGNvbXBsZXRlUmVxdWVzdCA9ICgpID0+IHtcbiAgICB0aGlzLnN0YXRlID0gXCJzdGF0dXNcIiAvLyBSZXNldCBzdGF0ZSB0byBuZXcgcmVxdWVzdFxuICAgIHRoaXMuY29tcGxldGVkID0gdHJ1ZVxuXG4gICAgaWYgKHRoaXMuZ2V0SGVhZGVyKFwiY29udGVudC10eXBlXCIpPy52YWx1ZT8uc3RhcnRzV2l0aChcImFwcGxpY2F0aW9uL2pzb25cIikpIHtcbiAgICAgIHRoaXMucGFyc2VBcHBsaWNhdGlvbkpzb25QYXJhbXMoKVxuICAgIH0gZWxzZSBpZiAodGhpcy5tdWx0aVBhcnR5Rm9ybURhdGEpIHtcbiAgICAgIC8vIERvbmUgYWZ0ZXIgZWFjaCBuZXcgZm9ybSBkYXRhIHBhcnRcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wYXJzZVF1ZXJ5U3RyaW5nUG9zdFBhcmFtcygpXG4gICAgfVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNvbXBsZXRlZFwiKVxuICB9XG5cbiAgcGFyc2VBcHBsaWNhdGlvbkpzb25QYXJhbXMoKSB7XG4gICAgaWYgKHRoaXMucG9zdEJvZHkpIHtcbiAgICAgIGNvbnN0IG5ld1BhcmFtcyA9IEpTT04ucGFyc2UodGhpcy5wb3N0Qm9keSlcblxuICAgICAgaW5jb3Jwb3JhdGUodGhpcy5wYXJhbXMsIG5ld1BhcmFtcylcbiAgICB9XG4gIH1cblxuICBwYXJzZVF1ZXJ5U3RyaW5nUG9zdFBhcmFtcygpIHtcbiAgICBpZiAodGhpcy5wb3N0Qm9keSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkUXVlcnkgPSBxdWVyeXN0cmluZy5wYXJzZSh0aGlzLnBvc3RCb2R5KVxuICAgICAgICAvKipcbiAgICAgICAgICogVW5wYXJzZWQgcGFyYW1zLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAqL1xuICAgICAgICBjb25zdCB1bnBhcnNlZFBhcmFtcyA9IHt9XG5cbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGFyc2VkUXVlcnkpKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgdW5wYXJzZWRQYXJhbXNba2V5XSA9IHZhbHVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGFyYW1zVG9PYmplY3QgPSBuZXcgUGFyYW1zVG9PYmplY3QodW5wYXJzZWRQYXJhbXMpXG4gICAgICAgIGNvbnN0IG5ld1BhcmFtcyA9IHBhcmFtc1RvT2JqZWN0LnRvT2JqZWN0KClcblxuICAgICAgICBpbmNvcnBvcmF0ZSh0aGlzLnBhcmFtcywgbmV3UGFyYW1zKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZW5zdXJlZEVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKGVycm9yKVxuXG4gICAgICAgIGVuc3VyZWRFcnJvci52ZWxvY2lvdXNDb250ZXh0ID0ge1xuICAgICAgICAgIC4uLihlbnN1cmVkRXJyb3IudmVsb2Npb3VzQ29udGV4dCB8fCB7fSksXG4gICAgICAgICAgcmVxdWVzdFBhcnNpbmc6IHtcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiB0aGlzLmdldEhlYWRlcihcImNvbnRlbnQtdHlwZVwiKT8udmFsdWUsXG4gICAgICAgICAgICBodHRwTWV0aG9kOiB0aGlzLmh0dHBNZXRob2QsXG4gICAgICAgICAgICBwYXJhbWV0ZXJLZXlzOiBPYmplY3Qua2V5cyhxdWVyeXN0cmluZy5wYXJzZSh0aGlzLnBvc3RCb2R5KSksXG4gICAgICAgICAgICBwYXRoOiB0aGlzLnBhdGgsXG4gICAgICAgICAgICBwb3N0Qm9keVByZXZpZXc6IHRydW5jYXRlUHJldmlldyh0aGlzLnBvc3RCb2R5KSxcbiAgICAgICAgICAgIHN0YWdlOiBcInF1ZXJ5LXN0cmluZy1wb3N0LXBhcmFtc1wiXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgZW5zdXJlZEVycm9yXG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=