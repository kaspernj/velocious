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
        /**
         * Whether the owning client connection was torn down while this request
         * was still running. Websocket requests are session-owned and never
         * enter the client's in-flight request list, so this stays false for
         * them; the field exists so the request union shares one surface.
         * @type {boolean} */
        this.clientDisconnected = false;
        /** @type {Set<() => void>} */
        this.clientDisconnectCallbacks = new Set();
    }
    /**
     * Marks this request as client-disconnected and runs every registered
     * disconnect callback exactly once. The owning client invokes it when the
     * socket tears down; handlers that register afterwards learn of the
     * disconnect through the `clientDisconnected` field instead. Websocket
     * requests are session-owned and never enter the client's in-flight
     * request list, so this is inert for them; the shared surface keeps the
     * request union uniform.
     * @returns {void}
     */
    markClientDisconnected() {
        if (this.clientDisconnected)
            return;
        this.clientDisconnected = true;
        for (const callback of this.clientDisconnectCallbacks) {
            callback();
        }
        this.clientDisconnectCallbacks.clear();
    }
    /**
     * Registers a callback that fires once when the client connection tears
     * down while this request is still running. See the HTTP request's
     * {@linkcode markClientDisconnected} for the shared-surface note.
     * @param {() => void} callback - Disconnect callback.
     * @returns {void}
     */
    onClientDisconnect(callback) {
        if (this.clientDisconnected) {
            callback();
            return;
        }
        this.clientDisconnectCallbacks.add(callback);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXJlcXVlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFdBQVcsTUFBTSxhQUFhLENBQUE7QUFFckMsTUFBTSxDQUFDLE9BQU8sT0FBTyx5Q0FBeUM7SUFDNUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUM7UUFDeEUsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDbEQsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFFOUMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEI7OzRDQUVvQztRQUNwQyxJQUFJLENBQUMsVUFBVSxHQUFHLEVBQUUsQ0FBQTtRQUNwQjs7bUVBRTJEO1FBQzNELElBQUksQ0FBQyxjQUFjLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxFQUFDLEdBQUcsUUFBUSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUNuRCxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUNsQzs7bUVBRTJEO1FBQzNELElBQUksQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFBO1FBQ3RCLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFBO1FBQ2pCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxhQUFhLENBQUE7UUFFdkMsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNaLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENB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QUFDLGtCQUFrQixDQUFBLENBQUMsQ0FBQztJQUVsRCxpQkFBaUI7UUFDZixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUV0QyxJQUFJLENBQUMsS0FBSztZQUFFLE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV0QyxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQzVDOzt1REFFK0M7UUFDL0MsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUVsQyxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUMzQyxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUE7WUFFOUIsSUFBSSxPQUFPLEtBQUssS0FBSyxXQUFXLEVBQUUsQ0FBQztnQkFDakMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUNyQixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBxdWVyeXN0cmluZyBmcm9tIFwicXVlcnlzdHJpbmdcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyQ2xpZW50V2Vic29ja2V0UmVxdWVzdCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5ib2R5XSAtIFJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBbYXJncy5oZWFkZXJzXSAtIEhlYWRlciBsaXN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MubWV0YWRhdGFdIC0gU2Vzc2lvbiBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWV0aG9kIC0gSFRUUCBtZXRob2QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnBhdGggLSBQYXRoLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MucGFyYW1zXSAtIFBhcmFtZXRlcnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucmVtb3RlQWRkcmVzc10gLSBSZW1vdGUgYWRkcmVzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtib2R5LCBoZWFkZXJzLCBtZXRhZGF0YSwgbWV0aG9kLCBwYXJhbXMsIHBhdGgsIHJlbW90ZUFkZHJlc3N9KSB7XG4gICAgaWYgKCFtZXRob2QpIHRocm93IG5ldyBFcnJvcihcIm1ldGhvZCBpcyByZXF1aXJlZFwiKVxuICAgIGlmICghcGF0aCkgdGhyb3cgbmV3IEVycm9yKFwicGF0aCBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5ib2R5ID0gYm9keVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICB0aGlzLmhlYWRlcnNNYXAgPSB7fVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIHRoaXMubWV0YWRhdGFPYmplY3QgPSBtZXRhZGF0YSA/IHsuLi5tZXRhZGF0YX0gOiB7fVxuICAgIHRoaXMubWV0aG9kID0gbWV0aG9kLnRvVXBwZXJDYXNlKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICB0aGlzLnBhcmFtc09iamVjdCA9IHt9XG4gICAgdGhpcy5fcGF0aCA9IHBhdGhcbiAgICB0aGlzLnJlbW90ZUFkZHJlc3NWYWx1ZSA9IHJlbW90ZUFkZHJlc3NcblxuICAgIGlmIChoZWFkZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xuICAgICAgICB0aGlzLmhlYWRlcnNNYXBba2V5LnRvTG93ZXJDYXNlKCldID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocGFyYW1zKSB0aGlzLnBhcmFtc09iamVjdCA9IHsuLi5wYXJhbXN9XG4gICAgaWYgKHRoaXMuYm9keSAmJiB0eXBlb2YgdGhpcy5ib2R5ID09PSBcIm9iamVjdFwiKSB0aGlzLnBhcmFtc09iamVjdCA9IHsuLi50aGlzLnBhcmFtc09iamVjdCwgLi4udGhpcy5ib2R5fVxuICAgIGlmICh0aGlzLmJvZHkgJiYgdHlwZW9mIHRoaXMuYm9keSA9PT0gXCJvYmplY3RcIiAmJiAhdGhpcy5oZWFkZXJzTWFwW1wiY29udGVudC10eXBlXCJdKSB7XG4gICAgICB0aGlzLmhlYWRlcnNNYXBbXCJjb250ZW50LXR5cGVcIl0gPSBcImFwcGxpY2F0aW9uL2pzb25cIlxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gdGhpcy5fcGFyc2VRdWVyeVBhcmFtcygpXG5cbiAgICB0aGlzLnBhcmFtc09iamVjdCA9IHsuLi5xdWVyeVBhcmFtcywgLi4udGhpcy5wYXJhbXNPYmplY3R9XG5cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRoZSBvd25pbmcgY2xpZW50IGNvbm5lY3Rpb24gd2FzIHRvcm4gZG93biB3aGlsZSB0aGlzIHJlcXVlc3RcbiAgICAgKiB3YXMgc3RpbGwgcnVubmluZy4gV2Vic29ja2V0IHJlcXVlc3RzIGFyZSBzZXNzaW9uLW93bmVkIGFuZCBuZXZlclxuICAgICAqIGVudGVyIHRoZSBjbGllbnQncyBpbi1mbGlnaHQgcmVxdWVzdCBsaXN0LCBzbyB0aGlzIHN0YXlzIGZhbHNlIGZvclxuICAgICAqIHRoZW07IHRoZSBmaWVsZCBleGlzdHMgc28gdGhlIHJlcXVlc3QgdW5pb24gc2hhcmVzIG9uZSBzdXJmYWNlLlxuICAgICAqIEB0eXBlIHtib29sZWFufSAqL1xuICAgIHRoaXMuY2xpZW50RGlzY29ubmVjdGVkID0gZmFsc2VcblxuICAgIC8qKiBAdHlwZSB7U2V0PCgpID0+IHZvaWQ+fSAqL1xuICAgIHRoaXMuY2xpZW50RGlzY29ubmVjdENhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHRoaXMgcmVxdWVzdCBhcyBjbGllbnQtZGlzY29ubmVjdGVkIGFuZCBydW5zIGV2ZXJ5IHJlZ2lzdGVyZWRcbiAgICogZGlzY29ubmVjdCBjYWxsYmFjayBleGFjdGx5IG9uY2UuIFRoZSBvd25pbmcgY2xpZW50IGludm9rZXMgaXQgd2hlbiB0aGVcbiAgICogc29ja2V0IHRlYXJzIGRvd247IGhhbmRsZXJzIHRoYXQgcmVnaXN0ZXIgYWZ0ZXJ3YXJkcyBsZWFybiBvZiB0aGVcbiAgICogZGlzY29ubmVjdCB0aHJvdWdoIHRoZSBgY2xpZW50RGlzY29ubmVjdGVkYCBmaWVsZCBpbnN0ZWFkLiBXZWJzb2NrZXRcbiAgICogcmVxdWVzdHMgYXJlIHNlc3Npb24tb3duZWQgYW5kIG5ldmVyIGVudGVyIHRoZSBjbGllbnQncyBpbi1mbGlnaHRcbiAgICogcmVxdWVzdCBsaXN0LCBzbyB0aGlzIGlzIGluZXJ0IGZvciB0aGVtOyB0aGUgc2hhcmVkIHN1cmZhY2Uga2VlcHMgdGhlXG4gICAqIHJlcXVlc3QgdW5pb24gdW5pZm9ybS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBtYXJrQ2xpZW50RGlzY29ubmVjdGVkKCkge1xuICAgIGlmICh0aGlzLmNsaWVudERpc2Nvbm5lY3RlZCkgcmV0dXJuXG4gICAgdGhpcy5jbGllbnREaXNjb25uZWN0ZWQgPSB0cnVlXG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiB0aGlzLmNsaWVudERpc2Nvbm5lY3RDYWxsYmFja3MpIHtcbiAgICAgIGNhbGxiYWNrKClcbiAgICB9XG4gICAgdGhpcy5jbGllbnREaXNjb25uZWN0Q2FsbGJhY2tzLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0aGF0IGZpcmVzIG9uY2Ugd2hlbiB0aGUgY2xpZW50IGNvbm5lY3Rpb24gdGVhcnNcbiAgICogZG93biB3aGlsZSB0aGlzIHJlcXVlc3QgaXMgc3RpbGwgcnVubmluZy4gU2VlIHRoZSBIVFRQIHJlcXVlc3Qnc1xuICAgKiB7QGxpbmtjb2RlIG1hcmtDbGllbnREaXNjb25uZWN0ZWR9IGZvciB0aGUgc2hhcmVkLXN1cmZhY2Ugbm90ZS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBjYWxsYmFjayAtIERpc2Nvbm5lY3QgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgb25DbGllbnREaXNjb25uZWN0KGNhbGxiYWNrKSB7XG4gICAgaWYgKHRoaXMuY2xpZW50RGlzY29ubmVjdGVkKSB7XG4gICAgICBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgdGhpcy5jbGllbnREaXNjb25uZWN0Q2FsbGJhY2tzLmFkZChjYWxsYmFjaylcbiAgfVxuXG4gIGJhc2VVUkwoKSB7XG4gICAgY29uc3QgcHJvdG9jb2wgPSB0aGlzLnByb3RvY29sKClcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0V2l0aFBvcnQoKVxuXG4gICAgaWYgKHByb3RvY29sICYmIGhvc3QpIHJldHVybiBgJHtwcm90b2NvbH06Ly8ke2hvc3R9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEhlYWRlciBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBIZWFkZXIgdmFsdWUuXG4gICAqL1xuICBoZWFkZXIobmFtZSkgeyByZXR1cm4gdGhpcy5oZWFkZXJzTWFwW25hbWUudG9Mb3dlckNhc2UoKV0gfHwgbnVsbCB9XG5cbiAgaGVhZGVycygpIHsgcmV0dXJuIHRoaXMuaGVhZGVyc01hcCB9XG5cbiAgaHR0cE1ldGhvZCgpIHsgcmV0dXJuIHRoaXMubWV0aG9kIH1cblxuICBodHRwVmVyc2lvbigpIHsgcmV0dXJuIFwid2Vic29ja2V0XCIgfVxuXG4gIGhvc3QoKSB7IHJldHVybiB0aGlzLmhlYWRlcihcImhvc3RcIikgfHwgdW5kZWZpbmVkIH1cblxuICAvKipcbiAgICogUnVucyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtrZXldIC0gTWV0YWRhdGEga2V5LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTWV0YWRhdGEgdmFsdWUgZm9yIGEga2V5LCBvciB0aGUgZnVsbCBtZXRhZGF0YSBvYmplY3QuXG4gICAqL1xuICBtZXRhZGF0YShrZXkpIHtcbiAgICBpZiAoa2V5ICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLm1ldGFkYXRhT2JqZWN0W2tleV1cblxuICAgIHJldHVybiB7Li4udGhpcy5tZXRhZGF0YU9iamVjdH1cbiAgfVxuXG4gIGhvc3RXaXRoUG9ydCgpIHtcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0KClcbiAgICBjb25zdCBwb3J0ID0gdGhpcy5wb3J0KClcblxuICAgIGlmICghaG9zdCkgcmV0dXJuXG4gICAgaWYgKCFwb3J0KSByZXR1cm4gaG9zdFxuXG4gICAgcmV0dXJuIGAke2hvc3R9OiR7cG9ydH1gXG4gIH1cblxuICBvcmlnaW4oKSB7IHJldHVybiB0aGlzLmhlYWRlcihcIm9yaWdpblwiKSB9XG5cbiAgcGF0aCgpIHsgcmV0dXJuIHRoaXMuX3BhdGggfVxuXG4gIHBhcmFtcygpIHsgcmV0dXJuIHRoaXMucGFyYW1zT2JqZWN0IH1cblxuICBwb3J0KCkge1xuICAgIGNvbnN0IGhvc3RIZWFkZXIgPSB0aGlzLmhlYWRlcihcImhvc3RcIilcbiAgICBjb25zdCBtYXRjaCA9IGhvc3RIZWFkZXI/Lm1hdGNoKC86KFxcZCspJC8pXG5cbiAgICBpZiAobWF0Y2gpIHJldHVybiBwYXJzZUludChtYXRjaFsxXSlcbiAgfVxuXG4gIHByb3RvY29sKCkge1xuICAgIGNvbnN0IG9yaWdpbiA9IHRoaXMub3JpZ2luKClcbiAgICBjb25zdCBtYXRjaCA9IG9yaWdpbj8ubWF0Y2goL14oLispOlxcL1xcLy8pXG5cbiAgICByZXR1cm4gbWF0Y2g/LlsxXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAtIFBhcnNlZCBxdWVyeSBwYXJhbWV0ZXJzIGZyb20gdGhlIFVSTC5cbiAgICovXG4gIHF1ZXJ5UGFyYW1zKCkgeyByZXR1cm4gdGhpcy5fcGFyc2VRdWVyeVBhcmFtcygpIH1cblxuICByZW1vdGVBZGRyZXNzKCkgeyByZXR1cm4gdGhpcy5yZW1vdGVBZGRyZXNzVmFsdWUgfVxuXG4gIF9wYXJzZVF1ZXJ5UGFyYW1zKCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5fcGF0aC5zcGxpdChcIj9cIilbMV1cblxuICAgIGlmICghcXVlcnkpIHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpXG5cbiAgICBjb25zdCBwYXJzZWRRdWVyeSA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHF1ZXJ5KVxuICAgIC8qKlxuICAgICAqIFBhcmFtcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAqL1xuICAgIGNvbnN0IHBhcmFtcyA9IE9iamVjdC5jcmVhdGUobnVsbClcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHBhcnNlZFF1ZXJ5KSkge1xuICAgICAgY29uc3QgdmFsdWUgPSBwYXJzZWRRdWVyeVtrZXldXG5cbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgcGFyYW1zW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbXNcbiAgfVxufVxuIl19