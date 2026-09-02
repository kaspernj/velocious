// @ts-check
import { bearerToken, constantTimeEqual } from "../../utils/bearer-token.js";
/**
 * Runs is loopback.
 * @param {string | undefined} remoteAddress - Remote address.
 * @returns {boolean} - Whether the address is loopback.
 */
function isLoopback(remoteAddress) {
    if (!remoteAddress)
        return false;
    return (remoteAddress === "127.0.0.1" ||
        remoteAddress === "::1" ||
        remoteAddress === "::ffff:127.0.0.1" ||
        remoteAddress.startsWith("127."));
}
/**
 * Decides whether a jobs-dashboard request is authorized. Order of precedence:
 * a matching bearer token, then the host-supplied `authorize` callback. When
 * neither tokens nor an authorize callback are configured, access falls back to
 * loopback-only so a freshly mounted dashboard is reachable on the same host
 * during development without being exposed to the network.
 * @param {object} args - Options.
 * @param {import("./registry.js").JobsMountOptions} args.options - Mount options.
 * @param {import("../../http-server/client/request.js").default | import("../../http-server/client/websocket-request.js").default} args.request - Request object.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {import("../../authorization/ability.js").default | undefined} args.ability - Current ability.
 * @param {string | null} [args.token] - Explicit websocket subscription token.
 * @returns {Promise<boolean>} - Whether the request is authorized.
 */
