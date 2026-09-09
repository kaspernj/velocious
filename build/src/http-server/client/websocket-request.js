// @ts-check
import querystring from "querystring";
export default class VelociousHttpServerClientWebsocketRequest {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {ReturnType<typeof JSON.parse>} [args.body] - Request body.
     * @param {Record<string, string>} [args.headers] - Header list.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.metadata] - Session metadata.
     * @param {string} args.method - HTTP method.
     * @param {string} args.path - Path.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.params] - Parameters object.
     * @param {string} [args.remoteAddress] - Remote address.
     */
    constructor({ body, headers, metadata, method, params, path, remoteAddress }) {
        if (!method)
            throw new Error("method is required");
        if (!path)
            throw new Error("path is required");
        this.body = body;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, string>} */
        this.headersMap = {};
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        this.metadataObject = metadata ? { ...metadata } : {};
        this.method = method.toUpperCase();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        this.paramsObject = {};
        this._path = path;
        this.remoteAddressValue = remoteAddress;
        if (headers) {
            for (const [key, value] of Object.entries(headers)) {
                this.headersMap[key.toLowerCase()] = value;
            }
        }
        if (params)
            this.paramsObject = { ...params };
        if (this.body && typeof this.body === "object")
            this.paramsObject = { ...this.paramsObject, ...this.body };
        if (this.body && typeof this.body === "object" && !this.headersMap["content-type"]) {
            this.headersMap["content-type"] = "application/json";
        }
        const queryParams = this._parseQueryParams();
        this.paramsObject = { ...queryParams, ...this.paramsObject };
    }
    baseURL() {
        const protocol = this.protocol();
        const host = this.hostWithPort();
        if (protocol && host)
            return `${protocol}://${host}`;
    }
    /**
     * Runs header.
     * @param {string} name - Header name.
     * @returns {string | null} - Header value.
     */
    header(name) { return this.headersMap[name.toLowerCase()] || null; }
    headers() { return this.headersMap; }
    httpMethod() { return this.method; }
    httpVersion() { return "websocket"; }
    host() { return this.header("host") || undefined; }
    /**
     * Runs metadata.
     * @param {string} [key] - Metadata key.
     * @returns {ReturnType<typeof JSON.parse>} - Metadata value for a key, or the full metadata object.
     */
    metadata(key) {
        if (key !== undefined)
            return this.metadataObject[key];
        return { ...this.metadataObject };
    }
    hostWithPort() {
        const host = this.host();
        const port = this.port();
        if (!host)
            return;
        if (!port)
            return host;
        return `${host}:${port}`;
    }
    origin() { return this.header("origin"); }
    path() { return this._path; }
    params() { return this.paramsObject; }
    port() {
        const hostHeader = this.header("host");
        const match = hostHeader?.match(/:(\d+)$/);
        if (match)
            return parseInt(match[1]);
    }
    protocol() {
        const origin = this.origin();
        const match = origin?.match(/^(.+):\/\//);
        return match?.[1];
    }
    /**
     * Runs query params.
     * @returns {Record<string, string | string[]>} - Parsed query parameters from the URL.
     */
    queryParams() { return this._parseQueryParams(); }
    remoteAddress() { return this.remoteAddressValue; }
    _parseQueryParams() {
        const query = this._path.split("?")[1];
        if (!query)
            return Object.create(null);
        const parsedQuery = querystring.parse(query);
        /**
         * Params.
         * @type {Record<string, string | string[]>} */
        const params = Object.create(null);
        for (const key of Object.keys(parsedQuery)) {
            const value = parsedQuery[key];
            if (typeof value !== "undefined") {
                params[key] = value;
            }
        }
        return params;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXJlcXVlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxhQUFhLENBQUE7QUFFckMsTUFBTSxDQUFDLE9BQU8sT0FBTyx5Q0FBeUM7SUFDNUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUM7UUFDeEUsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDbEQsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFFOUMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEI7OzRDQUVvQztRQUNwQyxJQUFJLENBQUMsVUFBVSxHQUFHLEVBQUUsQ0FBQTtRQUNwQjs7bUVBRTJEO1FBQzNELElBQUksQ0FBQyxjQUFjLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxFQUFDLEdBQUcsUUFBUSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUNuRCxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUNsQzs7bUVBRTJEO1FBQzNELElBQUksQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFBO1FBQ3RCLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFBO1FBQ2pCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxhQUFhLENBQUE7UUFFdkMsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNaLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENB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QUFNLENBQUE7SUFDZixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHF1ZXJ5c3RyaW5nIGZyb20gXCJxdWVyeXN0cmluZ1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJDbGllbnRXZWJzb2NrZXRSZXF1ZXN0IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmJvZHldIC0gUmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IFthcmdzLmhlYWRlcnNdIC0gSGVhZGVyIGxpc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5tZXRhZGF0YV0gLSBTZXNzaW9uIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXRob2QgLSBIVFRQIG1ldGhvZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFBhdGguXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5wYXJhbXNdIC0gUGFyYW1ldGVycyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5yZW1vdGVBZGRyZXNzXSAtIFJlbW90ZSBhZGRyZXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2JvZHksIGhlYWRlcnMsIG1ldGFkYXRhLCBtZXRob2QsIHBhcmFtcywgcGF0aCwgcmVtb3RlQWRkcmVzc30pIHtcbiAgICBpZiAoIW1ldGhvZCkgdGhyb3cgbmV3IEVycm9yKFwibWV0aG9kIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFwYXRoKSB0aHJvdyBuZXcgRXJyb3IoXCJwYXRoIGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLmJvZHkgPSBib2R5XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICAgIHRoaXMuaGVhZGVyc01hcCA9IHt9XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgdGhpcy5tZXRhZGF0YU9iamVjdCA9IG1ldGFkYXRhID8gey4uLm1ldGFkYXRhfSA6IHt9XG4gICAgdGhpcy5tZXRob2QgPSBtZXRob2QudG9VcHBlckNhc2UoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIHRoaXMucGFyYW1zT2JqZWN0ID0ge31cbiAgICB0aGlzLl9wYXRoID0gcGF0aFxuICAgIHRoaXMucmVtb3RlQWRkcmVzc1ZhbHVlID0gcmVtb3RlQWRkcmVzc1xuXG4gICAgaWYgKGhlYWRlcnMpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpKSB7XG4gICAgICAgIHRoaXMuaGVhZGVyc01hcFtrZXkudG9Mb3dlckNhc2UoKV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwYXJhbXMpIHRoaXMucGFyYW1zT2JqZWN0ID0gey4uLnBhcmFtc31cbiAgICBpZiAodGhpcy5ib2R5ICYmIHR5cGVvZiB0aGlzLmJvZHkgPT09IFwib2JqZWN0XCIpIHRoaXMucGFyYW1zT2JqZWN0ID0gey4uLnRoaXMucGFyYW1zT2JqZWN0LCAuLi50aGlzLmJvZHl9XG4gICAgaWYgKHRoaXMuYm9keSAmJiB0eXBlb2YgdGhpcy5ib2R5ID09PSBcIm9iamVjdFwiICYmICF0aGlzLmhlYWRlcnNNYXBbXCJjb250ZW50LXR5cGVcIl0pIHtcbiAgICAgIHRoaXMuaGVhZGVyc01hcFtcImNvbnRlbnQtdHlwZVwiXSA9IFwiYXBwbGljYXRpb24vanNvblwiXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnlQYXJhbXMgPSB0aGlzLl9wYXJzZVF1ZXJ5UGFyYW1zKClcblxuICAgIHRoaXMucGFyYW1zT2JqZWN0ID0gey4uLnF1ZXJ5UGFyYW1zLCAuLi50aGlzLnBhcmFtc09iamVjdH1cbiAgfVxuXG4gIGJhc2VVUkwoKSB7XG4gICAgY29uc3QgcHJvdG9jb2wgPSB0aGlzLnByb3RvY29sKClcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0V2l0aFBvcnQoKVxuXG4gICAgaWYgKHByb3RvY29sICYmIGhvc3QpIHJldHVybiBgJHtwcm90b2NvbH06Ly8ke2hvc3R9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEhlYWRlciBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBIZWFkZXIgdmFsdWUuXG4gICAqL1xuICBoZWFkZXIobmFtZSkgeyByZXR1cm4gdGhpcy5oZWFkZXJzTWFwW25hbWUudG9Mb3dlckNhc2UoKV0gfHwgbnVsbCB9XG5cbiAgaGVhZGVycygpIHsgcmV0dXJuIHRoaXMuaGVhZGVyc01hcCB9XG5cbiAgaHR0cE1ldGhvZCgpIHsgcmV0dXJuIHRoaXMubWV0aG9kIH1cblxuICBodHRwVmVyc2lvbigpIHsgcmV0dXJuIFwid2Vic29ja2V0XCIgfVxuXG4gIGhvc3QoKSB7IHJldHVybiB0aGlzLmhlYWRlcihcImhvc3RcIikgfHwgdW5kZWZpbmVkIH1cblxuICAvKipcbiAgICogUnVucyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtrZXldIC0gTWV0YWRhdGEga2V5LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTWV0YWRhdGEgdmFsdWUgZm9yIGEga2V5LCBvciB0aGUgZnVsbCBtZXRhZGF0YSBvYmplY3QuXG4gICAqL1xuICBtZXRhZGF0YShrZXkpIHtcbiAgICBpZiAoa2V5ICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLm1ldGFkYXRhT2JqZWN0W2tleV1cblxuICAgIHJldHVybiB7Li4udGhpcy5tZXRhZGF0YU9iamVjdH1cbiAgfVxuXG4gIGhvc3RXaXRoUG9ydCgpIHtcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0KClcbiAgICBjb25zdCBwb3J0ID0gdGhpcy5wb3J0KClcblxuICAgIGlmICghaG9zdCkgcmV0dXJuXG4gICAgaWYgKCFwb3J0KSByZXR1cm4gaG9zdFxuXG4gICAgcmV0dXJuIGAke2hvc3R9OiR7cG9ydH1gXG4gIH1cblxuICBvcmlnaW4oKSB7IHJldHVybiB0aGlzLmhlYWRlcihcIm9yaWdpblwiKSB9XG5cbiAgcGF0aCgpIHsgcmV0dXJuIHRoaXMuX3BhdGggfVxuXG4gIHBhcmFtcygpIHsgcmV0dXJuIHRoaXMucGFyYW1zT2JqZWN0IH1cblxuICBwb3J0KCkge1xuICAgIGNvbnN0IGhvc3RIZWFkZXIgPSB0aGlzLmhlYWRlcihcImhvc3RcIilcbiAgICBjb25zdCBtYXRjaCA9IGhvc3RIZWFkZXI/Lm1hdGNoKC86KFxcZCspJC8pXG5cbiAgICBpZiAobWF0Y2gpIHJldHVybiBwYXJzZUludChtYXRjaFsxXSlcbiAgfVxuXG4gIHByb3RvY29sKCkge1xuICAgIGNvbnN0IG9yaWdpbiA9IHRoaXMub3JpZ2luKClcbiAgICBjb25zdCBtYXRjaCA9IG9yaWdpbj8ubWF0Y2goL14oLispOlxcL1xcLy8pXG5cbiAgICByZXR1cm4gbWF0Y2g/LlsxXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAtIFBhcnNlZCBxdWVyeSBwYXJhbWV0ZXJzIGZyb20gdGhlIFVSTC5cbiAgICovXG4gIHF1ZXJ5UGFyYW1zKCkgeyByZXR1cm4gdGhpcy5fcGFyc2VRdWVyeVBhcmFtcygpIH1cblxuICByZW1vdGVBZGRyZXNzKCkgeyByZXR1cm4gdGhpcy5yZW1vdGVBZGRyZXNzVmFsdWUgfVxuXG4gIF9wYXJzZVF1ZXJ5UGFyYW1zKCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5fcGF0aC5zcGxpdChcIj9cIilbMV1cblxuICAgIGlmICghcXVlcnkpIHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpXG5cbiAgICBjb25zdCBwYXJzZWRRdWVyeSA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHF1ZXJ5KVxuICAgIC8qKlxuICAgICAqIFBhcmFtcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAqL1xuICAgIGNvbnN0IHBhcmFtcyA9IE9iamVjdC5jcmVhdGUobnVsbClcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHBhcnNlZFF1ZXJ5KSkge1xuICAgICAgY29uc3QgdmFsdWUgPSBwYXJzZWRRdWVyeVtrZXldXG5cbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgcGFyYW1zW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbXNcbiAgfVxufVxuIl19