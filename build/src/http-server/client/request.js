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
    /**
     * Returns exact body bytes for requests whose header-stage body policy selected raw mode.
     * @returns {Buffer} - A copy of the exact request body bytes.
     */
    rawBody() { return this.getRequestBuffer().getRawBody(); }
    socketRemoteAddress() { return this.client?.remoteAddress; }
    getRequestBuffer() { return this.getRequestParser().getRequestBuffer(); }
    getRequestParser() { return this.requestParser; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLFdBQVcsTUFBTSxhQUFhLENBQUE7QUFDckMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxvQkFBb0IsTUFBTSxzQkFBc0IsQ0FBQTtBQUN2RCxPQUFPLGFBQWEsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUUxRCxNQUFNLENBQUMsT0FBTyxPQUFPLGdDQUFnQztJQUNuRDs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzlDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksYUFBYSxDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtJQUN6RCxDQUFDO0lBRUQsT0FBTyxLQUFLLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLE1BQU0sSUFBSSxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRWxFOzs7O09BSUc7SUFDSCxJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5EOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsVUFBVSxJQUFJLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxFQUFFLFFBQVEsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUN2RixPQUFPLEtBQUssT0FBTyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxjQUFjLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFDN0QsVUFBVSxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFDMUQsV0FBVyxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFDNUQsSUFBSSxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFDOUM7Ozs7T0FJRztJQUNILFFBQVEsQ0FBQyxHQUFHO1FBQ1YsSUFBSSxHQUFHLEtBQUssU0FBUztZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRXZDLE9BQU8sRUFBRSxDQUFBO0lBQ1gsQ0FBQztJQUVELFlBQVk7UUFDVixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDeEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFBO1FBQ2hDLElBQUksWUFBWSxHQUFHLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUE7UUFFbkMsSUFBSSxJQUFJLElBQUksRUFBRSxJQUFJLFFBQVEsSUFBSSxNQUFNLEVBQUUsQ0FBQztZQUNyQyxhQUFhO1FBQ2YsQ0FBQzthQUFNLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxRQUFRLElBQUksT0FBTyxFQUFFLENBQUM7WUFDOUMsYUFBYTtRQUNmLENBQUM7YUFBTSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ2hCLFlBQVksSUFBSSxJQUFJLElBQUksRUFBRSxDQUFBO1FBQzVCLENBQUM7UUFFRCxPQUFPLFlBQVksQ0FBQTtJQUNyQixDQUFDO0lBRUQsTUFBTSxLQUFLLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFDekMsSUFBSSxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFDOUM7OztPQUdHO0lBQ0gsTUFBTSxLQUFLLE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsUUFBUSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBQ3pELElBQUksS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRTlDOzs7T0FHRztJQUNILFdBQVc7UUFDVCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXZDLElBQUksQ0FBQyxLQUFLO1lBQUUsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRXRDLE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDdkM7O3VEQUUrQztRQUMvQyxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRWxDLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDbEQsSUFBSSxPQUFPLEtBQUssS0FBSyxXQUFXLEVBQUUsQ0FBQztnQkFDakMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUNyQixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUNELFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBQ3RELGFBQWE7UUFDWCxPQUFPLG9CQUFvQixDQUFDO1lBQzFCLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtZQUNqQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUN2QixtQkFBbUIsRUFBRSxJQUFJLENBQUMsbUJBQW1CLEVBQUU7U0FDaEQsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUNEOzs7T0FHRztJQUNILE9BQU8sS0FBSyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLFVBQVUsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUN6RCxtQkFBbUIsS0FBSyxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsYUFBYSxDQUFBLENBQUMsQ0FBQztJQUUzRCxnQkFBZ0IsS0FBSyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUEsQ0FBQyxDQUFDO0lBQ3hFLGdCQUFnQixLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQSxDQUFDLENBQUM7Q0FDakQiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBxdWVyeXN0cmluZyBmcm9tIFwicXVlcnlzdHJpbmdcIlxuaW1wb3J0IFJlcXVlc3RQYXJzZXIgZnJvbSBcIi4vcmVxdWVzdC1wYXJzZXIuanNcIlxuaW1wb3J0IHJlc29sdmVSZW1vdGVBZGRyZXNzIGZyb20gXCIuLi9yZW1vdGUtYWRkcmVzcy5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudFJlcXVlc3Qge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2xpZW50IC0gQ2xpZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjbGllbnQsIGNvbmZpZ3VyYXRpb24sIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudFxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLnJlcXVlc3RQYXJzZXIgPSBuZXcgUmVxdWVzdFBhcnNlcih7Y29uZmlndXJhdGlvbn0pXG4gIH1cblxuICBiYXNlVVJMKCkgeyByZXR1cm4gYCR7dGhpcy5wcm90b2NvbCgpfTovLyR7dGhpcy5ob3N0V2l0aFBvcnQoKX1gIH1cblxuICAvKipcbiAgICogUnVucyBmZWVkLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge0J1ZmZlciB8IHVuZGVmaW5lZH0gLSBSZW1haW5pbmcgZGF0YSwgaWYgYW55LlxuICAgKi9cbiAgZmVlZChkYXRhKSB7IHJldHVybiB0aGlzLnJlcXVlc3RQYXJzZXIuZmVlZChkYXRhKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaGVhZGVyTmFtZSAtIEhlYWRlciBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBUaGUgaGVhZGVyLlxuICAgKi9cbiAgaGVhZGVyKGhlYWRlck5hbWUpIHsgcmV0dXJuIHRoaXMuZ2V0UmVxdWVzdEJ1ZmZlcigpLmdldEhlYWRlcihoZWFkZXJOYW1lKT8uZ2V0VmFsdWUoKSB9XG4gIGhlYWRlcnMoKSB7IHJldHVybiB0aGlzLmdldFJlcXVlc3RCdWZmZXIoKS5nZXRIZWFkZXJzSGFzaCgpIH1cbiAgaHR0cE1ldGhvZCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5nZXRIdHRwTWV0aG9kKCkgfVxuICBodHRwVmVyc2lvbigpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5nZXRIdHRwVmVyc2lvbigpIH1cbiAgaG9zdCgpIHsgcmV0dXJuIHRoaXMucmVxdWVzdFBhcnNlci5nZXRIb3N0KCkgfVxuICAvKipcbiAgICogUnVucyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtrZXldIC0gTWV0YWRhdGEga2V5LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTWV0YWRhdGEgdmFsdWUgZm9yIGEga2V5LCBvciB0aGUgZnVsbCBtZXRhZGF0YSBvYmplY3QuXG4gICAqL1xuICBtZXRhZGF0YShrZXkpIHtcbiAgICBpZiAoa2V5ICE9PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgaG9zdFdpdGhQb3J0KCkge1xuICAgIGNvbnN0IHBvcnQgPSB0aGlzLnBvcnQoKVxuICAgIGNvbnN0IHByb3RvY29sID0gdGhpcy5wcm90b2NvbCgpXG4gICAgbGV0IGhvc3RXaXRoUG9ydCA9IGAke3RoaXMuaG9zdCgpfWBcblxuICAgIGlmIChwb3J0ID09IDgwICYmIHByb3RvY29sID09IFwiaHR0cFwiKSB7XG4gICAgICAvLyBEbyBub3RoaW5nXG4gICAgfSBlbHNlIGlmIChwb3J0ID09IDQ0MyAmJiBwcm90b2NvbCA9PSBcImh0dHBzXCIpIHtcbiAgICAgIC8vIERvIG5vdGhpbmdcbiAgICB9IGVsc2UgaWYgKHBvcnQpIHtcbiAgICAgIGhvc3RXaXRoUG9ydCArPSBgOiR7cG9ydH1gXG4gICAgfVxuXG4gICAgcmV0dXJuIGhvc3RXaXRoUG9ydFxuICB9XG5cbiAgb3JpZ2luKCkgeyByZXR1cm4gdGhpcy5oZWFkZXIoXCJvcmlnaW5cIikgfVxuICBwYXRoKCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyLmdldFBhdGgoKSB9XG4gIC8qKlxuICAgKiBSdW5zIHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUaGUgcmVxdWVzdCBwYXJhbXMuXG4gICAqL1xuICBwYXJhbXMoKSB7IHJldHVybiBkaWdnKHRoaXMsIFwicmVxdWVzdFBhcnNlclwiLCBcInBhcmFtc1wiKSB9XG4gIHBvcnQoKSB7IHJldHVybiB0aGlzLnJlcXVlc3RQYXJzZXIuZ2V0UG9ydCgpIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59IC0gUGFyc2VkIHF1ZXJ5IHBhcmFtZXRlcnMgZnJvbSB0aGUgVVJMLlxuICAgKi9cbiAgcXVlcnlQYXJhbXMoKSB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLnBhdGgoKS5zcGxpdChcIj9cIilbMV1cblxuICAgIGlmICghcXVlcnkpIHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpXG5cbiAgICBjb25zdCBwYXJzZWQgPSBxdWVyeXN0cmluZy5wYXJzZShxdWVyeSlcbiAgICAvKipcbiAgICAgKiBQYXJhbXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gKi9cbiAgICBjb25zdCBwYXJhbXMgPSBPYmplY3QuY3JlYXRlKG51bGwpXG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwYXJzZWQpKSB7XG4gICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHBhcmFtc1trZXldID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGFyYW1zXG4gIH1cbiAgcHJvdG9jb2woKSB7IHJldHVybiB0aGlzLnJlcXVlc3RQYXJzZXIuZ2V0UHJvdG9jb2woKSB9XG4gIHJlbW90ZUFkZHJlc3MoKSB7XG4gICAgcmV0dXJuIHJlc29sdmVSZW1vdGVBZGRyZXNzKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIGhlYWRlcnM6IHRoaXMuaGVhZGVycygpLFxuICAgICAgc29ja2V0UmVtb3RlQWRkcmVzczogdGhpcy5zb2NrZXRSZW1vdGVBZGRyZXNzKClcbiAgICB9KVxuICB9XG4gIC8qKlxuICAgKiBSZXR1cm5zIGV4YWN0IGJvZHkgYnl0ZXMgZm9yIHJlcXVlc3RzIHdob3NlIGhlYWRlci1zdGFnZSBib2R5IHBvbGljeSBzZWxlY3RlZCByYXcgbW9kZS5cbiAgICogQHJldHVybnMge0J1ZmZlcn0gLSBBIGNvcHkgb2YgdGhlIGV4YWN0IHJlcXVlc3QgYm9keSBieXRlcy5cbiAgICovXG4gIHJhd0JvZHkoKSB7IHJldHVybiB0aGlzLmdldFJlcXVlc3RCdWZmZXIoKS5nZXRSYXdCb2R5KCkgfVxuICBzb2NrZXRSZW1vdGVBZGRyZXNzKCkgeyByZXR1cm4gdGhpcy5jbGllbnQ/LnJlbW90ZUFkZHJlc3MgfVxuXG4gIGdldFJlcXVlc3RCdWZmZXIoKSB7IHJldHVybiB0aGlzLmdldFJlcXVlc3RQYXJzZXIoKS5nZXRSZXF1ZXN0QnVmZmVyKCkgfVxuICBnZXRSZXF1ZXN0UGFyc2VyKCkgeyByZXR1cm4gdGhpcy5yZXF1ZXN0UGFyc2VyIH1cbn1cbiJdfQ==