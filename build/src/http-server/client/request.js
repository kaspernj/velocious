// @ts-check
import { digg } from "diggerize";
import querystring from "querystring";
import RequestParser from "./request-parser.js";
import resolveRemoteAddress from "../remote-address.js";
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousHttpServerClientRequest {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./index.js").default} args.client - Client instance.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ client, configuration, ...restArgs }) {
        restArgsError(restArgs);
        this.client = client;
        this.configuration = configuration;
        this.requestParser = new RequestParser({ configuration });
    }
    baseURL() { return `${this.protocol()}://${this.hostWithPort()}`; }
    /**
     * Runs feed.
     * @param {Buffer} data - Data payload.
     * @returns {Buffer | undefined} - Remaining data, if any.
     */
    feed(data) { return this.requestParser.feed(data); }
    /**
     * Runs header.
     * @param {string} headerName - Header name.
     * @returns {string | null} - The header.
     */
    header(headerName) { return this.getRequestBuffer().getHeader(headerName)?.getValue(); }
    headers() { return this.getRequestBuffer().getHeadersHash(); }
    httpMethod() { return this.requestParser.getHttpMethod(); }
    httpVersion() { return this.requestParser.getHttpVersion(); }
    host() { return this.requestParser.getHost(); }
    /**
     * Runs metadata.
     * @param {string} [key] - Metadata key.
     * @returns {ReturnType<typeof JSON.parse>} - Metadata value for a key, or the full metadata object.
     */
    metadata(key) {
        if (key !== undefined)
            return undefined;
        return {};
    }
    hostWithPort() {
        const port = this.port();
        const protocol = this.protocol();
        let hostWithPort = `${this.host()}`;
        if (port == 80 && protocol == "http") {
            // Do nothing
        }
        else if (port == 443 && protocol == "https") {
            // Do nothing
        }
        else if (port) {
            hostWithPort += `:${port}`;
        }
        return hostWithPort;
    }
    origin() { return this.header("origin"); }
    path() { return this.requestParser.getPath(); }
    /**
     * Runs params.
     * @returns {Record<string, string | string[] | undefined | Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>>} - The request params.
     */
    params() { return digg(this, "requestParser", "params"); }
    port() { return this.requestParser.getPort(); }
    /**
     * Runs query params.
     * @returns {Record<string, string | string[]>} - Parsed query parameters from the URL.
     */
    queryParams() {
        const query = this.path().split("?")[1];
        if (!query)
            return Object.create(null);
        const parsed = querystring.parse(query);
        /**
         * Params.
         * @type {Record<string, string | string[]>} */
        const params = Object.create(null);
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value !== "undefined") {
                params[key] = value;
            }
        }
        return params;
    }
    protocol() { return this.requestParser.getProtocol(); }
    remoteAddress() {
        return resolveRemoteAddress({
            configuration: this.configuration,
            headers: this.headers(),
            socketRemoteAddress: this.socketRemoteAddress()
        });
    }
    socketRemoteAddress() { return this.client?.remoteAddress; }
    getRequestBuffer() { return this.getRequestParser().getRequestBuffer(); }
    getRequestParser() { return this.requestParser; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLFdBQVcsTUFBTSxhQUFhLENBQUE7QUFDckMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxvQkFBb0IsTUFBTSxzQkFBc0IsQ0FBQTtBQUN2RCxPQUFPLGFBQWEsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUUxRCxNQUFNLENBQUMsT0FBTyxPQUFPLGdDQUFnQztJQUNuRDs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzlDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksYUFBYSxDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtJQUN6RCxDQUFDO0lBRUQsT0FBTyxLQUFLLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLE1BQU0sSUFBSSxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRWxFOzs7O09BSUc7SUFDSCxJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5EOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsVUFBVSxJQUFJLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxFQUFFLFFBQVEsRUFBRSxDQUFBLENBQUMsQ0FB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LEVBQUU7U0FDaEQsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUNELG1CQUFtQixLQUFLLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxhQUFhLENBQUEsQ0FBQyxDQUFDO0lBRTNELGdCQUFnQixLQUFLLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFDeEUsZ0JBQWdCLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFBLENBQUMsQ0FBQztDQUNqRCIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IHF1ZXJ5c3RyaW5nIGZyb20gXCJxdWVyeXN0cmluZ1wiXG5pbXBvcnQgUmVxdWVzdFBhcnNlciBmcm9tIFwiLi9yZXF1ZXN0LXBhcnNlci5qc1wiXG5pbXBvcnQgcmVzb2x2ZVJlbW90ZUFkZHJlc3MgZnJvbSBcIi4uL3JlbW90ZS1hZGRyZXNzLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyQ2xpZW50UmVxdWVzdCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5jbGllbnQgLSBDbGllbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NsaWVudCwgY29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMucmVxdWVzdFBhcnNlciA9IG5ldyBSZXF1ZXN0UGFyc2VyKHtjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIGJhc2VVUkwoKSB7IHJldHVybiBgJHt0aGlzLnByb3RvY29sKCl9Oi8vJHt0aGlzLmhvc3RXaXRoUG9ydCgpfWAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZlZWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7QnVmZmVyIHwgdW5kZWZpbmVkfSAtIFJlbWFpbmluZyBkYXRhLCBpZiBhbnkuXG4gICAqL1xuICBmZWVkKGRhdGEpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5mZWVkKGRhdGEpIH1cblxuICAvKipcbiAgICogUnVucyBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBoZWFkZXJOYW1lIC0gSGVhZGVyIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFRoZSBoZWFkZXIuXG4gICAqL1xuICBoZWFkZXIoaGVhZGVyTmFtZSkgeyByZXR1cm4gdGhpcy5nZXRSZXF1ZXN0QnVmZmVyKCkuZ2V0SGVhZGVyKGhlYWRlck5hbWUpPy5nZXRWYWx1ZSgpIH1cbiAgaGVhZGVycygpIHsgcmV0dXJuIHRoaXMuZ2V0UmVxdWVzdEJ1ZmZlcigpLmdldEhlYWRlcnNIYXNoKCkgfVxuICBodHRwTWV0aG9kKCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyLmdldEh0dHBNZXRob2QoKSB9XG4gIGh0dHBWZXJzaW9uKCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyLmdldEh0dHBWZXJzaW9uKCkgfVxuICBob3N0KCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyLmdldEhvc3QoKSB9XG4gIC8qKlxuICAgKiBSdW5zIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2tleV0gLSBNZXRhZGF0YSBrZXkuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBNZXRhZGF0YSB2YWx1ZSBmb3IgYSBrZXksIG9yIHRoZSBmdWxsIG1ldGFkYXRhIG9iamVjdC5cbiAgICovXG4gIG1ldGFkYXRhKGtleSkge1xuICAgIGlmIChrZXkgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICBob3N0V2l0aFBvcnQoKSB7XG4gICAgY29uc3QgcG9ydCA9IHRoaXMucG9ydCgpXG4gICAgY29uc3QgcHJvdG9jb2wgPSB0aGlzLnByb3RvY29sKClcbiAgICBsZXQgaG9zdFdpdGhQb3J0ID0gYCR7dGhpcy5ob3N0KCl9YFxuXG4gICAgaWYgKHBvcnQgPT0gODAgJiYgcHJvdG9jb2wgPT0gXCJodHRwXCIpIHtcbiAgICAgIC8vIERvIG5vdGhpbmdcbiAgICB9IGVsc2UgaWYgKHBvcnQgPT0gNDQzICYmIHByb3RvY29sID09IFwiaHR0cHNcIikge1xuICAgICAgLy8gRG8gbm90aGluZ1xuICAgIH0gZWxzZSBpZiAocG9ydCkge1xuICAgICAgaG9zdFdpdGhQb3J0ICs9IGA6JHtwb3J0fWBcbiAgICB9XG5cbiAgICByZXR1cm4gaG9zdFdpdGhQb3J0XG4gIH1cblxuICBvcmlnaW4oKSB7IHJldHVybiB0aGlzLmhlYWRlcihcIm9yaWdpblwiKSB9XG4gIHBhdGgoKSB7IHJldHVybiB0aGlzLnJlcXVlc3RQYXJzZXIuZ2V0UGF0aCgpIH1cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRoZSByZXF1ZXN0IHBhcmFtcy5cbiAgICovXG4gIHBhcmFtcygpIHsgcmV0dXJuIGRpZ2codGhpcywgXCJyZXF1ZXN0UGFyc2VyXCIsIFwicGFyYW1zXCIpIH1cbiAgcG9ydCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5nZXRQb3J0KCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gLSBQYXJzZWQgcXVlcnkgcGFyYW1ldGVycyBmcm9tIHRoZSBVUkwuXG4gICAqL1xuICBxdWVyeVBhcmFtcygpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMucGF0aCgpLnNwbGl0KFwiP1wiKVsxXVxuXG4gICAgaWYgKCFxdWVyeSkgcmV0dXJuIE9iamVjdC5jcmVhdGUobnVsbClcblxuICAgIGNvbnN0IHBhcnNlZCA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHF1ZXJ5KVxuICAgIC8qKlxuICAgICAqIFBhcmFtcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAqL1xuICAgIGNvbnN0IHBhcmFtcyA9IE9iamVjdC5jcmVhdGUobnVsbClcblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBhcnNlZCkpIHtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgcGFyYW1zW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbXNcbiAgfVxuICBwcm90b2NvbCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5nZXRQcm90b2NvbCgpIH1cbiAgcmVtb3RlQWRkcmVzcygpIHtcbiAgICByZXR1cm4gcmVzb2x2ZVJlbW90ZUFkZHJlc3Moe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgaGVhZGVyczogdGhpcy5oZWFkZXJzKCksXG4gICAgICBzb2NrZXRSZW1vdGVBZGRyZXNzOiB0aGlzLnNvY2tldFJlbW90ZUFkZHJlc3MoKVxuICAgIH0pXG4gIH1cbiAgc29ja2V0UmVtb3RlQWRkcmVzcygpIHsgcmV0dXJuIHRoaXMuY2xpZW50Py5yZW1vdGVBZGRyZXNzIH1cblxuICBnZXRSZXF1ZXN0QnVmZmVyKCkgeyByZXR1cm4gdGhpcy5nZXRSZXF1ZXN0UGFyc2VyKCkuZ2V0UmVxdWVzdEJ1ZmZlcigpIH1cbiAgZ2V0UmVxdWVzdFBhcnNlcigpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlciB9XG59XG4iXX0=