export async function authorizeJobsRequest({ ability, configuration, options, request, token: explicitToken }) {
    const accessTokens = Array.isArray(options.accessTokens)
        ? options.accessTokens.filter((token) => typeof token === "string" && token.length > 0)
        : [];
    const authorize = typeof options.authorize === "function" ? options.authorize : null;
    const token = explicitToken ?? bearerToken(request);
    if (accessTokens.length > 0 && token) {
        for (const accessToken of accessTokens) {
            if (constantTimeEqual(token, accessToken))
                return true;
        }
    }
    if (authorize) {
        const result = await authorize({ ability, configuration, request, token });
        if (result === true)
            return true;
    }
    if (accessTokens.length === 0 && !authorize) {
        return isLoopback(request.remoteAddress());
    }
    return false;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aG9yaXphdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvd2ViL2F1dGhvcml6YXRpb24uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxXQUFXLEVBQUUsaUJBQWlCLEVBQUMsTUFBTSw2QkFBNkIsQ0FBQTtBQUUxRTs7OztHQUlHO0FBQ0gsU0FBUyxVQUFVLENBQUMsYUFBYTtJQUMvQixJQUFJLENBQUMsYUFBYTtRQUFFLE9BQU8sS0FBSyxDQUFBO0lBRWhDLE9BQU8sQ0FDTCxhQUFhLEtBQUssV0FBVztRQUM3QixhQUFhLEtBQUssS0FBSztRQUN2QixhQUFhLEtBQUssa0JBQWtCO1FBQ3BDLGFBQWEsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQ2pDLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsb0JBQW9CLENBQUMsRUFBQyxPQUFPLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBQztJQUN6RyxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUM7UUFDdEQsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7UUFDdkYsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUNOLE1BQU0sU0FBUyxHQUFHLE9BQU8sT0FBTyxDQUFDLFNBQVMsS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtJQUNwRixNQUFNLEtBQUssR0FBRyxhQUFhLElBQUksV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBRW5ELElBQUksWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksS0FBSyxFQUFFLENBQUM7UUFDckMsS0FBSyxNQUFNLFdBQVcsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUN2QyxJQUFJLGlCQUFpQixDQUFDLEtBQUssRUFBRSxXQUFXLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7UUFDeEQsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLFNBQVMsRUFBRSxDQUFDO1FBQ2QsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsRUFBQyxPQUFPLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBRXhFLElBQUksTUFBTSxLQUFLLElBQUk7WUFBRSxPQUFPLElBQUksQ0FBQTtJQUNsQyxDQUFDO0lBRUQsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQzVDLE9BQU8sVUFBVSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFBO0lBQzVDLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtiZWFyZXJUb2tlbiwgY29uc3RhbnRUaW1lRXF1YWx9IGZyb20gXCIuLi8uLi91dGlscy9iZWFyZXItdG9rZW4uanNcIlxuXG4vKipcbiAqIFJ1bnMgaXMgbG9vcGJhY2suXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gcmVtb3RlQWRkcmVzcyAtIFJlbW90ZSBhZGRyZXNzLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYWRkcmVzcyBpcyBsb29wYmFjay5cbiAqL1xuZnVuY3Rpb24gaXNMb29wYmFjayhyZW1vdGVBZGRyZXNzKSB7XG4gIGlmICghcmVtb3RlQWRkcmVzcykgcmV0dXJuIGZhbHNlXG5cbiAgcmV0dXJuIChcbiAgICByZW1vdGVBZGRyZXNzID09PSBcIjEyNy4wLjAuMVwiIHx8XG4gICAgcmVtb3RlQWRkcmVzcyA9PT0gXCI6OjFcIiB8fFxuICAgIHJlbW90ZUFkZHJlc3MgPT09IFwiOjpmZmZmOjEyNy4wLjAuMVwiIHx8XG4gICAgcmVtb3RlQWRkcmVzcy5zdGFydHNXaXRoKFwiMTI3LlwiKVxuICApXG59XG5cbi8qKlxuICogRGVjaWRlcyB3aGV0aGVyIGEgam9icy1kYXNoYm9hcmQgcmVxdWVzdCBpcyBhdXRob3JpemVkLiBPcmRlciBvZiBwcmVjZWRlbmNlOlxuICogYSBtYXRjaGluZyBiZWFyZXIgdG9rZW4sIHRoZW4gdGhlIGhvc3Qtc3VwcGxpZWQgYGF1dGhvcml6ZWAgY2FsbGJhY2suIFdoZW5cbiAqIG5laXRoZXIgdG9rZW5zIG5vciBhbiBhdXRob3JpemUgY2FsbGJhY2sgYXJlIGNvbmZpZ3VyZWQsIGFjY2VzcyBmYWxscyBiYWNrIHRvXG4gKiBsb29wYmFjay1vbmx5IHNvIGEgZnJlc2hseSBtb3VudGVkIGRhc2hib2FyZCBpcyByZWFjaGFibGUgb24gdGhlIHNhbWUgaG9zdFxuICogZHVyaW5nIGRldmVsb3BtZW50IHdpdGhvdXQgYmVpbmcgZXhwb3NlZCB0byB0aGUgbmV0d29yay5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZWdpc3RyeS5qc1wiKS5Kb2JzTW91bnRPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBNb3VudCBvcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFthcmdzLnRva2VuXSAtIEV4cGxpY2l0IHdlYnNvY2tldCBzdWJzY3JpcHRpb24gdG9rZW4uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IGlzIGF1dGhvcml6ZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhdXRob3JpemVKb2JzUmVxdWVzdCh7YWJpbGl0eSwgY29uZmlndXJhdGlvbiwgb3B0aW9ucywgcmVxdWVzdCwgdG9rZW46IGV4cGxpY2l0VG9rZW59KSB7XG4gIGNvbnN0IGFjY2Vzc1Rva2VucyA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5hY2Nlc3NUb2tlbnMpXG4gICAgPyBvcHRpb25zLmFjY2Vzc1Rva2Vucy5maWx0ZXIoKHRva2VuKSA9PiB0eXBlb2YgdG9rZW4gPT09IFwic3RyaW5nXCIgJiYgdG9rZW4ubGVuZ3RoID4gMClcbiAgICA6IFtdXG4gIGNvbnN0IGF1dGhvcml6ZSA9IHR5cGVvZiBvcHRpb25zLmF1dGhvcml6ZSA9PT0gXCJmdW5jdGlvblwiID8gb3B0aW9ucy5hdXRob3JpemUgOiBudWxsXG4gIGNvbnN0IHRva2VuID0gZXhwbGljaXRUb2tlbiA/PyBiZWFyZXJUb2tlbihyZXF1ZXN0KVxuXG4gIGlmIChhY2Nlc3NUb2tlbnMubGVuZ3RoID4gMCAmJiB0b2tlbikge1xuICAgIGZvciAoY29uc3QgYWNjZXNzVG9rZW4gb2YgYWNjZXNzVG9rZW5zKSB7XG4gICAgICBpZiAoY29uc3RhbnRUaW1lRXF1YWwodG9rZW4sIGFjY2Vzc1Rva2VuKSkgcmV0dXJuIHRydWVcbiAgICB9XG4gIH1cblxuICBpZiAoYXV0aG9yaXplKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgYXV0aG9yaXplKHthYmlsaXR5LCBjb25maWd1cmF0aW9uLCByZXF1ZXN0LCB0b2tlbn0pXG5cbiAgICBpZiAocmVzdWx0ID09PSB0cnVlKSByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgaWYgKGFjY2Vzc1Rva2Vucy5sZW5ndGggPT09IDAgJiYgIWF1dGhvcml6ZSkge1xuICAgIHJldHVybiBpc0xvb3BiYWNrKHJlcXVlc3QucmVtb3RlQWRkcmVzcygpKVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlXG59XG4iXX0=