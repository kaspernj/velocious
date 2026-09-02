// @ts-check
import EventEmitter from "../../../utils/event-emitter.js";
import FormDataPart from "./form-data-part.js";
import Header from "./header.js";
import { incorporate } from "incorporator";
import Logger from "../../../logger.js";
import ParamsToObject from "../params-to-object.js";
import querystring from "querystring";
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
        this.headersByName[formattedName] = header;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtYnVmZmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSxpQ0FBaUMsQ0FBQTtBQUMxRCxPQUFPLFlBQVksTUFBTSxxQkFBcUIsQ0FBQTtBQUM5QyxPQUFPLE1BQU0sTUFBTSxhQUFhLENBQUE7QUFDaEMsT0FBTyxFQUFDLFdBQVcsRUFBQyxNQUFNLGNBQWMsQ0FBQTtBQUN4QyxPQUFPLE1BQU0sTUFBTSxvQkFBb0IsQ0FBQTtBQUN2QyxPQUFPLGNBQWMsTUFBTSx3QkFBd0IsQ0FBQTtBQUNuRCxPQUFPLFdBQVcsTUFBTSxhQUFhLENBQUE7QUFFckM7Ozs7O0dBS0c7QUFDSCxTQUFTLGVBQWUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxHQUFHLEdBQUc7SUFDekMsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsT0FBTyxTQUFTLENBQUE7SUFDL0MsSUFBSSxLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUs7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUV2QyxPQUFPLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQTtBQUN0QyxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDLFVBQVUsR0FBRyxDQUFDLENBQUE7SUFFZCxtQ0FBbUM7SUFDbkMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtJQUUzQjs7MEJBRXNCO0lBQ3RCLElBQUksR0FBRyxFQUFFLENBQUE7SUFFVCxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUUzQjs7d0NBRW9DO0lBQ3BDLGFBQWEsR0FBRyxFQUFFLENBQUE7SUFDbEI7O3NDQUVrQztJQUNsQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7SUFFNUIsa0JBQWtCLEdB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O29CQUN4QyxjQUFjLEVBQUU7d0JBQ2QsV0FBVyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLEVBQUUsS0FBSzt3QkFDbEQsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO3dCQUMzQixhQUFhLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQzt3QkFDNUQsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO3dCQUNmLGVBQWUsRUFBRSxlQUFlLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQzt3QkFDL0MsS0FBSyxFQUFFLDBCQUEwQjtxQkFDbEM7aUJBQ0YsQ0FBQTtnQkFFRCxNQUFNLFlBQVksQ0FBQTtZQUNwQixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuLi8uLi8uLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCBGb3JtRGF0YVBhcnQgZnJvbSBcIi4vZm9ybS1kYXRhLXBhcnQuanNcIlxuaW1wb3J0IEhlYWRlciBmcm9tIFwiLi9oZWFkZXIuanNcIlxuaW1wb3J0IHtpbmNvcnBvcmF0ZX0gZnJvbSBcImluY29ycG9yYXRvclwiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IFBhcmFtc1RvT2JqZWN0IGZyb20gXCIuLi9wYXJhbXMtdG8tb2JqZWN0LmpzXCJcbmltcG9ydCBxdWVyeXN0cmluZyBmcm9tIFwicXVlcnlzdHJpbmdcIlxuXG4vKipcbiAqIFJ1bnMgdHJ1bmNhdGUgcHJldmlldy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBpbnB1dCAtIElucHV0IHN0cmluZy5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbbGltaXRdIC0gTWF4IHByZXZpZXcgbGVuZ3RoLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUcnVuY2F0ZWQgcHJldmlldy5cbiAqL1xuZnVuY3Rpb24gdHJ1bmNhdGVQcmV2aWV3KGlucHV0LCBsaW1pdCA9IDMwMCkge1xuICBpZiAodHlwZW9mIGlucHV0ICE9PSBcInN0cmluZ1wiKSByZXR1cm4gdW5kZWZpbmVkXG4gIGlmIChpbnB1dC5sZW5ndGggPD0gbGltaXQpIHJldHVybiBpbnB1dFxuXG4gIHJldHVybiBgJHtpbnB1dC5zbGljZSgwLCBsaW1pdCl9Li4uYFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBSZXF1ZXN0QnVmZmVyIHtcbiAgYm9keUxlbmd0aCA9IDBcblxuICAvKiogQHR5cGUge0J1ZmZlcltdIHwgdW5kZWZpbmVkfSAqL1xuICBwb3N0Qm9keUJ1ZmZlcnMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGF0YS5cbiAgICogQHR5cGUge251bWJlcltdfSAqL1xuICBkYXRhID0gW11cblxuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICAvKipcbiAgICogSGVhZGVycyBieSBuYW1lLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgSGVhZGVyPn0gKi9cbiAgaGVhZGVyc0J5TmFtZSA9IHt9XG4gIC8qKlxuICAgKiBDaHVua2VkIGJvZHkgY2hhcnMuXG4gICAqIEB0eXBlIHtudW1iZXJbXSB8IHVuZGVmaW5lZH0gKi9cbiAgY2h1bmtlZEJvZHlDaGFycyA9IHVuZGVmaW5lZFxuXG4gIG11bHRpUGFydHlGb3JtRGF0YSA9IGZhbHNlXG5cbiAgY29tcGxldGVkID0gZmFsc2VcbiAgcGFyYW1zID0ge31cbiAgcmVhZGluZ0JvZHkgPSBmYWxzZVxuICBzdGF0ZSA9IFwic3RhdHVzXCJcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMsIHtkZWJ1ZzogZmFsc2V9KVxuICB9XG5cbiAgZGVzdHJveSgpIHtcbiAgICAvLyBEbyBub3RoaW5nIGZvciBub3cuLi5cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZlZWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7QnVmZmVyIHwgdW5kZWZpbmVkfSAtIFJlbWFpbmluZyBkYXRhLCBpZiBhbnkuXG4gICAqL1xuICBmZWVkKGRhdGEpIHtcbiAgICBsZXQgaW5kZXggPSAwXG5cbiAgICB3aGlsZSAoaW5kZXggPCBkYXRhLmxlbmd0aCkge1xuICAgICAgc3dpdGNoKHRoaXMuc3RhdGUpIHtcbiAgICAgICAgY2FzZSBcInN0YXR1c1wiOlxuICAgICAgICBjYXNlIFwiaGVhZGVyc1wiOlxuICAgICAgICBjYXNlIFwibXVsdGktcGFydC1mb3JtLWRhdGFcIjpcbiAgICAgICAgY2FzZSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWhlYWRlclwiOlxuICAgICAgICBjYXNlIFwiY2h1bmtlZC1zaXplXCI6XG4gICAgICAgIGNhc2UgXCJjaHVua2VkLXRyYWlsZXJcIjpcbiAgICAgICAgICBpbmRleCA9IHRoaXMuZmVlZExpbmUoZGF0YSwgaW5kZXgpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSBcInBvc3QtYm9keVwiOlxuICAgICAgICAgIGluZGV4ID0gdGhpcy5mZWVkUG9zdEJvZHkoZGF0YSwgaW5kZXgpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBpbmRleCA9IHRoaXMuZmVlZEJ5dGUoZGF0YSwgaW5kZXgpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmNvbXBsZXRlZCkge1xuICAgICAgICByZXR1cm4gZGF0YS5zdWJhcnJheShpbmRleClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgYnl0ZXMgZm9yIHRoZSBsaW5lLWJhc2VkIHN0YXRlcyB1cCB0byBhbmQgaW5jbHVkaW5nIHRoZSBuZXh0IG5ld2xpbmUuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBSZWFkIHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5ldyByZWFkIHBvc2l0aW9uLlxuICAgKi9cbiAgZmVlZExpbmUoZGF0YSwgaW5kZXgpIHtcbiAgICBjb25zdCBuZXdsaW5lSW5kZXggPSBkYXRhLmluZGV4T2YoMTAsIGluZGV4KVxuXG4gICAgaWYgKG5ld2xpbmVJbmRleCA9PT0gLTEpIHtcbiAgICAgIGlmICh0aGlzLnJlYWRpbmdCb2R5KSB0aGlzLmJvZHlMZW5ndGggKz0gZGF0YS5sZW5ndGggLSBpbmRleFxuXG4gICAgICBmb3IgKGxldCBkYXRhSW5kZXggPSBpbmRleDsgZGF0YUluZGV4IDwgZGF0YS5sZW5ndGg7IGRhdGFJbmRleCArPSAxKSB7XG4gICAgICAgIHRoaXMuZGF0YS5wdXNoKGRhdGFbZGF0YUluZGV4XSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRhdGEubGVuZ3RoXG4gICAgfVxuXG4gICAgaWYgKHRoaXMucmVhZGluZ0JvZHkpIHRoaXMuYm9keUxlbmd0aCArPSBuZXdsaW5lSW5kZXggKyAxIC0gaW5kZXhcblxuICAgIGxldCBsaW5lXG5cbiAgICBpZiAodGhpcy5kYXRhLmxlbmd0aCA9PSAwKSB7XG4gICAgICBsaW5lID0gZGF0YS50b1N0cmluZyhcImxhdGluMVwiLCBpbmRleCwgbmV3bGluZUluZGV4ICsgMSlcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVGhlIHJlc3Qgb2YgYSBsaW5lIHRoYXQgc3RhcnRlZCBpbiBhIHByZXZpb3VzIGNodW5rLlxuICAgICAgZm9yIChsZXQgZGF0YUluZGV4ID0gaW5kZXg7IGRhdGFJbmRleCA8PSBuZXdsaW5lSW5kZXg7IGRhdGFJbmRleCArPSAxKSB7XG4gICAgICAgIHRoaXMuZGF0YS5wdXNoKGRhdGFbZGF0YUluZGV4XSlcbiAgICAgIH1cblxuICAgICAgbGluZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgdGhpcy5kYXRhKVxuICAgICAgdGhpcy5kYXRhID0gW11cbiAgICB9XG5cbiAgICB0aGlzLnBhcnNlKGxpbmUpXG5cbiAgICByZXR1cm4gbmV3bGluZUluZGV4ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIGZpeGVkLWxlbmd0aCByZXF1ZXN0IGJvZHkgYnl0ZXMgaW4gYnVsay5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFJlYWQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTmV3IHJlYWQgcG9zaXRpb24uXG4gICAqL1xuICBmZWVkUG9zdEJvZHkoZGF0YSwgaW5kZXgpIHtcbiAgICBpZiAoIXRoaXMucG9zdEJvZHlCdWZmZXJzKSB0aHJvdyBuZXcgRXJyb3IoXCJwb3N0Qm9keUJ1ZmZlcnMgbm90IGluaXRpYWxpemVkXCIpXG4gICAgaWYgKHRoaXMuY29udGVudExlbmd0aCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJDb250ZW50IGxlbmd0aCBub3Qgc2V0XCIpXG5cbiAgICBjb25zdCByZW1haW5pbmdCb2R5Qnl0ZXMgPSBNYXRoLm1heCgxLCB0aGlzLmNvbnRlbnRMZW5ndGggLSB0aGlzLmJvZHlMZW5ndGgpXG4gICAgY29uc3QgZW5kSW5kZXggPSBNYXRoLm1pbihkYXRhLmxlbmd0aCwgaW5kZXggKyByZW1haW5pbmdCb2R5Qnl0ZXMpXG5cbiAgICB0aGlzLnBvc3RCb2R5QnVmZmVycy5wdXNoKGRhdGEuc3ViYXJyYXkoaW5kZXgsIGVuZEluZGV4KSlcbiAgICB0aGlzLmJvZHlMZW5ndGggKz0gZW5kSW5kZXggLSBpbmRleFxuXG4gICAgaWYgKHRoaXMuY29udGVudExlbmd0aCAmJiB0aGlzLmJvZHlMZW5ndGggPj0gdGhpcy5jb250ZW50TGVuZ3RoKSB7XG4gICAgICB0aGlzLnBvc3RSZXF1ZXN0RG9uZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGVuZEluZGV4XG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgYSBzaW5nbGUgYnl0ZSBmb3IgdGhlIGJ5dGUtYmFzZWQgcGFyc2VyIHN0YXRlcy5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFJlYWQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTmV3IHJlYWQgcG9zaXRpb24uXG4gICAqL1xuICBmZWVkQnl0ZShkYXRhLCBpbmRleCkge1xuICAgIGNvbnN0IGNoYXIgPSBkYXRhW2luZGV4XVxuXG4gICAgaWYgKHRoaXMucmVhZGluZ0JvZHkpIHRoaXMuYm9keUxlbmd0aCArPSAxXG5cbiAgICBzd2l0Y2godGhpcy5zdGF0ZSkge1xuICAgICAgY2FzZSBcImNodW5rZWQtZGF0YVwiOiB7XG4gICAgICAgIGNvbnN0IGNodW5rZWRCb2R5Q2hhcnMgPSB0aGlzLmNodW5rZWRCb2R5Q2hhcnNcblxuICAgICAgICBpZiAodGhpcy5jdXJyZW50Q2h1bmtTaXplID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkNodW5rIHNpemUgbm90IGluaXRpYWxpemVkXCIpXG4gICAgICAgIGlmICghY2h1bmtlZEJvZHlDaGFycykgdGhyb3cgbmV3IEVycm9yKFwiQ2h1bmtlZCBib2R5IG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgICAgIGNodW5rZWRCb2R5Q2hhcnMucHVzaChjaGFyKVxuICAgICAgICAvKipcbiAgICAgICAgICogQ3VycmVudCBjaHVuayBieXRlcyByZWFkLlxuICAgICAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgICAgICBjb25zdCBjdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSAodGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgfHwgMCkgKyAxXG5cbiAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSBjdXJyZW50Q2h1bmtCeXRlc1JlYWRcblxuICAgICAgICBpZiAoY3VycmVudENodW5rQnl0ZXNSZWFkID49IHRoaXMuY3VycmVudENodW5rU2l6ZSkge1xuICAgICAgICAgIHRoaXMuY3VycmVudENodW5rQ3JsZlJlYWQgPSAwXG4gICAgICAgICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtZGF0YS1jcmxmXCIpXG4gICAgICAgIH1cblxuICAgICAgICBicmVha1xuICAgICAgfVxuICAgICAgY2FzZSBcImNodW5rZWQtZGF0YS1jcmxmXCI6XG4gICAgICAgIHRoaXMuY3VycmVudENodW5rQ3JsZlJlYWQgPSAodGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCB8fCAwKSArIDFcblxuICAgICAgICBpZiAodGhpcy5jdXJyZW50Q2h1bmtDcmxmUmVhZCA+PSAyKSB7XG4gICAgICAgICAgdGhpcy5jdXJyZW50Q2h1bmtCeXRlc1JlYWQgPSAwXG4gICAgICAgICAgdGhpcy5zZXRTdGF0ZShcImNodW5rZWQtc2l6ZVwiKVxuICAgICAgICB9XG5cbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1ib2R5XCI6IHtcbiAgICAgICAgaWYgKCF0aGlzLmZvcm1EYXRhUGFydCkgdGhyb3cgbmV3IEVycm9yKFwiRm9ybURhdGEgcGFydCBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICAgICAgaWYgKCF0aGlzLmJvdW5kYXJ5TGluZUVuZCkgdGhyb3cgbmV3IEVycm9yKFwiQm91bmRhcnkgbGluZSBlbmQgbm90IGluaXRpYWxpemVkXCIpXG4gICAgICAgIGlmICghdGhpcy5ib3VuZGFyeUxpbmVOZXh0KSB0aHJvdyBuZXcgRXJyb3IoXCJCb3VuZGFyeSBsaW5lIG5leHQgbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICAgICAgY29uc3QgYm9keSA9IHRoaXMuZm9ybURhdGFQYXJ0LmJvZHlcblxuICAgICAgICBib2R5LnB1c2goY2hhcilcblxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5RW5kUG9zaXRpb24gPSBib2R5Lmxlbmd0aCAtIHRoaXMuYm91bmRhcnlMaW5lRW5kLmxlbmd0aFxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5RW5kQ2hhcnMgPSBib2R5LnNsaWNlKHBvc3NpYmxlQm91bmRhcnlFbmRQb3NpdGlvbiwgYm9keS5sZW5ndGgpXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlFbmQgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIHBvc3NpYmxlQm91bmRhcnlFbmRDaGFycylcblxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5TmV4dFBvc2l0aW9uID0gYm9keS5sZW5ndGggLSB0aGlzLmJvdW5kYXJ5TGluZU5leHQubGVuZ3RoXG4gICAgICAgIGNvbnN0IHBvc3NpYmxlQm91bmRhcnlOZXh0Q2hhcnMgPSBib2R5LnNsaWNlKHBvc3NpYmxlQm91bmRhcnlOZXh0UG9zaXRpb24sIGJvZHkubGVuZ3RoKVxuICAgICAgICBjb25zdCBwb3NzaWJsZUJvdW5kYXJ5TmV4dCA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgcG9zc2libGVCb3VuZGFyeU5leHRDaGFycylcblxuICAgICAgICBpZiAocG9zc2libGVCb3VuZGFyeUVuZCA9PSB0aGlzLmJvdW5kYXJ5TGluZUVuZCkge1xuICAgICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0LnJlbW92ZUZyb21Cb2R5KHBvc3NpYmxlQm91bmRhcnlFbmQpXG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnREb25lKClcbiAgICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICAgIH0gZWxzZSBpZiAocG9zc2libGVCb3VuZGFyeU5leHQgPT0gdGhpcy5ib3VuZGFyeUxpbmVOZXh0KSB7XG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnQucmVtb3ZlRnJvbUJvZHkocG9zc2libGVCb3VuZGFyeU5leHQpXG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnREb25lKClcbiAgICAgICAgICB0aGlzLm5ld0Zvcm1EYXRhUGFydCgpXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5jb250ZW50TGVuZ3RoICYmIHRoaXMuYm9keUxlbmd0aCA+PSB0aGlzLmNvbnRlbnRMZW5ndGgpIHtcbiAgICAgICAgICB0aGlzLmZvcm1EYXRhUGFydERvbmUoKVxuICAgICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmZvcm1EYXRhUGFydC5jb250ZW50TGVuZ3RoICYmIHRoaXMuYm9keUxlbmd0aCA+PSB0aGlzLmZvcm1EYXRhUGFydC5jb250ZW50TGVuZ3RoKSB7XG4gICAgICAgICAgdGhpcy5mb3JtRGF0YVBhcnREb25lKClcblxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInN0dWJcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYFVua25vd24gc3RhdGUgZm9yIHJlcXVlc3QgYnVmZmVyYCwge3N0YXRlOiB0aGlzLnN0YXRlfV0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGluZGV4ICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7SGVhZGVyfSAtIFRoZSBoZWFkZXIuXG4gICAqL1xuICBnZXRIZWFkZXIobmFtZSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuaGVhZGVyc0J5TmFtZVtuYW1lLnRvTG93ZXJDYXNlKCkudHJpbSgpXVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWdMb3dMZXZlbCgoKSA9PiBbYGdldEhlYWRlciAke25hbWV9YCwge3Jlc3VsdDogcmVzdWx0Py50b1N0cmluZygpfV0pXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaGVhZGVycyBoYXNoLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBUaGUgaGVhZGVycyBoYXNoLlxuICAgKi9cbiAgZ2V0SGVhZGVyc0hhc2goKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlckZvcm1hdHRlZE5hbWUgaW4gdGhpcy5oZWFkZXJzQnlOYW1lKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSB0aGlzLmhlYWRlcnNCeU5hbWVbaGVhZGVyRm9ybWF0dGVkTmFtZV1cblxuICAgICAgcmVzdWx0W2hlYWRlci5nZXROYW1lKCldID0gaGVhZGVyLmdldFZhbHVlKClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtIGRhdGEgcGFydCBkb25lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBmb3JtRGF0YVBhcnREb25lKCkge1xuICAgIGNvbnN0IGZvcm1EYXRhUGFydCA9IHRoaXMuZm9ybURhdGFQYXJ0XG5cbiAgICBpZiAoIWZvcm1EYXRhUGFydCkgdGhyb3cgbmV3IEVycm9yKFwiZm9ybURhdGFQYXJ0IHdhc250IHNldFwiKVxuXG4gICAgdGhpcy5mb3JtRGF0YVBhcnQgPSB1bmRlZmluZWRcbiAgICBmb3JtRGF0YVBhcnQuZmluaXNoKClcblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJmb3JtLWRhdGEtcGFydFwiLCBmb3JtRGF0YVBhcnQpXG4gIH1cblxuICBpc011bHRpUGFydHlGb3JtRGF0YSgpIHtcbiAgICByZXR1cm4gdGhpcy5tdWx0aVBhcnR5Rm9ybURhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5ldyBmb3JtIGRhdGEgcGFydC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbmV3Rm9ybURhdGFQYXJ0KCkge1xuICAgIHRoaXMuZm9ybURhdGFQYXJ0ID0gbmV3IEZvcm1EYXRhUGFydCgpXG4gICAgdGhpcy5zZXRTdGF0ZShcIm11bHRpLXBhcnQtZm9ybS1kYXRhLWhlYWRlclwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gTGluZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcGFyc2UobGluZSkge1xuICAgIGlmICh0aGlzLnN0YXRlID09IFwic3RhdHVzXCIpIHtcbiAgICAgIHRoaXMucGFyc2VTdGF0dXNMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwiaGVhZGVyc1wiKSB7XG4gICAgICB0aGlzLnBhcnNlSGVhZGVyKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwiY2h1bmtlZC1zaXplXCIpIHtcbiAgICAgIHRoaXMucGFyc2VDaHVua1NpemVMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09IFwiY2h1bmtlZC10cmFpbGVyXCIpIHtcbiAgICAgIGlmIChsaW5lID09IFwiXFxyXFxuXCIpIHtcbiAgICAgICAgdGhpcy5maW5pc2hDaHVua2VkQm9keSgpXG4gICAgICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YVwiKSB7XG4gICAgICBpZiAobGluZSA9PSB0aGlzLmJvdW5kYXJ5TGluZSkge1xuICAgICAgICB0aGlzLm5ld0Zvcm1EYXRhUGFydCgpXG4gICAgICB9IGVsc2UgaWYgKGxpbmUgPT0gXCJcXHJcXG5cIikge1xuICAgICAgICB0aGlzLnNldFN0YXRlKFwiZG9uZVwiKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBib3VuZGFyeSBsaW5lIGJ1dCBkaWRuJ3QgZ2V0IGl0OiAke2xpbmV9YClcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT0gXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1oZWFkZXJcIikge1xuICAgICAgY29uc3QgaGVhZGVyID0gdGhpcy5yZWFkSGVhZGVyRnJvbUxpbmUobGluZSlcblxuICAgICAgaWYgKGhlYWRlcikge1xuICAgICAgICBpZiAoIXRoaXMuZm9ybURhdGFQYXJ0KSB0aHJvdyBuZXcgRXJyb3IoXCJmb3JtRGF0YVBhcnQgbm90IHNldFwiKVxuXG4gICAgICAgIHRoaXMuZm9ybURhdGFQYXJ0LmFkZEhlYWRlcihoZWFkZXIpXG4gICAgICAgIC8vdGhpcy5zdGF0ZSA9PSBcIm11bHRpLXBhcnQtZm9ybS1kYXRhXCJcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PSBcIlxcclxcblwiKSB7XG4gICAgICAgIHRoaXMuc2V0U3RhdGUoXCJtdWx0aS1wYXJ0LWZvcm0tZGF0YS1ib2R5XCIpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBzdGF0ZSBwYXJzaW5nIGxpbmU6ICR7dGhpcy5zdGF0ZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgaGVhZGVyIGZyb20gbGluZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBMaW5lLlxuICAgKiBAcmV0dXJucyB7SGVhZGVyIHwgdW5kZWZpbmVkfSAtIFRoZSBoZWFkZXIgZnJvbSBsaW5lLlxuICAgKi9cbiAgcmVhZEhlYWRlckZyb21MaW5lKGxpbmUpIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oLispOiAoLispXFxyXFxuLylcblxuICAgIGlmIChtYXRjaCkge1xuICAgICAgY29uc3QgaGVhZGVyID0gbmV3IEhlYWRlcihtYXRjaFsxXSwgbWF0Y2hbMl0pXG5cbiAgICAgIHJldHVybiBoZWFkZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge0hlYWRlcn0gaGVhZGVyIC0gSGVhZGVyIHZhbHVlLlxuICAgKi9cbiAgYWRkSGVhZGVyKGhlYWRlcikge1xuICAgIGNvbnN0IGZvcm1hdHRlZE5hbWUgPSBoZWFkZXIuZ2V0Rm9ybWF0dGVkTmFtZSgpXG5cbiAgICB0aGlzLmhlYWRlcnNCeU5hbWVbZm9ybWF0dGVkTmFtZV0gPSBoZWFkZXJcblxuICAgIGlmIChmb3JtYXR0ZWROYW1lID09IFwiY29udGVudC1sZW5ndGhcIikgdGhpcy5jb250ZW50TGVuZ3RoID0gcGFyc2VJbnQoaGVhZGVyLmdldFZhbHVlKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gTGluZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcGFyc2VIZWFkZXIobGluZSkge1xuICAgIGNvbnN0IGhlYWRlciA9IHRoaXMucmVhZEhlYWRlckZyb21MaW5lKGxpbmUpXG5cbiAgICBpZiAoaGVhZGVyKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBQYXJzZWQgaGVhZGVyOiAke2hlYWRlci50b1N0cmluZygpfWApXG4gICAgICB0aGlzLmFkZEhlYWRlcihoZWFkZXIpXG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwiaGVhZGVyXCIsIGhlYWRlcilcbiAgICB9IGVsc2UgaWYgKGxpbmUgPT0gXCJcXHJcXG5cIikge1xuICAgICAgY29uc3QgaHR0cE1ldGhvZCA9IHRoaXMuaHR0cE1ldGhvZD8udG9VcHBlckNhc2UoKVxuXG4gICAgICBpZiAoIWh0dHBNZXRob2QpIHRocm93IG5ldyBFcnJvcihcIkhUVFAgbWV0aG9kIG5vdCBzZXRcIilcblxuICAgICAgaWYgKCF0aGlzLmV4cGVjdHNSZXF1ZXN0Qm9keShodHRwTWV0aG9kKSkge1xuICAgICAgICB0aGlzLmNvbXBsZXRlUmVxdWVzdCgpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuaXNDaHVua2VkRW5jb2RpbmcoKSkge1xuICAgICAgICB0aGlzLnJlYWRpbmdCb2R5ID0gdHJ1ZVxuICAgICAgICB0aGlzLmJvZHlMZW5ndGggPSAwXG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZUNodW5rZWRCb2R5KClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVhZGluZ0JvZHkgPSB0cnVlXG4gICAgICAgIHRoaXMuYm9keUxlbmd0aCA9IDBcblxuICAgICAgICBjb25zdCBtYXRjaCA9IHRoaXMuZ2V0SGVhZGVyKFwiY29udGVudC10eXBlXCIpPy52YWx1ZT8ubWF0Y2goL15tdWx0aXBhcnRcXC9mb3JtLWRhdGE7XFxzKmJvdW5kYXJ5PSguKykkL2kpXG5cbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgdGhpcy5ib3VuZGFyeSA9IG1hdGNoWzFdXG4gICAgICAgICAgdGhpcy5ib3VuZGFyeUxpbmUgPSBgLS0ke3RoaXMuYm91bmRhcnl9XFxyXFxuYFxuICAgICAgICAgIHRoaXMuYm91bmRhcnlMaW5lTmV4dCA9IGBcXHJcXG4tLSR7dGhpcy5ib3VuZGFyeX1cXHJcXG5gXG4gICAgICAgICAgdGhpcy5ib3VuZGFyeUxpbmVFbmQgPSBgXFxyXFxuLS0ke3RoaXMuYm91bmRhcnl9LS1gXG4gICAgICAgICAgdGhpcy5tdWx0aVBhcnR5Rm9ybURhdGEgPSB0cnVlXG4gICAgICAgICAgdGhpcy5zZXRTdGF0ZShcIm11bHRpLXBhcnQtZm9ybS1kYXRhXCIpXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5jb250ZW50TGVuZ3RoID09PSAwIHx8IHRoaXMuY29udGVudExlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5jb21wbGV0ZVJlcXVlc3QoKVxuICAgICAgICB9IGVsc2UgaWYgKE51bWJlci5pc05hTih0aGlzLmNvbnRlbnRMZW5ndGgpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGVudCBsZW5ndGggaXMgaW52YWxpZFwiKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8qKlxuICAgICAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAgICAgKiBAdHlwZSB7QnVmZmVyW119ICovXG4gICAgICAgICAgdGhpcy5wb3N0Qm9keUJ1ZmZlcnMgPSBbXVxuXG4gICAgICAgICAgdGhpcy5zZXRTdGF0ZShcInBvc3QtYm9keVwiKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2Ugc3RhdHVzIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5lIC0gTGluZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcGFyc2VTdGF0dXNMaW5lKGxpbmUpIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oW0EtWi1dKykgKC4rPykgSFRUUFxcLyguKylcXHJcXG4vKVxuXG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBtYXRjaCBzdGF0dXMgbGluZSBmcm9tOiAke2xpbmV9YClcbiAgICB9XG5cbiAgICB0aGlzLmh0dHBNZXRob2QgPSBtYXRjaFsxXVxuICAgIHRoaXMuaHR0cFZlcnNpb24gPSBtYXRjaFszXVxuICAgIHRoaXMucGF0aCA9IG1hdGNoWzJdXG4gICAgdGhpcy5zZXRTdGF0ZShcImhlYWRlcnNcIilcbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IFtcIlBhcnNlZCBzdGF0dXMgbGluZVwiLCB7aHR0cE1ldGhvZDogdGhpcy5odHRwTWV0aG9kLCBodHRwVmVyc2lvbjogdGhpcy5odHRwVmVyc2lvbiwgcGF0aDogdGhpcy5wYXRofV0pXG4gIH1cblxuICBwb3N0UmVxdWVzdERvbmUoKSB7XG4gICAgaWYgKHRoaXMucG9zdEJvZHlCdWZmZXJzKSB7XG4gICAgICB0aGlzLnBvc3RCb2R5ID0gQnVmZmVyLmNvbmNhdCh0aGlzLnBvc3RCb2R5QnVmZmVycykudG9TdHJpbmcoXCJ1dGY4XCIpXG4gICAgfVxuXG4gICAgdGhpcy5wb3N0Qm9keUJ1ZmZlcnMgPSB1bmRlZmluZWRcblxuICAgIHRoaXMuY29tcGxldGVSZXF1ZXN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cGVjdHMgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaHR0cE1ldGhvZCAtIEhUVFAgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IGV4cGVjdHMgYSBib2R5LlxuICAgKi9cbiAgZXhwZWN0c1JlcXVlc3RCb2R5KGh0dHBNZXRob2QpIHtcbiAgICByZXR1cm4gIVtcIkdFVFwiLCBcIk9QVElPTlNcIiwgXCJIRUFEXCJdLmluY2x1ZGVzKGh0dHBNZXRob2QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjaHVua2VkIGVuY29kaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IHVzZXMgY2h1bmtlZCB0cmFuc2ZlciBlbmNvZGluZy5cbiAgICovXG4gIGlzQ2h1bmtlZEVuY29kaW5nKCkge1xuICAgIGNvbnN0IHRyYW5zZmVyRW5jb2RpbmcgPSB0aGlzLmdldEhlYWRlcihcInRyYW5zZmVyLWVuY29kaW5nXCIpPy52YWx1ZT8udG9Mb3dlckNhc2UoKVxuXG4gICAgcmV0dXJuIEJvb2xlYW4odHJhbnNmZXJFbmNvZGluZz8uaW5jbHVkZXMoXCJjaHVua2VkXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSBjaHVua2VkIGJvZHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGluaXRpYWxpemVDaHVua2VkQm9keSgpIHtcbiAgICB0aGlzLmNodW5rZWRCb2R5Q2hhcnMgPSBbXVxuICAgIHRoaXMuY3VycmVudENodW5rU2l6ZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY3VycmVudENodW5rQnl0ZXNSZWFkID0gMFxuICAgIHRoaXMuc2V0U3RhdGUoXCJjaHVua2VkLXNpemVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGNodW5rIHNpemUgbGluZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxpbmUgLSBDaHVuayBzaXplIGxpbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHBhcnNlQ2h1bmtTaXplTGluZShsaW5lKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpXG5cbiAgICBpZiAoIXRyaW1tZWQpIHJldHVyblxuXG4gICAgY29uc3Qgc2l6ZVRva2VuID0gdHJpbW1lZC5zcGxpdChcIjtcIilbMF0/LnRyaW0oKVxuXG4gICAgaWYgKCFzaXplVG9rZW4pIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjaHVuayBzaXplIGxpbmU6ICR7bGluZX1gKVxuXG4gICAgY29uc3Qgc2l6ZSA9IE51bWJlci5wYXJzZUludChzaXplVG9rZW4sIDE2KVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2l6ZSkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjaHVuayBzaXplOiAke3NpemVUb2tlbn1gKVxuXG4gICAgaWYgKHNpemUgPT09IDApIHtcbiAgICAgIHRoaXMuc2V0U3RhdGUoXCJjaHVua2VkLXRyYWlsZXJcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuY3VycmVudENodW5rU2l6ZSA9IHNpemVcbiAgICB0aGlzLmN1cnJlbnRDaHVua0J5dGVzUmVhZCA9IDBcbiAgICB0aGlzLnNldFN0YXRlKFwiY2h1bmtlZC1kYXRhXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5pc2ggY2h1bmtlZCBib2R5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBmaW5pc2hDaHVua2VkQm9keSgpIHtcbiAgICBpZiAodGhpcy5jaHVua2VkQm9keUNoYXJzKSB7XG4gICAgICB0aGlzLnBvc3RCb2R5ID0gQnVmZmVyLmZyb20odGhpcy5jaHVua2VkQm9keUNoYXJzKS50b1N0cmluZyhcInV0ZjhcIilcbiAgICB9XG5cbiAgICBkZWxldGUgdGhpcy5jaHVua2VkQm9keUNoYXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdTdGF0ZSAtIE5ldyBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RhdGUobmV3U3RhdGUpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1Z0xvd0xldmVsKCgpID0+IGBDaGFuZ2luZyBzdGF0ZSBmcm9tICR7dGhpcy5zdGF0ZX0gdG8gJHtuZXdTdGF0ZX1gKVxuICAgIHRoaXMuc3RhdGUgPSBuZXdTdGF0ZVxuICB9XG5cbiAgY29tcGxldGVSZXF1ZXN0ID0gKCkgPT4ge1xuICAgIHRoaXMuc3RhdGUgPSBcInN0YXR1c1wiIC8vIFJlc2V0IHN0YXRlIHRvIG5ldyByZXF1ZXN0XG4gICAgdGhpcy5jb21wbGV0ZWQgPSB0cnVlXG5cbiAgICBpZiAodGhpcy5nZXRIZWFkZXIoXCJjb250ZW50LXR5cGVcIik/LnZhbHVlPy5zdGFydHNXaXRoKFwiYXBwbGljYXRpb24vanNvblwiKSkge1xuICAgICAgdGhpcy5wYXJzZUFwcGxpY2F0aW9uSnNvblBhcmFtcygpXG4gICAgfSBlbHNlIGlmICh0aGlzLm11bHRpUGFydHlGb3JtRGF0YSkge1xuICAgICAgLy8gRG9uZSBhZnRlciBlYWNoIG5ldyBmb3JtIGRhdGEgcGFydFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBhcnNlUXVlcnlTdHJpbmdQb3N0UGFyYW1zKClcbiAgICB9XG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY29tcGxldGVkXCIpXG4gIH1cblxuICBwYXJzZUFwcGxpY2F0aW9uSnNvblBhcmFtcygpIHtcbiAgICBpZiAodGhpcy5wb3N0Qm9keSkge1xuICAgICAgY29uc3QgbmV3UGFyYW1zID0gSlNPTi5wYXJzZSh0aGlzLnBvc3RCb2R5KVxuXG4gICAgICBpbmNvcnBvcmF0ZSh0aGlzLnBhcmFtcywgbmV3UGFyYW1zKVxuICAgIH1cbiAgfVxuXG4gIHBhcnNlUXVlcnlTdHJpbmdQb3N0UGFyYW1zKCkge1xuICAgIGlmICh0aGlzLnBvc3RCb2R5KSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwYXJzZWRRdWVyeSA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHRoaXMucG9zdEJvZHkpXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBVbnBhcnNlZCBwYXJhbXMuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59ICovXG4gICAgICAgIGNvbnN0IHVucGFyc2VkUGFyYW1zID0ge31cblxuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwYXJzZWRRdWVyeSkpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICB1bnBhcnNlZFBhcmFtc1trZXldID0gdmFsdWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwYXJhbXNUb09iamVjdCA9IG5ldyBQYXJhbXNUb09iamVjdCh1bnBhcnNlZFBhcmFtcylcbiAgICAgICAgY29uc3QgbmV3UGFyYW1zID0gcGFyYW1zVG9PYmplY3QudG9PYmplY3QoKVxuXG4gICAgICAgIGluY29ycG9yYXRlKHRoaXMucGFyYW1zLCBuZXdQYXJhbXMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBlbnN1cmVkRXJyb3IgPSAvKiogQHR5cGUge0Vycm9yICYge3ZlbG9jaW91c0NvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqLyAoZXJyb3IpXG5cbiAgICAgICAgZW5zdXJlZEVycm9yLnZlbG9jaW91c0NvbnRleHQgPSB7XG4gICAgICAgICAgLi4uKGVuc3VyZWRFcnJvci52ZWxvY2lvdXNDb250ZXh0IHx8IHt9KSxcbiAgICAgICAgICByZXF1ZXN0UGFyc2luZzoge1xuICAgICAgICAgICAgY29udGVudFR5cGU6IHRoaXMuZ2V0SGVhZGVyKFwiY29udGVudC10eXBlXCIpPy52YWx1ZSxcbiAgICAgICAgICAgIGh0dHBNZXRob2Q6IHRoaXMuaHR0cE1ldGhvZCxcbiAgICAgICAgICAgIHBhcmFtZXRlcktleXM6IE9iamVjdC5rZXlzKHF1ZXJ5c3RyaW5nLnBhcnNlKHRoaXMucG9zdEJvZHkpKSxcbiAgICAgICAgICAgIHBhdGg6IHRoaXMucGF0aCxcbiAgICAgICAgICAgIHBvc3RCb2R5UHJldmlldzogdHJ1bmNhdGVQcmV2aWV3KHRoaXMucG9zdEJvZHkpLFxuICAgICAgICAgICAgc3RhZ2U6IFwicXVlcnktc3RyaW5nLXBvc3QtcGFyYW1zXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlbnN1cmVkRXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==