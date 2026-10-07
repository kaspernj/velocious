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
        /**
         * Whether the owning client connection was torn down while this request
         * was still running. Set once by the client on socket teardown and read
         * by handlers that need to settle in-flight work (e.g. admission queue
         * positions) without waiting for the response to be sent.
         * @type {boolean} */
        this.clientDisconnected = false;
        /** @type {Set<() => void>} */
        this.clientDisconnectCallbacks = new Set();
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
    /**
     * Returns exact body bytes for requests whose header-stage body policy selected raw mode.
     * @returns {Buffer} - A copy of the exact request body bytes.
     */
    rawBody() { return this.getRequestBuffer().getRawBody(); }
    socketRemoteAddress() { return this.client?.remoteAddress; }
    /**
     * Marks this request as client-disconnected and runs every registered
     * disconnect callback exactly once. The owning client invokes it when the
     * socket tears down; handlers that register afterwards learn of the
     * disconnect through the `clientDisconnected` field instead.
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
     * down while this request is still running. Buffered requests cannot rely
     * on the streaming response's `onStreamClose` for that: no stream has
     * been opened yet, so a queued request's queue position is otherwise
     * stranded until its admission deadline.
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
    getRequestBuffer() { return this.getRequestParser().getRequestBuffer(); }
    getRequestParser() { return this.requestParser; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLFdBQVcsTUFBTSxhQUFhLENBQUE7QUFDckMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxvQkFBb0IsTUFBTSxzQkFBc0IsQ0FBQTtBQUN2RCxPQUFPLGFBQWEsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUUxRCxNQUFNLENBQUMsT0FBTyxPQUFPLGdDQUFnQztJQUNuRDs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzlDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksYUFBYSxDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUV2RDs7Ozs7NkJBS3FCO1FBQ3JCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxLQUFLLENBQUE7UUFFL0IsOEJBQThCO1FBQzlCLElBQUksQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQzVDLENBQUM7SUFFRCxPQUFPLEtBQUssT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFFbEU7Ozs7T0FJRztJQUNILElBQUksQ0FBQyxJQUFJLElBQUksT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFbkQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxVQUFVLElBQUksT0FBTyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEVBQUUsUUFBUSxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBQ3ZGLE9BQU8sS0FBSyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUM3RCxVQUFVLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUMxRCxXQUFXLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUM1RCxJQUFJLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxDQUFBLENBQUMsQ0FBQztJQUM5Qzs7OztPQUlHO0lBQ0gsUUFBUSxDQUFDLEdBQUc7UUFDVixJQUFJLEdBQUcsS0FBSyxTQUFTO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFFdkMsT0FBTyxFQUFFLENBQUE7SUFDWCxDQUFDO0lBRUQsWUFBWTtRQUNWLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUN4QixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUE7UUFDaEMsSUFBSSxZQUFZLEdBQUcsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQTtRQUVuQyxJQUFJLElBQUksSUFBSSxFQUFFLElBQUksUUFBUSxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ3JDLGFBQWE7UUFDZixDQUFDO2FBQU0sSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLFFBQVEsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUM5QyxhQUFhO1FBQ2YsQ0FBQzthQUFNLElBQUksSUFBSSxFQUFFLENBQUM7WUFDaEIsWUFBWSxJQUFJLElBQUksSUFBSSxFQUFFLENBQUE7UUFDNUIsQ0FBQztRQUVELE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRCxNQUFNLEtBQUssT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUN6QyxJQUFJLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxDQUFBLENBQUMsQ0FBQztJQUM5Qzs7O09BR0c7SUFDSCxNQUFNLEtBQUssT0FBTyxJQUFJLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFDekQsSUFBSSxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFFOUM7OztPQUdHO0lBQ0gsV0FBVztRQUNULE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFdkMsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFdEMsTUFBTSxNQUFNLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN2Qzs7dURBRStDO1FBQy9DLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFbEMsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUNsRCxJQUFJLE9BQU8sS0FBSyxLQUFLLFdBQVcsRUFBRSxDQUFDO2dCQUNqQyxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFBO1lBQ3JCLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBQ0QsUUFBUSxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxXQUFXLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFDdEQsYUFBYTtRQUNYLE9BQU8sb0JBQW9CLENBQUM7WUFDMUIsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO1lBQ2pDLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFO1lBQ3ZCLG1CQUFtQixFQUFFLElBQUksQ0FBQyxtQkFBbUIsRUFBRTtTQUNoRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBQ0Q7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsVUFBVSxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBQ3pELG1CQUFtQixLQUFLLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxhQUFhLENBQUEsQ0FBQyxDQUFDO0lBRTNEOzs7Ozs7T0FNRztJQUNILHNCQUFzQjtRQUNwQixJQUFJLElBQUksQ0FBQyxrQkFBa0I7WUFBRSxPQUFNO1FBQ25DLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUE7UUFDOUIsS0FBSyxNQUFNLFFBQVEsSUFBSSxJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQztZQUN0RCxRQUFRLEVBQUUsQ0FBQTtRQUNaLENBQUM7UUFDRCxJQUFJLENBQUMseUJBQXlCLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsa0JBQWtCLENBQUMsUUFBUTtRQUN6QixJQUFJLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQzVCLFFBQVEsRUFBRSxDQUFBO1lBQ1YsT0FBTTtRQUNSLENBQUM7UUFDRCxJQUFJLENBQUMseUJBQXlCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQzlDLENBQUM7SUFFRCxnQkFBZ0IsS0FBSyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUEsQ0FBQyxDQUFDO0lBQ3hFLGdCQUFnQixLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQSxDQUFDLENBQUM7Q0FDakQiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBxdWVyeXN0cmluZyBmcm9tIFwicXVlcnlzdHJpbmdcIlxuaW1wb3J0IFJlcXVlc3RQYXJzZXIgZnJvbSBcIi4vcmVxdWVzdC1wYXJzZXIuanNcIlxuaW1wb3J0IHJlc29sdmVSZW1vdGVBZGRyZXNzIGZyb20gXCIuLi9yZW1vdGUtYWRkcmVzcy5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudFJlcXVlc3Qge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2xpZW50IC0gQ2xpZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjbGllbnQsIGNvbmZpZ3VyYXRpb24sIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudFxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLnJlcXVlc3RQYXJzZXIgPSBuZXcgUmVxdWVzdFBhcnNlcih7Y29uZmlndXJhdGlvbn0pXG5cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRoZSBvd25pbmcgY2xpZW50IGNvbm5lY3Rpb24gd2FzIHRvcm4gZG93biB3aGlsZSB0aGlzIHJlcXVlc3RcbiAgICAgKiB3YXMgc3RpbGwgcnVubmluZy4gU2V0IG9uY2UgYnkgdGhlIGNsaWVudCBvbiBzb2NrZXQgdGVhcmRvd24gYW5kIHJlYWRcbiAgICAgKiBieSBoYW5kbGVycyB0aGF0IG5lZWQgdG8gc2V0dGxlIGluLWZsaWdodCB3b3JrIChlLmcuIGFkbWlzc2lvbiBxdWV1ZVxuICAgICAqIHBvc2l0aW9ucykgd2l0aG91dCB3YWl0aW5nIGZvciB0aGUgcmVzcG9uc2UgdG8gYmUgc2VudC5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLmNsaWVudERpc2Nvbm5lY3RlZCA9IGZhbHNlXG5cbiAgICAvKiogQHR5cGUge1NldDwoKSA9PiB2b2lkPn0gKi9cbiAgICB0aGlzLmNsaWVudERpc2Nvbm5lY3RDYWxsYmFja3MgPSBuZXcgU2V0KClcbiAgfVxuXG4gIGJhc2VVUkwoKSB7IHJldHVybiBgJHt0aGlzLnByb3RvY29sKCl9Oi8vJHt0aGlzLmhvc3RXaXRoUG9ydCgpfWAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZlZWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7QnVmZmVyIHwgdW5kZWZpbmVkfSAtIFJlbWFpbmluZyBkYXRhLCBpZiBhbnkuXG4gICAqL1xuICBmZWVkKGRhdGEpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5mZWVkKGRhdGEpIH1cblxuICAvKipcbiAgICogUnVucyBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBoZWFkZXJOYW1lIC0gSGVhZGVyIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFRoZSBoZWFkZXIuXG4gICAqL1xuICBoZWFkZXIoaGVhZGVyTmFtZSkgeyByZXR1cm4gdGhpcy5nZXRSZXF1ZXN0QnVmZmVyKCkuZ2V0SGVhZGVyKGhlYWRlck5hbWUpPy5nZXRWYWx1ZSgpIH1cbiAgaGVhZGVycygpIHsgcmV0dXJuIHRoaXMuZ2V0UmVxdWVzdEJ1ZmZlcigpLmdldEhlYWRlcnNIYXNoKCkgfVxuICBodHRwTWV0aG9kKCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyLmdldEh0dHBNZXRob2QoKSB9XG4gIGh0dHBWZXJzaW9uKCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyLmdldEh0dHBWZXJzaW9uKCkgfVxuICBob3N0KCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyLmdldEhvc3QoKSB9XG4gIC8qKlxuICAgKiBSdW5zIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2tleV0gLSBNZXRhZGF0YSBrZXkuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBNZXRhZGF0YSB2YWx1ZSBmb3IgYSBrZXksIG9yIHRoZSBmdWxsIG1ldGFkYXRhIG9iamVjdC5cbiAgICovXG4gIG1ldGFkYXRhKGtleSkge1xuICAgIGlmIChrZXkgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICBob3N0V2l0aFBvcnQoKSB7XG4gICAgY29uc3QgcG9ydCA9IHRoaXMucG9ydCgpXG4gICAgY29uc3QgcHJvdG9jb2wgPSB0aGlzLnByb3RvY29sKClcbiAgICBsZXQgaG9zdFdpdGhQb3J0ID0gYCR7dGhpcy5ob3N0KCl9YFxuXG4gICAgaWYgKHBvcnQgPT0gODAgJiYgcHJvdG9jb2wgPT0gXCJodHRwXCIpIHtcbiAgICAgIC8vIERvIG5vdGhpbmdcbiAgICB9IGVsc2UgaWYgKHBvcnQgPT0gNDQzICYmIHByb3RvY29sID09IFwiaHR0cHNcIikge1xuICAgICAgLy8gRG8gbm90aGluZ1xuICAgIH0gZWxzZSBpZiAocG9ydCkge1xuICAgICAgaG9zdFdpdGhQb3J0ICs9IGA6JHtwb3J0fWBcbiAgICB9XG5cbiAgICByZXR1cm4gaG9zdFdpdGhQb3J0XG4gIH1cblxuICBvcmlnaW4oKSB7IHJldHVybiB0aGlzLmhlYWRlcihcIm9yaWdpblwiKSB9XG4gIHBhdGgoKSB7IHJldHVybiB0aGlzLnJlcXVlc3RQYXJzZXIuZ2V0UGF0aCgpIH1cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRoZSByZXF1ZXN0IHBhcmFtcy5cbiAgICovXG4gIHBhcmFtcygpIHsgcmV0dXJuIGRpZ2codGhpcywgXCJyZXF1ZXN0UGFyc2VyXCIsIFwicGFyYW1zXCIpIH1cbiAgcG9ydCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5nZXRQb3J0KCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gLSBQYXJzZWQgcXVlcnkgcGFyYW1ldGVycyBmcm9tIHRoZSBVUkwuXG4gICAqL1xuICBxdWVyeVBhcmFtcygpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMucGF0aCgpLnNwbGl0KFwiP1wiKVsxXVxuXG4gICAgaWYgKCFxdWVyeSkgcmV0dXJuIE9iamVjdC5jcmVhdGUobnVsbClcblxuICAgIGNvbnN0IHBhcnNlZCA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHF1ZXJ5KVxuICAgIC8qKlxuICAgICAqIFBhcmFtcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSAqL1xuICAgIGNvbnN0IHBhcmFtcyA9IE9iamVjdC5jcmVhdGUobnVsbClcblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBhcnNlZCkpIHtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgcGFyYW1zW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbXNcbiAgfVxuICBwcm90b2NvbCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5nZXRQcm90b2NvbCgpIH1cbiAgcmVtb3RlQWRkcmVzcygpIHtcbiAgICByZXR1cm4gcmVzb2x2ZVJlbW90ZUFkZHJlc3Moe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgaGVhZGVyczogdGhpcy5oZWFkZXJzKCksXG4gICAgICBzb2NrZXRSZW1vdGVBZGRyZXNzOiB0aGlzLnNvY2tldFJlbW90ZUFkZHJlc3MoKVxuICAgIH0pXG4gIH1cbiAgLyoqXG4gICAqIFJldHVybnMgZXhhY3QgYm9keSBieXRlcyBmb3IgcmVxdWVzdHMgd2hvc2UgaGVhZGVyLXN0YWdlIGJvZHkgcG9saWN5IHNlbGVjdGVkIHJhdyBtb2RlLlxuICAgKiBAcmV0dXJucyB7QnVmZmVyfSAtIEEgY29weSBvZiB0aGUgZXhhY3QgcmVxdWVzdCBib2R5IGJ5dGVzLlxuICAgKi9cbiAgcmF3Qm9keSgpIHsgcmV0dXJuIHRoaXMuZ2V0UmVxdWVzdEJ1ZmZlcigpLmdldFJhd0JvZHkoKSB9XG4gIHNvY2tldFJlbW90ZUFkZHJlc3MoKSB7IHJldHVybiB0aGlzLmNsaWVudD8ucmVtb3RlQWRkcmVzcyB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHRoaXMgcmVxdWVzdCBhcyBjbGllbnQtZGlzY29ubmVjdGVkIGFuZCBydW5zIGV2ZXJ5IHJlZ2lzdGVyZWRcbiAgICogZGlzY29ubmVjdCBjYWxsYmFjayBleGFjdGx5IG9uY2UuIFRoZSBvd25pbmcgY2xpZW50IGludm9rZXMgaXQgd2hlbiB0aGVcbiAgICogc29ja2V0IHRlYXJzIGRvd247IGhhbmRsZXJzIHRoYXQgcmVnaXN0ZXIgYWZ0ZXJ3YXJkcyBsZWFybiBvZiB0aGVcbiAgICogZGlzY29ubmVjdCB0aHJvdWdoIHRoZSBgY2xpZW50RGlzY29ubmVjdGVkYCBmaWVsZCBpbnN0ZWFkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG1hcmtDbGllbnREaXNjb25uZWN0ZWQoKSB7XG4gICAgaWYgKHRoaXMuY2xpZW50RGlzY29ubmVjdGVkKSByZXR1cm5cbiAgICB0aGlzLmNsaWVudERpc2Nvbm5lY3RlZCA9IHRydWVcbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIHRoaXMuY2xpZW50RGlzY29ubmVjdENhbGxiYWNrcykge1xuICAgICAgY2FsbGJhY2soKVxuICAgIH1cbiAgICB0aGlzLmNsaWVudERpc2Nvbm5lY3RDYWxsYmFja3MuY2xlYXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIHRoYXQgZmlyZXMgb25jZSB3aGVuIHRoZSBjbGllbnQgY29ubmVjdGlvbiB0ZWFyc1xuICAgKiBkb3duIHdoaWxlIHRoaXMgcmVxdWVzdCBpcyBzdGlsbCBydW5uaW5nLiBCdWZmZXJlZCByZXF1ZXN0cyBjYW5ub3QgcmVseVxuICAgKiBvbiB0aGUgc3RyZWFtaW5nIHJlc3BvbnNlJ3MgYG9uU3RyZWFtQ2xvc2VgIGZvciB0aGF0OiBubyBzdHJlYW0gaGFzXG4gICAqIGJlZW4gb3BlbmVkIHlldCwgc28gYSBxdWV1ZWQgcmVxdWVzdCdzIHF1ZXVlIHBvc2l0aW9uIGlzIG90aGVyd2lzZVxuICAgKiBzdHJhbmRlZCB1bnRpbCBpdHMgYWRtaXNzaW9uIGRlYWRsaW5lLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGNhbGxiYWNrIC0gRGlzY29ubmVjdCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBvbkNsaWVudERpc2Nvbm5lY3QoY2FsbGJhY2spIHtcbiAgICBpZiAodGhpcy5jbGllbnREaXNjb25uZWN0ZWQpIHtcbiAgICAgIGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICB0aGlzLmNsaWVudERpc2Nvbm5lY3RDYWxsYmFja3MuYWRkKGNhbGxiYWNrKVxuICB9XG5cbiAgZ2V0UmVxdWVzdEJ1ZmZlcigpIHsgcmV0dXJuIHRoaXMuZ2V0UmVxdWVzdFBhcnNlcigpLmdldFJlcXVlc3RCdWZmZXIoKSB9XG4gIGdldFJlcXVlc3RQYXJzZXIoKSB7IHJldHVybiB0aGlzLnJlcXVlc3RQYXJzZXIgfVxufVxuIl19