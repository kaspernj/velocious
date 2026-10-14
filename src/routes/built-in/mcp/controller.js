import Controller from "../../../controller.js"
import {handleMcpRequest} from "../../../mcp/json-rpc-server.js"

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
    const params = this.params()
    const requestContext = buildRequestContextFromHeaders({request: this.request()})
    const response = await handleMcpRequest({
      configuration: this.getConfiguration(),
      request: {
        id: params.id ?? null,
        jsonrpc: params.jsonrpc,
        method: params.method,
        params: typeof params.params === "object" && params.params !== null && !Array.isArray(params.params) ? params.params : undefined
      },
      requestContext
    })

    this._response.setHeader("Content-Type", "application/json; charset=UTF-8")

    if (response === null) {
      // Notifications never carry a JSON-RPC response id; 202 Accepted with an
      // empty body keeps the HTTP transport honest about that.
      this._response.setStatus(202)
      this._response.setBody("")

      return
    }

    this._response.setBody(`${JSON.stringify(response)}\n`)
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
function buildRequestContextFromHeaders({request}) {
  /** @type {Record<string, string | number | boolean>} */
  const context = {}

  const authorization = request.header("authorization")

  if (typeof authorization === "string" && authorization.trim().length > 0) {
    context.authorization = authorization.trim()
  }

  return Object.keys(context).length > 0 ? context : undefined
}
