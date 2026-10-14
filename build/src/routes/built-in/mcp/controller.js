import Controller from "../../../controller.js";
import { handleMcpRequest } from "../../../mcp/json-rpc-server.js";
export default class BuiltInMcpController extends Controller {
    /**
     * Runs one JSON-RPC message of the MCP protocol over the HTTP transport.
     * The request body is parsed into params by the HTTP request parser; the
     * JSON-RPC envelope is extracted from it and answered exactly like the stdio
     * transport. The request's `Authorization` header is forwarded as the
     * request-context `authorization` key, so tool calls authenticate through the
     * app's own tenant/ability resolvers just like regular frontend-model calls.
     * @returns {Promise<void>} - Resolves when the JSON-RPC response has been rendered.
     */
    async handle() {
        const params = this.params();
        const requestContext = buildRequestContextFromHeaders({ request: this.request() });
        const response = await handleMcpRequest({
            configuration: this.getConfiguration(),
            request: {
                id: params.id ?? null,
                jsonrpc: params.jsonrpc,
                method: params.method,
                params: typeof params.params === "object" && params.params !== null && !Array.isArray(params.params) ? params.params : undefined
            },
            requestContext
        });
        this._response.setHeader("Content-Type", "application/json; charset=UTF-8");
        if (response === null) {
            // Notifications never carry a JSON-RPC response id; 202 Accepted with an
            // empty body keeps the HTTP transport honest about that.
            this._response.setStatus(202);
            this._response.setBody("");
            return;
        }
        this._response.setBody(`${JSON.stringify(response)}\n`);
    }
}
/**
 * Builds the remote request context forwarded to every tool call from the
 * incoming HTTP request headers. The `Authorization` header becomes the
 * request-context `authorization` key, which the MCP dispatcher forwards as
 * the Authorization header of the synthetic in-process frontend-model request.
 * @param {object} args - Arguments.
 * @param {import("../../../http-server/client/request.js").default} args.request - Incoming HTTP request.
 * @returns {Record<string, string | number | boolean> | undefined} - Request context, or undefined when no headers carry context.
 */
