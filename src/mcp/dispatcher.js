// @ts-check

/**
 * @typedef {object} McpToolResult
 * @property {Array<{text: string, type: "text"}>} content - Tool result content blocks.
 * @property {boolean} isError - Whether the tool call failed.
 */

/**
 * @typedef {object} FrontendModelRequestEntry
 * @property {string} [commandType] - Built-in command type.
 * @property {string} [customPath] - Custom command path.
 * @property {string} model - Backend model name.
 * @property {Record<string, unknown>} payload - Command payload.
 * @property {Record<string, string | number | boolean> | undefined} [requestContext] - Remote request context.
 * @property {string} requestId - Request correlation id.
 */

/**
 * @typedef {Record<string, unknown> & {formatVersion?: number, resources?: Record<string, unknown>}} ApiManifest
 */

/**
 * @typedef {object} ManifestCommandEntry
 * @property {Array<{name: string, type: string}>} [args] - Declared typed command arguments.
 * @property {boolean} [isBuiltIn] - Whether the entry is a synthesized built-in command.
 * @property {string} methodName - Command method name.
 * @property {string} [path] - Manifest command path (member paths carry `<id>`).
 * @property {string | null} [returnType] - Declared JSDoc return type.
 * @property {"collection" | "member"} scope - Command scope.
 */

/**
 * @typedef {object} ManifestResourceEntry
 * @property {Record<string, ManifestCommandEntry[]>} [commands] - Scope-keyed custom command entries.
 * @property {Record<string, Record<string, string>>} [builtInCommands] - Scope-keyed built-in command maps.
 * @property {string} modelName - Backend model name.
 * @property {string | string[]} [primaryKey] - Primary key attribute name(s).
 */

import FrontendModelController from "../frontend-model-controller.js"
import Request from "../http-server/client/request.js"
import Response from "../http-server/client/response.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../frontend-models/transport-serialization.js"
import {generateMcpTools, metaToolName, parseMcpToolName} from "./manifest-tools.js"

const MCP_REQUEST_PATH = "/frontend-models"

/**
 * Lists the MCP tools exposed by a configuration's frontend-model API manifest.
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @returns {Promise<Record<string, unknown>[]>} - MCP `tools/list` tool definitions.
 */
export async function listMcpTools({configuration}) {
  const manifest = /** @type {ApiManifest} */ (await configuration.getApiManifest())

  return generateMcpTools(manifest)
}

/**
 * Executes one MCP `tools/call` against the frontend-model dispatcher.
 * The tool call is translated into the exact shared frontend-model request entry
 * (`commandType`/`customPath`, `model`, `payload`, `requestContext`) and runs
 * through `FrontendModelController.frontendApi()` in-process, so tenant and
 * ability resolution stay inside the owning dispatcher — MCP never bypasses them.
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {Record<string, string | number | boolean> | undefined} [args.requestContext] - Remote request context forwarded to the app's ability/tenant resolvers.
 * @param {Record<string, unknown>} args.toolArguments - Tool arguments from the MCP client.
 * @param {string} args.toolName - MCP tool name.
 * @returns {Promise<McpToolResult>} - MCP tool call result.
 */
export async function callMcpTool({configuration, requestContext, toolArguments, toolName}) {
  const manifest = /** @type {ApiManifest} */ (await configuration.getApiManifest())

  if (toolName === metaToolName()) {
    return textResult({value: manifest})
  }

  const identity = parseMcpToolName({manifest, toolName})

  if (!identity) return errorResult(`Unknown MCP tool '${toolName}'.`)

  const manifestResources = /** @type {Record<string, unknown>} */ (manifest.resources || {})
  const resource = /** @type {ManifestResourceEntry} */ (manifestResources[identity.modelKey])
  const commandEntry = findManifestCommandEntry({commandName: identity.commandName, resource, scope: identity.scope})

  if (!commandEntry) return errorResult(`Manifest command entry missing for tool '${toolName}'.`)

  const requestEntry = buildFrontendModelRequestEntry({commandEntry, model: String(resource.modelName), requestContext, toolArguments})
  const responsePayload = await runFrontendApiRequest({configuration, requestEntry})
  const responseEntry = Array.isArray(responsePayload?.responses) ? responsePayload.responses[0] : undefined
  const commandResponse = responseEntry?.response

  if (!commandResponse) return errorResult("Frontend-model dispatcher returned no response.")

  if (commandResponse.status === "error") {
    return errorResult(commandResponse.errorMessage || "Frontend-model command failed.", commandResponse)
  }

  return textResult({value: commandResponse})
}

/**
 * Finds the manifest command entry matching a parsed tool identity.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command method name.
 * @param {ManifestResourceEntry} args.resource - Manifest resource entry.
 * @param {"collection" | "member"} args.scope - Command scope.
 * @returns {ManifestCommandEntry | undefined} - Manifest command entry.
 */
function findManifestCommandEntry({commandName, resource, scope}) {
  if (resource.builtInCommands?.[scope]?.[commandName]) {
    return {isBuiltIn: true, methodName: commandName, scope}
  }

  const scopeCommands = resource.commands?.[scope]

  if (!Array.isArray(scopeCommands)) return undefined

  return scopeCommands.find((entry) => entry.methodName === commandName)
}

