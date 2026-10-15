import Controller from "../../../controller.js";
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
    handle(): Promise<void>;
}
//# sourceMappingURL=controller.d.ts.map