function buildRequestContextFromHeaders({ request }) {
    /** @type {Record<string, string | number | boolean>} */
    const context = {};
    const authorization = request.header("authorization");
    if (typeof authorization === "string" && authorization.trim().length > 0) {
        context.authorization = authorization.trim();
    }
    return Object.keys(context).length > 0 ? context : undefined;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXMvYnVpbHQtaW4vbWNwL2NvbnRyb2xsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxVQUFVLE1BQU0sd0JBQXdCLENBQUE7QUFDL0MsT0FBTyxFQUFDLGdCQUFnQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFFaEUsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQkFBcUIsU0FBUSxVQUFVO0lBQzFEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7UUFDNUIsTUFBTSxjQUFjLEdBQUcsOEJBQThCLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUNoRixNQUFNLFFBQVEsR0FBRyxNQUFNLGdCQUFnQixDQUFDO1lBQ3RDLGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7WUFDdEMsT0FBTyxFQUFFO2dCQUNQLEVBQUUsRUFBRSxNQUFNLENBQUMsRUFBRSxJQUFJLElBQUk7Z0JBQ3JCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTztnQkFDdkIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO2dCQUNyQixNQUFNLEVBQUUsT0FBTyxNQUFNLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxTQUFTO2FBQ2pJO1lBQ0QsY0FBYztTQUNmLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLGNBQWMsRUFBRSxpQ0FBaUMsQ0FBQyxDQUFBO1FBRTNFLElBQUksUUFBUSxLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3RCLHlFQUF5RTtZQUN6RSx5REFBeUQ7WUFDekQsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUE7WUFDN0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUE7WUFFMUIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3pELENBQUM7Q0FDRjtBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsU0FBUyw4QkFBOEIsQ0FBQyxFQUFDLE9BQU8sRUFBQztJQUMvQyx3REFBd0Q7SUFDeEQsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBO0lBRWxCLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLENBQUE7SUFFckQsSUFBSSxPQUFPLGFBQWEsS0FBSyxRQUFRLElBQUksYUFBYSxDQUFDLElBQUksRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN6RSxPQUFPLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtJQUM5QyxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO0FBQzlELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQ29udHJvbGxlciBmcm9tIFwiLi4vLi4vLi4vY29udHJvbGxlci5qc1wiXG5pbXBvcnQge2hhbmRsZU1jcFJlcXVlc3R9IGZyb20gXCIuLi8uLi8uLi9tY3AvanNvbi1ycGMtc2VydmVyLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQnVpbHRJbk1jcENvbnRyb2xsZXIgZXh0ZW5kcyBDb250cm9sbGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgb25lIEpTT04tUlBDIG1lc3NhZ2Ugb2YgdGhlIE1DUCBwcm90b2NvbCBvdmVyIHRoZSBIVFRQIHRyYW5zcG9ydC5cbiAgICogVGhlIHJlcXVlc3QgYm9keSBpcyBwYXJzZWQgaW50byBwYXJhbXMgYnkgdGhlIEhUVFAgcmVxdWVzdCBwYXJzZXI7IHRoZVxuICAgKiBKU09OLVJQQyBlbnZlbG9wZSBpcyBleHRyYWN0ZWQgZnJvbSBpdCBhbmQgYW5zd2VyZWQgZXhhY3RseSBsaWtlIHRoZSBzdGRpb1xuICAgKiB0cmFuc3BvcnQuIFRoZSByZXF1ZXN0J3MgYEF1dGhvcml6YXRpb25gIGhlYWRlciBpcyBmb3J3YXJkZWQgYXMgdGhlXG4gICAqIHJlcXVlc3QtY29udGV4dCBgYXV0aG9yaXphdGlvbmAga2V5LCBzbyB0b29sIGNhbGxzIGF1dGhlbnRpY2F0ZSB0aHJvdWdoIHRoZVxuICAgKiBhcHAncyBvd24gdGVuYW50L2FiaWxpdHkgcmVzb2x2ZXJzIGp1c3QgbGlrZSByZWd1bGFyIGZyb250ZW5kLW1vZGVsIGNhbGxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBKU09OLVJQQyByZXNwb25zZSBoYXMgYmVlbiByZW5kZXJlZC5cbiAgICovXG4gIGFzeW5jIGhhbmRsZSgpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLnBhcmFtcygpXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBidWlsZFJlcXVlc3RDb250ZXh0RnJvbUhlYWRlcnMoe3JlcXVlc3Q6IHRoaXMucmVxdWVzdCgpfSlcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhbmRsZU1jcFJlcXVlc3Qoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICByZXF1ZXN0OiB7XG4gICAgICAgIGlkOiBwYXJhbXMuaWQgPz8gbnVsbCxcbiAgICAgICAganNvbnJwYzogcGFyYW1zLmpzb25ycGMsXG4gICAgICAgIG1ldGhvZDogcGFyYW1zLm1ldGhvZCxcbiAgICAgICAgcGFyYW1zOiB0eXBlb2YgcGFyYW1zLnBhcmFtcyA9PT0gXCJvYmplY3RcIiAmJiBwYXJhbXMucGFyYW1zICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHBhcmFtcy5wYXJhbXMpID8gcGFyYW1zLnBhcmFtcyA6IHVuZGVmaW5lZFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3RDb250ZXh0XG4gICAgfSlcblxuICAgIHRoaXMuX3Jlc3BvbnNlLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9VVRGLThcIilcblxuICAgIGlmIChyZXNwb25zZSA9PT0gbnVsbCkge1xuICAgICAgLy8gTm90aWZpY2F0aW9ucyBuZXZlciBjYXJyeSBhIEpTT04tUlBDIHJlc3BvbnNlIGlkOyAyMDIgQWNjZXB0ZWQgd2l0aCBhblxuICAgICAgLy8gZW1wdHkgYm9keSBrZWVwcyB0aGUgSFRUUCB0cmFuc3BvcnQgaG9uZXN0IGFib3V0IHRoYXQuXG4gICAgICB0aGlzLl9yZXNwb25zZS5zZXRTdGF0dXMoMjAyKVxuICAgICAgdGhpcy5fcmVzcG9uc2Uuc2V0Qm9keShcIlwiKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZXNwb25zZS5zZXRCb2R5KGAke0pTT04uc3RyaW5naWZ5KHJlc3BvbnNlKX1cXG5gKVxuICB9XG59XG5cbi8qKlxuICogQnVpbGRzIHRoZSByZW1vdGUgcmVxdWVzdCBjb250ZXh0IGZvcndhcmRlZCB0byBldmVyeSB0b29sIGNhbGwgZnJvbSB0aGVcbiAqIGluY29taW5nIEhUVFAgcmVxdWVzdCBoZWFkZXJzLiBUaGUgYEF1dGhvcml6YXRpb25gIGhlYWRlciBiZWNvbWVzIHRoZVxuICogcmVxdWVzdC1jb250ZXh0IGBhdXRob3JpemF0aW9uYCBrZXksIHdoaWNoIHRoZSBNQ1AgZGlzcGF0Y2hlciBmb3J3YXJkcyBhc1xuICogdGhlIEF1dGhvcml6YXRpb24gaGVhZGVyIG9mIHRoZSBzeW50aGV0aWMgaW4tcHJvY2VzcyBmcm9udGVuZC1tb2RlbCByZXF1ZXN0LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uLy4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVxdWVzdCAtIEluY29taW5nIEhUVFAgcmVxdWVzdC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPiB8IHVuZGVmaW5lZH0gLSBSZXF1ZXN0IGNvbnRleHQsIG9yIHVuZGVmaW5lZCB3aGVuIG5vIGhlYWRlcnMgY2FycnkgY29udGV4dC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRSZXF1ZXN0Q29udGV4dEZyb21IZWFkZXJzKHtyZXF1ZXN0fSkge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+fSAqL1xuICBjb25zdCBjb250ZXh0ID0ge31cblxuICBjb25zdCBhdXRob3JpemF0aW9uID0gcmVxdWVzdC5oZWFkZXIoXCJhdXRob3JpemF0aW9uXCIpXG5cbiAgaWYgKHR5cGVvZiBhdXRob3JpemF0aW9uID09PSBcInN0cmluZ1wiICYmIGF1dGhvcml6YXRpb24udHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICBjb250ZXh0LmF1dGhvcml6YXRpb24gPSBhdXRob3JpemF0aW9uLnRyaW0oKVxuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKGNvbnRleHQpLmxlbmd0aCA+IDAgPyBjb250ZXh0IDogdW5kZWZpbmVkXG59XG4iXX0=