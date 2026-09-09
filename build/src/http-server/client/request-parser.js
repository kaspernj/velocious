// @ts-check
import { digg } from "diggerize";
import EventEmitter from "../../utils/event-emitter.js";
import { incorporate } from "incorporator";
import ParamsToObject from "./params-to-object.js";
import RequestBuffer from "./request-buffer/index.js";
export default class VelociousHttpServerClientRequestParser {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration }) {
        if (!configuration)
            throw new Error("No configuration given");
        this.configuration = configuration;
        this.data = [];
        this.events = new EventEmitter();
        this.hasCompleted = false;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, string | string[] | undefined | Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>>} */
        this.params = {};
        this.requestBuffer = new RequestBuffer({ configuration });
        this.requestBuffer.events.on("completed", this.requestDone);
        this.requestBuffer.events.on("form-data-part", this.onFormDataPart);
        this.requestBuffer.events.on("request-done", this.requestDone);
    }
    /**
     * Runs destroy.
     * @returns {void} - No return value.
     */
    destroy() {
        this.requestBuffer.events.off("completed", this.requestDone);
        this.requestBuffer.events.off("form-data-part", this.onFormDataPart);
        this.requestBuffer.events.off("request-done", this.requestDone);
        this.requestBuffer.destroy();
    }
    /**
     * On form data part.
     * @param {import("./request-buffer/form-data-part.js").default} formDataPart - Form data part.
     * @returns {void} - No return value.
     */
    onFormDataPart = (formDataPart) => {
        /**
         * Unordered params.
         * @type {Record<string, string | string[] | import("./uploaded-file/uploaded-file.js").default>} */
        const unorderedParams = {};
        unorderedParams[formDataPart.getName()] = formDataPart.getValue();
        try {
            const paramsToObject = new ParamsToObject(unorderedParams);
            const newParams = paramsToObject.toObject();
            incorporate(this.params, newParams);
        }
        catch (error) {
            const ensuredError = /** @type {Error & {velociousContext?: Record<string, ReturnType<typeof JSON.parse>>}} */ (error);
            ensuredError.velociousContext = {
                ...(ensuredError.velociousContext || {}),
                requestParsing: {
                    formDataPartName: formDataPart.getName(),
                    httpMethod: this.getHttpMethod(),
                    path: this.getPath(),
                    stage: "form-data-part"
                }
            };
            throw ensuredError;
        }
    };
    /**
     * Feed.
     * @param {Buffer} data - Data payload.
     * @returns {Buffer | undefined} - Remaining data, if any.
     */
    feed = (data) => {
        if (this.hasCompleted) {
            throw new Error("Request parser already completed");
        }
        return this.requestBuffer.feed(data);
    };
    /**
     * Runs get header.
     * @param {string} name - Name.
     * @returns {string} - The header.
     */
    getHeader(name) { return this.requestBuffer.getHeader(name)?.value; }
    /**
     * Runs get headers.
     * @returns {Record<string, string>} - The headers.
     */
    getHeaders() { return this.requestBuffer.getHeadersHash(); }
    /**
     * Runs get http method.
     * @returns {string} - The http method.
     */
    getHttpMethod() { return digg(this, "requestBuffer", "httpMethod"); }
    /**
     * Runs get http version.
     * @returns {string} - The http version.
     */
    getHttpVersion() { return digg(this, "requestBuffer", "httpVersion"); }
    /**
     * Runs get host match.
     * @returns {{host: string, port: string, protocol: string} | null} - Parsed host info, or null when unavailable.
     */
    _getHostMatch() {
        const rawHost = this.requestBuffer.getHeader("origin")?.value;
        if (!rawHost)
            return null;
        const match = rawHost.match(/^(.+):\/\/(.+)(|:(\d+))/);
        if (!match)
            throw new Error(`Couldn't match host: ${rawHost}`);
        return {
            protocol: match[1],
            host: match[2],
            port: match[4]
        };
    }
    /**
     * Runs get host.
     * @returns {string | void} - The host.
     */
    getHost() {
        const rawHostSplit = this.requestBuffer.getHeader("host")?.value?.split(":");
        if (rawHostSplit && rawHostSplit[0])
            return rawHostSplit[0];
    }
    /**
     * Runs get path.
     * @returns {string} - The path.
     */
    getPath() { return digg(this, "requestBuffer", "path"); }
    /**
     * Runs get port.
     * @returns {number | void} - The port.
     */
    getPort() {
        const rawHostSplit = this.requestBuffer.getHeader("host")?.value?.split(":");
        const httpMethod = this.getHttpMethod();
        if (rawHostSplit && rawHostSplit[1]) {
            return parseInt(rawHostSplit[1]);
        }
        else if (httpMethod == "http") {
            return 80;
        }
        else if (httpMethod == "https") {
            return 443;
        }
    }
    /**
     * Runs get protocol.
     * @returns {string | null} - The protocol.
     */
    getProtocol() { return this._getHostMatch()?.protocol || null; }
    /**
     * Runs get request buffer.
     * @returns {RequestBuffer} - The request buffer.
     */
    getRequestBuffer() { return this.requestBuffer; }
    /**
     * Request done.
     * @returns {void} - No return value.
     */
    requestDone = () => {
        this.hasCompleted = true;
        incorporate(this.params, this.requestBuffer.params);
        this.state = "done";
        this.events.emit("done");
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC1wYXJzZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtcGFyc2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxhQUFhLE1BQU0sMkJBQTJCLENBQUE7QUFFckQsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQ0FBc0M7SUFDekQ7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUM7UUFDekIsSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFFN0QsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxFQUFFLENBQUE7UUFDZCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksWUFBWSxFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLFlBQVksR0FBRyxLQUFLLENBQUE7UUFDekI7OzBKQUVrSjtRQUNsSixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVoQixJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksYUFBYSxDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUN2RCxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUMzRCxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxD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TSxFQUFFLENBQUM7WUFDaEMsT0FBTyxFQUFFLENBQUE7UUFDWCxDQUFDO2FBQU0sSUFBSSxVQUFVLElBQUksT0FBTyxFQUFFLENBQUM7WUFDakMsT0FBTyxHQUFHLENBQUE7UUFDWixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLEVBQUUsRUFBRSxRQUFRLElBQUksSUFBSSxDQUFBLENBQUMsQ0FBQztJQUUvRDs7O09BR0c7SUFDSCxnQkFBZ0IsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUEsQ0FBQyxDQUFDO0lBRWhEOzs7T0FHRztJQUNILFdBQVcsR0FBRyxHQUFHLEVBQUU7UUFDakIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUE7UUFDeEIsV0FBVyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVuRCxJQUFJLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQTtRQUNuQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUMxQixDQUFDLENBQUE7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCBQYXJhbXNUb09iamVjdCBmcm9tIFwiLi9wYXJhbXMtdG8tb2JqZWN0LmpzXCJcbmltcG9ydCBSZXF1ZXN0QnVmZmVyIGZyb20gXCIuL3JlcXVlc3QtYnVmZmVyL2luZGV4LmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudFJlcXVlc3RQYXJzZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbn0pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW5cIilcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGEgPSBbXVxuICAgIHRoaXMuZXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG4gICAgdGhpcy5oYXNDb21wbGV0ZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIHRoaXMucGFyYW1zID0ge31cblxuICAgIHRoaXMucmVxdWVzdEJ1ZmZlciA9IG5ldyBSZXF1ZXN0QnVmZmVyKHtjb25maWd1cmF0aW9ufSlcbiAgICB0aGlzLnJlcXVlc3RCdWZmZXIuZXZlbnRzLm9uKFwiY29tcGxldGVkXCIsIHRoaXMucmVxdWVzdERvbmUpXG4gICAgdGhpcy5yZXF1ZXN0QnVmZmVyLmV2ZW50cy5vbihcImZvcm0tZGF0YS1wYXJ0XCIsIHRoaXMub25Gb3JtRGF0YVBhcnQpXG4gICAgdGhpcy5yZXF1ZXN0QnVmZmVyLmV2ZW50cy5vbihcInJlcXVlc3QtZG9uZVwiLCB0aGlzLnJlcXVlc3REb25lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZGVzdHJveSgpIHtcbiAgICB0aGlzLnJlcXVlc3RCdWZmZXIuZXZlbnRzLm9mZihcImNvbXBsZXRlZFwiLCB0aGlzLnJlcXVlc3REb25lKVxuICAgIHRoaXMucmVxdWVzdEJ1ZmZlci5ldmVudHMub2ZmKFwiZm9ybS1kYXRhLXBhcnRcIiwgdGhpcy5vbkZvcm1EYXRhUGFydClcbiAgICB0aGlzLnJlcXVlc3RCdWZmZXIuZXZlbnRzLm9mZihcInJlcXVlc3QtZG9uZVwiLCB0aGlzLnJlcXVlc3REb25lKVxuICAgIHRoaXMucmVxdWVzdEJ1ZmZlci5kZXN0cm95KClcbiAgfVxuXG4gIC8qKlxuICAgKiBPbiBmb3JtIGRhdGEgcGFydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QtYnVmZmVyL2Zvcm0tZGF0YS1wYXJ0LmpzXCIpLmRlZmF1bHR9IGZvcm1EYXRhUGFydCAtIEZvcm0gZGF0YSBwYXJ0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvbkZvcm1EYXRhUGFydCA9IChmb3JtRGF0YVBhcnQpID0+IHtcbiAgICAvKipcbiAgICAgKiBVbm9yZGVyZWQgcGFyYW1zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IGltcG9ydChcIi4vdXBsb2FkZWQtZmlsZS91cGxvYWRlZC1maWxlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IHVub3JkZXJlZFBhcmFtcyA9IHt9XG5cbiAgICB1bm9yZGVyZWRQYXJhbXNbZm9ybURhdGFQYXJ0LmdldE5hbWUoKV0gPSBmb3JtRGF0YVBhcnQuZ2V0VmFsdWUoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcmFtc1RvT2JqZWN0ID0gbmV3IFBhcmFtc1RvT2JqZWN0KHVub3JkZXJlZFBhcmFtcylcbiAgICAgIGNvbnN0IG5ld1BhcmFtcyA9IHBhcmFtc1RvT2JqZWN0LnRvT2JqZWN0KClcblxuICAgICAgaW5jb3Jwb3JhdGUodGhpcy5wYXJhbXMsIG5ld1BhcmFtcylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZW5zdXJlZEVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKGVycm9yKVxuXG4gICAgICBlbnN1cmVkRXJyb3IudmVsb2Npb3VzQ29udGV4dCA9IHtcbiAgICAgICAgLi4uKGVuc3VyZWRFcnJvci52ZWxvY2lvdXNDb250ZXh0IHx8IHt9KSxcbiAgICAgICAgcmVxdWVzdFBhcnNpbmc6IHtcbiAgICAgICAgICBmb3JtRGF0YVBhcnROYW1lOiBmb3JtRGF0YVBhcnQuZ2V0TmFtZSgpLFxuICAgICAgICAgIGh0dHBNZXRob2Q6IHRoaXMuZ2V0SHR0cE1ldGhvZCgpLFxuICAgICAgICAgIHBhdGg6IHRoaXMuZ2V0UGF0aCgpLFxuICAgICAgICAgIHN0YWdlOiBcImZvcm0tZGF0YS1wYXJ0XCJcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlbnN1cmVkRXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmVlZC5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtCdWZmZXIgfCB1bmRlZmluZWR9IC0gUmVtYWluaW5nIGRhdGEsIGlmIGFueS5cbiAgICovXG4gIGZlZWQgPSAoZGF0YSkgPT4ge1xuICAgIGlmICh0aGlzLmhhc0NvbXBsZXRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWVzdCBwYXJzZXIgYWxyZWFkeSBjb21wbGV0ZWRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZXF1ZXN0QnVmZmVyLmZlZWQoZGF0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgaGVhZGVyLlxuICAgKi9cbiAgZ2V0SGVhZGVyKG5hbWUpIHsgcmV0dXJuIHRoaXMucmVxdWVzdEJ1ZmZlci5nZXRIZWFkZXIobmFtZSk/LnZhbHVlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaGVhZGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gVGhlIGhlYWRlcnMuXG4gICAqL1xuICBnZXRIZWFkZXJzKCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0QnVmZmVyLmdldEhlYWRlcnNIYXNoKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBodHRwIG1ldGhvZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgaHR0cCBtZXRob2QuXG4gICAqL1xuICBnZXRIdHRwTWV0aG9kKCkgeyByZXR1cm4gZGlnZyh0aGlzLCBcInJlcXVlc3RCdWZmZXJcIiwgXCJodHRwTWV0aG9kXCIpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaHR0cCB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBodHRwIHZlcnNpb24uXG4gICAqL1xuICBnZXRIdHRwVmVyc2lvbigpIHsgcmV0dXJuIGRpZ2codGhpcywgXCJyZXF1ZXN0QnVmZmVyXCIsIFwiaHR0cFZlcnNpb25cIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBob3N0IG1hdGNoLlxuICAgKiBAcmV0dXJucyB7e2hvc3Q6IHN0cmluZywgcG9ydDogc3RyaW5nLCBwcm90b2NvbDogc3RyaW5nfSB8IG51bGx9IC0gUGFyc2VkIGhvc3QgaW5mbywgb3IgbnVsbCB3aGVuIHVuYXZhaWxhYmxlLlxuICAgKi9cbiAgX2dldEhvc3RNYXRjaCgpIHtcbiAgICBjb25zdCByYXdIb3N0ID0gdGhpcy5yZXF1ZXN0QnVmZmVyLmdldEhlYWRlcihcIm9yaWdpblwiKT8udmFsdWVcblxuICAgIGlmICghcmF3SG9zdCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG1hdGNoID0gcmF3SG9zdC5tYXRjaCgvXiguKyk6XFwvXFwvKC4rKSh8OihcXGQrKSkvKVxuXG4gICAgaWYgKCFtYXRjaCkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBtYXRjaCBob3N0OiAke3Jhd0hvc3R9YClcblxuICAgIHJldHVybiB7XG4gICAgICBwcm90b2NvbDogbWF0Y2hbMV0sXG4gICAgICBob3N0OiBtYXRjaFsyXSxcbiAgICAgIHBvcnQ6IG1hdGNoWzRdXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGhvc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB2b2lkfSAtIFRoZSBob3N0LlxuICAgKi9cbiAgZ2V0SG9zdCgpIHtcbiAgICBjb25zdCByYXdIb3N0U3BsaXQgPSB0aGlzLnJlcXVlc3RCdWZmZXIuZ2V0SGVhZGVyKFwiaG9zdFwiKT8udmFsdWU/LnNwbGl0KFwiOlwiKVxuXG4gICAgaWYgKHJhd0hvc3RTcGxpdCAmJiByYXdIb3N0U3BsaXRbMF0pIHJldHVybiByYXdIb3N0U3BsaXRbMF1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBwYXRoLlxuICAgKi9cbiAgZ2V0UGF0aCgpIHsgcmV0dXJuIGRpZ2codGhpcywgXCJyZXF1ZXN0QnVmZmVyXCIsIFwicGF0aFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBvcnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB2b2lkfSAtIFRoZSBwb3J0LlxuICAgKi9cbiAgZ2V0UG9ydCgpIHtcbiAgICBjb25zdCByYXdIb3N0U3BsaXQgPSB0aGlzLnJlcXVlc3RCdWZmZXIuZ2V0SGVhZGVyKFwiaG9zdFwiKT8udmFsdWU/LnNwbGl0KFwiOlwiKVxuICAgIGNvbnN0IGh0dHBNZXRob2QgPSB0aGlzLmdldEh0dHBNZXRob2QoKVxuXG4gICAgaWYgKHJhd0hvc3RTcGxpdCAmJiByYXdIb3N0U3BsaXRbMV0pIHtcbiAgICAgIHJldHVybiBwYXJzZUludChyYXdIb3N0U3BsaXRbMV0pXG4gICAgfSBlbHNlIGlmIChodHRwTWV0aG9kID09IFwiaHR0cFwiKSB7XG4gICAgICByZXR1cm4gODBcbiAgICB9IGVsc2UgaWYgKGh0dHBNZXRob2QgPT0gXCJodHRwc1wiKSB7XG4gICAgICByZXR1cm4gNDQzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByb3RvY29sLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBUaGUgcHJvdG9jb2wuXG4gICAqL1xuICBnZXRQcm90b2NvbCgpIHsgcmV0dXJuIHRoaXMuX2dldEhvc3RNYXRjaCgpPy5wcm90b2NvbCB8fCBudWxsIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVxdWVzdCBidWZmZXIuXG4gICAqIEByZXR1cm5zIHtSZXF1ZXN0QnVmZmVyfSAtIFRoZSByZXF1ZXN0IGJ1ZmZlci5cbiAgICovXG4gIGdldFJlcXVlc3RCdWZmZXIoKSB7IHJldHVybiB0aGlzLnJlcXVlc3RCdWZmZXIgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0IGRvbmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlcXVlc3REb25lID0gKCkgPT4ge1xuICAgIHRoaXMuaGFzQ29tcGxldGVkID0gdHJ1ZVxuICAgIGluY29ycG9yYXRlKHRoaXMucGFyYW1zLCB0aGlzLnJlcXVlc3RCdWZmZXIucGFyYW1zKVxuXG4gICAgdGhpcy5zdGF0ZSA9IFwiZG9uZVwiXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImRvbmVcIilcbiAgfVxufVxuIl19