/**
 * Builds the shared frontend-model request entry for one tool call.
 * @param {object} args - Arguments.
 * @param {ManifestCommandEntry} args.commandEntry - Manifest command entry.
 * @param {string} args.model - Backend model name.
 * @param {Record<string, string | number | boolean> | undefined} args.requestContext - Remote request context.
 * @param {Record<string, unknown>} args.toolArguments - Tool arguments.
 * @returns {FrontendModelRequestEntry} - frontendApi request entry.
 */
function buildFrontendModelRequestEntry({commandEntry, model, requestContext, toolArguments}) {
  const isBuiltInCommand = ["attach", "attachmentList", "create", "destroy", "download", "find", "index", "update", "url"].includes(commandEntry.methodName)

  if (isBuiltInCommand) {
    return {
      commandType: commandEntry.methodName,
      model,
      payload: toolArguments,
      requestId: "mcp-1",
      requestContext
    }
  }

  return {
    customPath: resolveCustomCommandPath({commandEntry, toolArguments}),
    model,
    payload: toolArguments,
    requestId: "mcp-1",
    requestContext
  }
}

/**
 * Substitutes the `<id>` placeholder of a manifest command path with the tool's
 * primary key argument, matching the member route the dispatcher resolves.
 * @param {object} args - Arguments.
 * @param {ManifestCommandEntry} args.commandEntry - Manifest command entry (carries `path` and `scope`).
 * @param {Record<string, unknown>} args.toolArguments - Tool arguments.
 * @returns {string} - Custom command path.
 */
function resolveCustomCommandPath({commandEntry, toolArguments}) {
  const path = String(commandEntry.path || "")

  if (!path.includes("<id>")) return path

  const idValue = toolArguments.id ?? toolArguments.recordId

  return path.replace("<id>", encodeURIComponent(String(idValue ?? "")))
}

/**
 * Builds the synthetic HTTP request lines for one MCP dispatch. The request-context
 * `authorization` key is forwarded as the request's `Authorization` header so apps
 * whose ability resolver authenticates from headers (Bearer service tokens or
 * personal access tokens) authenticate MCP tool calls exactly like HTTP calls.
 * Carriage returns and line feeds are stripped so a context value can never inject
 * extra request lines.
 * @param {object} args - Arguments.
 * @param {Record<string, string | number | boolean> | undefined} args.requestContext - Remote request context.
 * @returns {string} - Raw HTTP request head.
 */
export function buildSyntheticRequestLines({requestContext}) {
  const lines = [
    `POST ${MCP_REQUEST_PATH} HTTP/1.1`,
    "Host: velocious-mcp",
    "Content-Length: 0",
  ]

  if (requestContext && typeof requestContext.authorization === "string") {
    const authorization = requestContext.authorization.replace(/[\r\n]/g, "").trim()

    if (authorization.length > 0) lines.push(`Authorization: ${authorization}`)
  }

  lines.push("", "")

  return lines.join("\r\n")
}

/**
 * Runs one frontend-model request entry through the controller in-process,
 * mirroring the synthetic-request pattern used by the controller specs.
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {FrontendModelRequestEntry} args.requestEntry - frontendApi request entry.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Parsed frontendApi response payload.
 */
async function runFrontendApiRequest({configuration, requestEntry}) {
  const client = /** @type {import("../http-server/client/index.js").default} */ ({remoteAddress: "127.0.0.1"})
  const request = new Request({client, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  request.feed(Buffer.from(buildSyntheticRequestLines({requestContext: requestEntry.requestContext}), "utf8"))

  await donePromise

  const response = new Response({configuration})
  const controller = new FrontendModelController({
    action: "frontendApi",
    configuration,
    controller: "frontend-models",
    params: {requests: [requestEntry]},
    request,
    response,
    viewPath: `${configuration.getDirectory()}/src/routes/frontend-models`
  })

  await controller.frontendApi()

  const body = response.getBody()
  const responseText = body === null || body === undefined
    ? ""
    : (typeof body === "string" ? body : Buffer.from(body).toString("utf8"))
  const responseJson = responseText.length > 0 ? JSON.parse(responseText) : {}

  return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(responseJson))
}

/**
 * Wraps a value as an MCP text content result.
 * @param {object} args - Arguments.
 * @param {unknown} args.value - Value to serialize as JSON text.
 * @returns {McpToolResult} - MCP tool result.
 */
function textResult({value}) {
  const serialized = serializeFrontendModelTransportValue(value)

  return {
    content: [{text: JSON.stringify(serialized, null, 2), type: "text"}],
    isError: false
  }
}

/**
 * Builds an MCP error result, optionally including the dispatcher's error
 * payload (validation summaries stay faithful — nothing is swallowed).
 * @param {string} message - Error message.
 * @param {Record<string, unknown>} [payload] - Full dispatcher error payload.
 * @returns {McpToolResult} - MCP tool result.
 */
function errorResult(message, payload) {
  const detail = payload ? `\n${JSON.stringify(payload, null, 2)}` : ""

  return {
    content: [{text: `${message}${detail}`, type: "text"}],
    isError: true
  }
}
