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
import FrontendModelController from "../frontend-model-controller.js";
import Request from "../http-server/client/request.js";
import Response from "../http-server/client/response.js";
import { deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue } from "../frontend-models/transport-serialization.js";
import { generateMcpTools, metaToolName, parseMcpToolName } from "./manifest-tools.js";
const MCP_REQUEST_PATH = "/frontend-models";
/**
 * Lists the MCP tools exposed by a configuration's frontend-model API manifest.
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @returns {Promise<Record<string, unknown>[]>} - MCP `tools/list` tool definitions.
 */
export async function listMcpTools({ configuration }) {
    const manifest = /** @type {ApiManifest} */ (await configuration.getApiManifest());
    return generateMcpTools(manifest);
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
export async function callMcpTool({ configuration, requestContext, toolArguments, toolName }) {
    const manifest = /** @type {ApiManifest} */ (await configuration.getApiManifest());
    if (toolName === metaToolName()) {
        return textResult({ value: manifest });
    }
    const identity = parseMcpToolName({ manifest, toolName });
    if (!identity)
        return errorResult(`Unknown MCP tool '${toolName}'.`);
    const manifestResources = /** @type {Record<string, unknown>} */ (manifest.resources || {});
    const resource = /** @type {ManifestResourceEntry} */ (manifestResources[identity.modelKey]);
    const commandEntry = findManifestCommandEntry({ commandName: identity.commandName, resource, scope: identity.scope });
    if (!commandEntry)
        return errorResult(`Manifest command entry missing for tool '${toolName}'.`);
    const requestEntry = buildFrontendModelRequestEntry({ commandEntry, model: String(resource.modelName), requestContext, toolArguments });
    const responsePayload = await runFrontendApiRequest({ configuration, requestEntry });
    const responseEntry = Array.isArray(responsePayload?.responses) ? responsePayload.responses[0] : undefined;
    const commandResponse = responseEntry?.response;
    if (!commandResponse)
        return errorResult("Frontend-model dispatcher returned no response.");
    if (commandResponse.status === "error") {
        return errorResult(commandResponse.errorMessage || "Frontend-model command failed.", commandResponse);
    }
    return textResult({ value: commandResponse });
}
/**
 * Finds the manifest command entry matching a parsed tool identity.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command method name.
 * @param {ManifestResourceEntry} args.resource - Manifest resource entry.
 * @param {"collection" | "member"} args.scope - Command scope.
 * @returns {ManifestCommandEntry | undefined} - Manifest command entry.
 */
function findManifestCommandEntry({ commandName, resource, scope }) {
    if (resource.builtInCommands?.[scope]?.[commandName]) {
        return { isBuiltIn: true, methodName: commandName, scope };
    }
    const scopeCommands = resource.commands?.[scope];
    if (!Array.isArray(scopeCommands))
        return undefined;
    return scopeCommands.find((entry) => entry.methodName === commandName);
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
function buildFrontendModelRequestEntry({ commandEntry, model, requestContext, toolArguments }) {
    const isBuiltInCommand = ["attach", "attachmentList", "create", "destroy", "download", "find", "index", "update", "url"].includes(commandEntry.methodName);
    if (isBuiltInCommand) {
        return {
            commandType: commandEntry.methodName,
            model,
            payload: toolArguments,
            requestId: "mcp-1",
            requestContext
        };
    }
    return {
        customPath: resolveCustomCommandPath({ commandEntry, toolArguments }),
        model,
        payload: toolArguments,
        requestId: "mcp-1",
        requestContext
    };
}
/**
 * Substitutes the `<id>` placeholder of a manifest command path with the tool's
 * primary key argument, matching the member route the dispatcher resolves.
 * @param {object} args - Arguments.
 * @param {ManifestCommandEntry} args.commandEntry - Manifest command entry (carries `path` and `scope`).
 * @param {Record<string, unknown>} args.toolArguments - Tool arguments.
 * @returns {string} - Custom command path.
 */
function resolveCustomCommandPath({ commandEntry, toolArguments }) {
    const path = String(commandEntry.path || "");
    if (!path.includes("<id>"))
        return path;
    const idValue = toolArguments.id ?? toolArguments.recordId;
    return path.replace("<id>", encodeURIComponent(String(idValue ?? "")));
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
export function buildSyntheticRequestLines({ requestContext }) {
    const lines = [
        `POST ${MCP_REQUEST_PATH} HTTP/1.1`,
        "Host: velocious-mcp",
        "Content-Length: 0",
    ];
    if (requestContext && typeof requestContext.authorization === "string") {
        const authorization = requestContext.authorization.replace(/[\r\n]/g, "").trim();
        if (authorization.length > 0)
            lines.push(`Authorization: ${authorization}`);
    }
    lines.push("", "");
    return lines.join("\r\n");
}
/**
 * Runs one frontend-model request entry through the controller in-process,
 * mirroring the synthetic-request pattern used by the controller specs.
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {FrontendModelRequestEntry} args.requestEntry - frontendApi request entry.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Parsed frontendApi response payload.
 */
async function runFrontendApiRequest({ configuration, requestEntry }) {
    const client = /** @type {import("../http-server/client/index.js").default} */ ({ remoteAddress: "127.0.0.1" });
    const request = new Request({ client, configuration });
    const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve));
    request.feed(Buffer.from(buildSyntheticRequestLines({ requestContext: requestEntry.requestContext }), "utf8"));
    await donePromise;
    const response = new Response({ configuration });
    const controller = new FrontendModelController({
        action: "frontendApi",
        configuration,
        controller: "frontend-models",
        params: { requests: [requestEntry] },
        request,
        response,
        viewPath: `${configuration.getDirectory()}/src/routes/frontend-models`
    });
    await controller.frontendApi();
    const body = response.getBody();
    const responseText = body === null || body === undefined
        ? ""
        : (typeof body === "string" ? body : Buffer.from(body).toString("utf8"));
    const responseJson = responseText.length > 0 ? JSON.parse(responseText) : {};
    return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(responseJson));
}
/**
 * Wraps a value as an MCP text content result.
 * @param {object} args - Arguments.
 * @param {unknown} args.value - Value to serialize as JSON text.
 * @returns {McpToolResult} - MCP tool result.
 */
function textResult({ value }) {
    const serialized = serializeFrontendModelTransportValue(value);
    return {
        content: [{ text: JSON.stringify(serialized, null, 2), type: "text" }],
        isError: false
    };
}
/**
 * Builds an MCP error result, optionally including the dispatcher's error
 * payload (validation summaries stay faithful — nothing is swallowed).
 * @param {string} message - Error message.
 * @param {Record<string, unknown>} [payload] - Full dispatcher error payload.
 * @returns {McpToolResult} - MCP tool result.
 */
function errorResult(message, payload) {
    const detail = payload ? `\n${JSON.stringify(payload, null, 2)}` : "";
    return {
        content: [{ text: `${message}${detail}`, type: "text" }],
        isError: true
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGF0Y2hlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9tY3AvZGlzcGF0Y2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7O0dBRUc7QUFFSDs7Ozs7Ozs7R0FRRztBQUVIOzs7Ozs7R0FNRztBQUVILE9BQU8sdUJBQXVCLE1BQU0saUNBQWlDLENBQUE7QUFDckUsT0FBTyxPQUFPLE1BQU0sa0NBQWtDLENBQUE7QUFDdEQsT0FBTyxRQUFRLE1BQU0sbUNBQW1DLENBQUE7QUFDeEQsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sK0NBQStDLENBQUE7QUFDMUksT0FBTyxFQUFDLGdCQUFnQixFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBQyxNQUFNLHFCQUFxQixDQUFBO0FBRXBGLE1BQU0sZ0JBQWdCLEdBQUcsa0JBQWtCLENBQUE7QUFFM0M7Ozs7O0dBS0c7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLFlBQVksQ0FBQyxFQUFDLGFBQWEsRUFBQztJQUNoRCxNQUFNLFFBQVEsR0FBRywwQkFBMEIsQ0FBQyxDQUFDLE1BQU0sYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUE7SUFFbEYsT0FBTyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsQ0FBQTtBQUNuQyxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxXQUFXLENBQUMsRUFBQyxhQUFhLEVBQUUsY0FBYyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUM7SUFDeEYsTUFBTSxRQUFRLEdBQUcsMEJBQTBCLENBQUMsQ0FBQyxNQUFNLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFBO0lBRWxGLElBQUksUUFBUSxLQUFLLFlBQVksRUFBRSxFQUFFLENBQUM7UUFDaEMsT0FBTyxVQUFVLENBQUMsRUFBQyxLQUFLLEVBQUUs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LENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxXQUFXLENBQUMsT0FBTyxFQUFFLE9BQU87SUFDbkMsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxLQUFLLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7SUFFckUsT0FBTztRQUNMLE9BQU8sRUFBRSxDQUFDLEVBQUMsSUFBSSxFQUFFLEdBQUcsT0FBTyxHQUFHLE1BQU0sRUFBRSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUMsQ0FBQztRQUN0RCxPQUFPLEVBQUUsSUFBSTtLQUNkLENBQUE7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gTWNwVG9vbFJlc3VsdFxuICogQHByb3BlcnR5IHtBcnJheTx7dGV4dDogc3RyaW5nLCB0eXBlOiBcInRleHRcIn0+fSBjb250ZW50IC0gVG9vbCByZXN1bHQgY29udGVudCBibG9ja3MuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzRXJyb3IgLSBXaGV0aGVyIHRoZSB0b29sIGNhbGwgZmFpbGVkLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlcXVlc3RFbnRyeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb21tYW5kVHlwZV0gLSBCdWlsdC1pbiBjb21tYW5kIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2N1c3RvbVBhdGhdIC0gQ3VzdG9tIGNvbW1hbmQgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbCAtIEJhY2tlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IHBheWxvYWQgLSBDb21tYW5kIHBheWxvYWQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+IHwgdW5kZWZpbmVkfSBbcmVxdWVzdENvbnRleHRdIC0gUmVtb3RlIHJlcXVlc3QgY29udGV4dC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXF1ZXN0SWQgLSBSZXF1ZXN0IGNvcnJlbGF0aW9uIGlkLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIHVua25vd24+ICYge2Zvcm1hdFZlcnNpb24/OiBudW1iZXIsIHJlc291cmNlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gQXBpTWFuaWZlc3RcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IE1hbmlmZXN0Q29tbWFuZEVudHJ5XG4gKiBAcHJvcGVydHkge0FycmF5PHtuYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZ30+fSBbYXJnc10gLSBEZWNsYXJlZCB0eXBlZCBjb21tYW5kIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lzQnVpbHRJbl0gLSBXaGV0aGVyIHRoZSBlbnRyeSBpcyBhIHN5bnRoZXNpemVkIGJ1aWx0LWluIGNvbW1hbmQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbWV0aG9kTmFtZSAtIENvbW1hbmQgbWV0aG9kIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3BhdGhdIC0gTWFuaWZlc3QgY29tbWFuZCBwYXRoIChtZW1iZXIgcGF0aHMgY2FycnkgYDxpZD5gKS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gW3JldHVyblR5cGVdIC0gRGVjbGFyZWQgSlNEb2MgcmV0dXJuIHR5cGUuXG4gKiBAcHJvcGVydHkge1wiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn0gc2NvcGUgLSBDb21tYW5kIHNjb3BlLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gTWFuaWZlc3RSZXNvdXJjZUVudHJ5XG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIE1hbmlmZXN0Q29tbWFuZEVudHJ5W10+fSBbY29tbWFuZHNdIC0gU2NvcGUta2V5ZWQgY3VzdG9tIGNvbW1hbmQgZW50cmllcy5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgc3RyaW5nPj59IFtidWlsdEluQ29tbWFuZHNdIC0gU2NvcGUta2V5ZWQgYnVpbHQtaW4gY29tbWFuZCBtYXBzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsTmFtZSAtIEJhY2tlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgc3RyaW5nW119IFtwcmltYXJ5S2V5XSAtIFByaW1hcnkga2V5IGF0dHJpYnV0ZSBuYW1lKHMpLlxuICovXG5cbmltcG9ydCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiXG5pbXBvcnQgUmVxdWVzdCBmcm9tIFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7Z2VuZXJhdGVNY3BUb29scywgbWV0YVRvb2xOYW1lLCBwYXJzZU1jcFRvb2xOYW1lfSBmcm9tIFwiLi9tYW5pZmVzdC10b29scy5qc1wiXG5cbmNvbnN0IE1DUF9SRVFVRVNUX1BBVEggPSBcIi9mcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIExpc3RzIHRoZSBNQ1AgdG9vbHMgZXhwb3NlZCBieSBhIGNvbmZpZ3VyYXRpb24ncyBmcm9udGVuZC1tb2RlbCBBUEkgbWFuaWZlc3QuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT59IC0gTUNQIGB0b29scy9saXN0YCB0b29sIGRlZmluaXRpb25zLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdE1jcFRvb2xzKHtjb25maWd1cmF0aW9ufSkge1xuICBjb25zdCBtYW5pZmVzdCA9IC8qKiBAdHlwZSB7QXBpTWFuaWZlc3R9ICovIChhd2FpdCBjb25maWd1cmF0aW9uLmdldEFwaU1hbmlmZXN0KCkpXG5cbiAgcmV0dXJuIGdlbmVyYXRlTWNwVG9vbHMobWFuaWZlc3QpXG59XG5cbi8qKlxuICogRXhlY3V0ZXMgb25lIE1DUCBgdG9vbHMvY2FsbGAgYWdhaW5zdCB0aGUgZnJvbnRlbmQtbW9kZWwgZGlzcGF0Y2hlci5cbiAqIFRoZSB0b29sIGNhbGwgaXMgdHJhbnNsYXRlZCBpbnRvIHRoZSBleGFjdCBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdCBlbnRyeVxuICogKGBjb21tYW5kVHlwZWAvYGN1c3RvbVBhdGhgLCBgbW9kZWxgLCBgcGF5bG9hZGAsIGByZXF1ZXN0Q29udGV4dGApIGFuZCBydW5zXG4gKiB0aHJvdWdoIGBGcm9udGVuZE1vZGVsQ29udHJvbGxlci5mcm9udGVuZEFwaSgpYCBpbi1wcm9jZXNzLCBzbyB0ZW5hbnQgYW5kXG4gKiBhYmlsaXR5IHJlc29sdXRpb24gc3RheSBpbnNpZGUgdGhlIG93bmluZyBkaXNwYXRjaGVyIOKAlCBNQ1AgbmV2ZXIgYnlwYXNzZXMgdGhlbS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+IHwgdW5kZWZpbmVkfSBbYXJncy5yZXF1ZXN0Q29udGV4dF0gLSBSZW1vdGUgcmVxdWVzdCBjb250ZXh0IGZvcndhcmRlZCB0byB0aGUgYXBwJ3MgYWJpbGl0eS90ZW5hbnQgcmVzb2x2ZXJzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gYXJncy50b29sQXJndW1lbnRzIC0gVG9vbCBhcmd1bWVudHMgZnJvbSB0aGUgTUNQIGNsaWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRvb2xOYW1lIC0gTUNQIHRvb2wgbmFtZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPE1jcFRvb2xSZXN1bHQ+fSAtIE1DUCB0b29sIGNhbGwgcmVzdWx0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FsbE1jcFRvb2woe2NvbmZpZ3VyYXRpb24sIHJlcXVlc3RDb250ZXh0LCB0b29sQXJndW1lbnRzLCB0b29sTmFtZX0pIHtcbiAgY29uc3QgbWFuaWZlc3QgPSAvKiogQHR5cGUge0FwaU1hbmlmZXN0fSAqLyAoYXdhaXQgY29uZmlndXJhdGlvbi5nZXRBcGlNYW5pZmVzdCgpKVxuXG4gIGlmICh0b29sTmFtZSA9PT0gbWV0YVRvb2xOYW1lKCkpIHtcbiAgICByZXR1cm4gdGV4dFJlc3VsdCh7dmFsdWU6IG1hbmlmZXN0fSlcbiAgfVxuXG4gIGNvbnN0IGlkZW50aXR5ID0gcGFyc2VNY3BUb29sTmFtZSh7bWFuaWZlc3QsIHRvb2xOYW1lfSlcblxuICBpZiAoIWlkZW50aXR5KSByZXR1cm4gZXJyb3JSZXN1bHQoYFVua25vd24gTUNQIHRvb2wgJyR7dG9vbE5hbWV9Jy5gKVxuXG4gIGNvbnN0IG1hbmlmZXN0UmVzb3VyY2VzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKG1hbmlmZXN0LnJlc291cmNlcyB8fCB7fSlcbiAgY29uc3QgcmVzb3VyY2UgPSAvKiogQHR5cGUge01hbmlmZXN0UmVzb3VyY2VFbnRyeX0gKi8gKG1hbmlmZXN0UmVzb3VyY2VzW2lkZW50aXR5Lm1vZGVsS2V5XSlcbiAgY29uc3QgY29tbWFuZEVudHJ5ID0gZmluZE1hbmlmZXN0Q29tbWFuZEVudHJ5KHtjb21tYW5kTmFtZTogaWRlbnRpdHkuY29tbWFuZE5hbWUsIHJlc291cmNlLCBzY29wZTogaWRlbnRpdHkuc2NvcGV9KVxuXG4gIGlmICghY29tbWFuZEVudHJ5KSByZXR1cm4gZXJyb3JSZXN1bHQoYE1hbmlmZXN0IGNvbW1hbmQgZW50cnkgbWlzc2luZyBmb3IgdG9vbCAnJHt0b29sTmFtZX0nLmApXG5cbiAgY29uc3QgcmVxdWVzdEVudHJ5ID0gYnVpbGRGcm9udGVuZE1vZGVsUmVxdWVzdEVudHJ5KHtjb21tYW5kRW50cnksIG1vZGVsOiBTdHJpbmcocmVzb3VyY2UubW9kZWxOYW1lKSwgcmVxdWVzdENvbnRleHQsIHRvb2xBcmd1bWVudHN9KVxuICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBhd2FpdCBydW5Gcm9udGVuZEFwaVJlcXVlc3Qoe2NvbmZpZ3VyYXRpb24sIHJlcXVlc3RFbnRyeX0pXG4gIGNvbnN0IHJlc3BvbnNlRW50cnkgPSBBcnJheS5pc0FycmF5KHJlc3BvbnNlUGF5bG9hZD8ucmVzcG9uc2VzKSA/IHJlc3BvbnNlUGF5bG9hZC5yZXNwb25zZXNbMF0gOiB1bmRlZmluZWRcbiAgY29uc3QgY29tbWFuZFJlc3BvbnNlID0gcmVzcG9uc2VFbnRyeT8ucmVzcG9uc2VcblxuICBpZiAoIWNvbW1hbmRSZXNwb25zZSkgcmV0dXJuIGVycm9yUmVzdWx0KFwiRnJvbnRlbmQtbW9kZWwgZGlzcGF0Y2hlciByZXR1cm5lZCBubyByZXNwb25zZS5cIilcblxuICBpZiAoY29tbWFuZFJlc3BvbnNlLnN0YXR1cyA9PT0gXCJlcnJvclwiKSB7XG4gICAgcmV0dXJuIGVycm9yUmVzdWx0KGNvbW1hbmRSZXNwb25zZS5lcnJvck1lc3NhZ2UgfHwgXCJGcm9udGVuZC1tb2RlbCBjb21tYW5kIGZhaWxlZC5cIiwgY29tbWFuZFJlc3BvbnNlKVxuICB9XG5cbiAgcmV0dXJuIHRleHRSZXN1bHQoe3ZhbHVlOiBjb21tYW5kUmVzcG9uc2V9KVxufVxuXG4vKipcbiAqIEZpbmRzIHRoZSBtYW5pZmVzdCBjb21tYW5kIGVudHJ5IG1hdGNoaW5nIGEgcGFyc2VkIHRvb2wgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBtZXRob2QgbmFtZS5cbiAqIEBwYXJhbSB7TWFuaWZlc3RSZXNvdXJjZUVudHJ5fSBhcmdzLnJlc291cmNlIC0gTWFuaWZlc3QgcmVzb3VyY2UgZW50cnkuXG4gKiBAcGFyYW0ge1wiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn0gYXJncy5zY29wZSAtIENvbW1hbmQgc2NvcGUuXG4gKiBAcmV0dXJucyB7TWFuaWZlc3RDb21tYW5kRW50cnkgfCB1bmRlZmluZWR9IC0gTWFuaWZlc3QgY29tbWFuZCBlbnRyeS5cbiAqL1xuZnVuY3Rpb24gZmluZE1hbmlmZXN0Q29tbWFuZEVudHJ5KHtjb21tYW5kTmFtZSwgcmVzb3VyY2UsIHNjb3BlfSkge1xuICBpZiAocmVzb3VyY2UuYnVpbHRJbkNvbW1hbmRzPy5bc2NvcGVdPy5bY29tbWFuZE5hbWVdKSB7XG4gICAgcmV0dXJuIHtpc0J1aWx0SW46IHRydWUsIG1ldGhvZE5hbWU6IGNvbW1hbmROYW1lLCBzY29wZX1cbiAgfVxuXG4gIGNvbnN0IHNjb3BlQ29tbWFuZHMgPSByZXNvdXJjZS5jb21tYW5kcz8uW3Njb3BlXVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShzY29wZUNvbW1hbmRzKSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiBzY29wZUNvbW1hbmRzLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5tZXRob2ROYW1lID09PSBjb21tYW5kTmFtZSlcbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0IGVudHJ5IGZvciBvbmUgdG9vbCBjYWxsLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge01hbmlmZXN0Q29tbWFuZEVudHJ5fSBhcmdzLmNvbW1hbmRFbnRyeSAtIE1hbmlmZXN0IGNvbW1hbmQgZW50cnkuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbCAtIEJhY2tlbmQgbW9kZWwgbmFtZS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj4gfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdENvbnRleHQgLSBSZW1vdGUgcmVxdWVzdCBjb250ZXh0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gYXJncy50b29sQXJndW1lbnRzIC0gVG9vbCBhcmd1bWVudHMuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlcXVlc3RFbnRyeX0gLSBmcm9udGVuZEFwaSByZXF1ZXN0IGVudHJ5LlxuICovXG5mdW5jdGlvbiBidWlsZEZyb250ZW5kTW9kZWxSZXF1ZXN0RW50cnkoe2NvbW1hbmRFbnRyeSwgbW9kZWwsIHJlcXVlc3RDb250ZXh0LCB0b29sQXJndW1lbnRzfSkge1xuICBjb25zdCBpc0J1aWx0SW5Db21tYW5kID0gW1wiYXR0YWNoXCIsIFwiYXR0YWNobWVudExpc3RcIiwgXCJjcmVhdGVcIiwgXCJkZXN0cm95XCIsIFwiZG93bmxvYWRcIiwgXCJmaW5kXCIsIFwiaW5kZXhcIiwgXCJ1cGRhdGVcIiwgXCJ1cmxcIl0uaW5jbHVkZXMoY29tbWFuZEVudHJ5Lm1ldGhvZE5hbWUpXG5cbiAgaWYgKGlzQnVpbHRJbkNvbW1hbmQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29tbWFuZFR5cGU6IGNvbW1hbmRFbnRyeS5tZXRob2ROYW1lLFxuICAgICAgbW9kZWwsXG4gICAgICBwYXlsb2FkOiB0b29sQXJndW1lbnRzLFxuICAgICAgcmVxdWVzdElkOiBcIm1jcC0xXCIsXG4gICAgICByZXF1ZXN0Q29udGV4dFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY3VzdG9tUGF0aDogcmVzb2x2ZUN1c3RvbUNvbW1hbmRQYXRoKHtjb21tYW5kRW50cnksIHRvb2xBcmd1bWVudHN9KSxcbiAgICBtb2RlbCxcbiAgICBwYXlsb2FkOiB0b29sQXJndW1lbnRzLFxuICAgIHJlcXVlc3RJZDogXCJtY3AtMVwiLFxuICAgIHJlcXVlc3RDb250ZXh0XG4gIH1cbn1cblxuLyoqXG4gKiBTdWJzdGl0dXRlcyB0aGUgYDxpZD5gIHBsYWNlaG9sZGVyIG9mIGEgbWFuaWZlc3QgY29tbWFuZCBwYXRoIHdpdGggdGhlIHRvb2wnc1xuICogcHJpbWFyeSBrZXkgYXJndW1lbnQsIG1hdGNoaW5nIHRoZSBtZW1iZXIgcm91dGUgdGhlIGRpc3BhdGNoZXIgcmVzb2x2ZXMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7TWFuaWZlc3RDb21tYW5kRW50cnl9IGFyZ3MuY29tbWFuZEVudHJ5IC0gTWFuaWZlc3QgY29tbWFuZCBlbnRyeSAoY2FycmllcyBgcGF0aGAgYW5kIGBzY29wZWApLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gYXJncy50b29sQXJndW1lbnRzIC0gVG9vbCBhcmd1bWVudHMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEN1c3RvbSBjb21tYW5kIHBhdGguXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVDdXN0b21Db21tYW5kUGF0aCh7Y29tbWFuZEVudHJ5LCB0b29sQXJndW1lbnRzfSkge1xuICBjb25zdCBwYXRoID0gU3RyaW5nKGNvbW1hbmRFbnRyeS5wYXRoIHx8IFwiXCIpXG5cbiAgaWYgKCFwYXRoLmluY2x1ZGVzKFwiPGlkPlwiKSkgcmV0dXJuIHBhdGhcblxuICBjb25zdCBpZFZhbHVlID0gdG9vbEFyZ3VtZW50cy5pZCA/PyB0b29sQXJndW1lbnRzLnJlY29yZElkXG5cbiAgcmV0dXJuIHBhdGgucmVwbGFjZShcIjxpZD5cIiwgZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhpZFZhbHVlID8/IFwiXCIpKSlcbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIHN5bnRoZXRpYyBIVFRQIHJlcXVlc3QgbGluZXMgZm9yIG9uZSBNQ1AgZGlzcGF0Y2guIFRoZSByZXF1ZXN0LWNvbnRleHRcbiAqIGBhdXRob3JpemF0aW9uYCBrZXkgaXMgZm9yd2FyZGVkIGFzIHRoZSByZXF1ZXN0J3MgYEF1dGhvcml6YXRpb25gIGhlYWRlciBzbyBhcHBzXG4gKiB3aG9zZSBhYmlsaXR5IHJlc29sdmVyIGF1dGhlbnRpY2F0ZXMgZnJvbSBoZWFkZXJzIChCZWFyZXIgc2VydmljZSB0b2tlbnMgb3JcbiAqIHBlcnNvbmFsIGFjY2VzcyB0b2tlbnMpIGF1dGhlbnRpY2F0ZSBNQ1AgdG9vbCBjYWxscyBleGFjdGx5IGxpa2UgSFRUUCBjYWxscy5cbiAqIENhcnJpYWdlIHJldHVybnMgYW5kIGxpbmUgZmVlZHMgYXJlIHN0cmlwcGVkIHNvIGEgY29udGV4dCB2YWx1ZSBjYW4gbmV2ZXIgaW5qZWN0XG4gKiBleHRyYSByZXF1ZXN0IGxpbmVzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+IHwgdW5kZWZpbmVkfSBhcmdzLnJlcXVlc3RDb250ZXh0IC0gUmVtb3RlIHJlcXVlc3QgY29udGV4dC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmF3IEhUVFAgcmVxdWVzdCBoZWFkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTeW50aGV0aWNSZXF1ZXN0TGluZXMoe3JlcXVlc3RDb250ZXh0fSkge1xuICBjb25zdCBsaW5lcyA9IFtcbiAgICBgUE9TVCAke01DUF9SRVFVRVNUX1BBVEh9IEhUVFAvMS4xYCxcbiAgICBcIkhvc3Q6IHZlbG9jaW91cy1tY3BcIixcbiAgICBcIkNvbnRlbnQtTGVuZ3RoOiAwXCIsXG4gIF1cblxuICBpZiAocmVxdWVzdENvbnRleHQgJiYgdHlwZW9mIHJlcXVlc3RDb250ZXh0LmF1dGhvcml6YXRpb24gPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBhdXRob3JpemF0aW9uID0gcmVxdWVzdENvbnRleHQuYXV0aG9yaXphdGlvbi5yZXBsYWNlKC9bXFxyXFxuXS9nLCBcIlwiKS50cmltKClcblxuICAgIGlmIChhdXRob3JpemF0aW9uLmxlbmd0aCA+IDApIGxpbmVzLnB1c2goYEF1dGhvcml6YXRpb246ICR7YXV0aG9yaXphdGlvbn1gKVxuICB9XG5cbiAgbGluZXMucHVzaChcIlwiLCBcIlwiKVxuXG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxyXFxuXCIpXG59XG5cbi8qKlxuICogUnVucyBvbmUgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdCBlbnRyeSB0aHJvdWdoIHRoZSBjb250cm9sbGVyIGluLXByb2Nlc3MsXG4gKiBtaXJyb3JpbmcgdGhlIHN5bnRoZXRpYy1yZXF1ZXN0IHBhdHRlcm4gdXNlZCBieSB0aGUgY29udHJvbGxlciBzcGVjcy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXF1ZXN0RW50cnl9IGFyZ3MucmVxdWVzdEVudHJ5IC0gZnJvbnRlbmRBcGkgcmVxdWVzdCBlbnRyeS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGFyc2VkIGZyb250ZW5kQXBpIHJlc3BvbnNlIHBheWxvYWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJ1bkZyb250ZW5kQXBpUmVxdWVzdCh7Y29uZmlndXJhdGlvbiwgcmVxdWVzdEVudHJ5fSkge1xuICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAoe3JlbW90ZUFkZHJlc3M6IFwiMTI3LjAuMC4xXCJ9KVxuICBjb25zdCByZXF1ZXN0ID0gbmV3IFJlcXVlc3Qoe2NsaWVudCwgY29uZmlndXJhdGlvbn0pXG4gIGNvbnN0IGRvbmVQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHJlcXVlc3QucmVxdWVzdFBhcnNlci5ldmVudHMub24oXCJkb25lXCIsIHJlc29sdmUpKVxuXG4gIHJlcXVlc3QuZmVlZChCdWZmZXIuZnJvbShidWlsZFN5bnRoZXRpY1JlcXVlc3RMaW5lcyh7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3RFbnRyeS5yZXF1ZXN0Q29udGV4dH0pLCBcInV0ZjhcIikpXG5cbiAgYXdhaXQgZG9uZVByb21pc2VcblxuICBjb25zdCByZXNwb25zZSA9IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pXG4gIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoe1xuICAgIGFjdGlvbjogXCJmcm9udGVuZEFwaVwiLFxuICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgY29udHJvbGxlcjogXCJmcm9udGVuZC1tb2RlbHNcIixcbiAgICBwYXJhbXM6IHtyZXF1ZXN0czogW3JlcXVlc3RFbnRyeV19LFxuICAgIHJlcXVlc3QsXG4gICAgcmVzcG9uc2UsXG4gICAgdmlld1BhdGg6IGAke2NvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9yb3V0ZXMvZnJvbnRlbmQtbW9kZWxzYFxuICB9KVxuXG4gIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRBcGkoKVxuXG4gIGNvbnN0IGJvZHkgPSByZXNwb25zZS5nZXRCb2R5KClcbiAgY29uc3QgcmVzcG9uc2VUZXh0ID0gYm9keSA9PT0gbnVsbCB8fCBib2R5ID09PSB1bmRlZmluZWRcbiAgICA/IFwiXCJcbiAgICA6ICh0eXBlb2YgYm9keSA9PT0gXCJzdHJpbmdcIiA/IGJvZHkgOiBCdWZmZXIuZnJvbShib2R5KS50b1N0cmluZyhcInV0ZjhcIikpXG4gIGNvbnN0IHJlc3BvbnNlSnNvbiA9IHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShyZXNwb25zZVRleHQpIDoge31cblxuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXNwb25zZUpzb24pKVxufVxuXG4vKipcbiAqIFdyYXBzIGEgdmFsdWUgYXMgYW4gTUNQIHRleHQgY29udGVudCByZXN1bHQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIHNlcmlhbGl6ZSBhcyBKU09OIHRleHQuXG4gKiBAcmV0dXJucyB7TWNwVG9vbFJlc3VsdH0gLSBNQ1AgdG9vbCByZXN1bHQuXG4gKi9cbmZ1bmN0aW9uIHRleHRSZXN1bHQoe3ZhbHVlfSkge1xuICBjb25zdCBzZXJpYWxpemVkID0gc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHZhbHVlKVxuXG4gIHJldHVybiB7XG4gICAgY29udGVudDogW3t0ZXh0OiBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVkLCBudWxsLCAyKSwgdHlwZTogXCJ0ZXh0XCJ9XSxcbiAgICBpc0Vycm9yOiBmYWxzZVxuICB9XG59XG5cbi8qKlxuICogQnVpbGRzIGFuIE1DUCBlcnJvciByZXN1bHQsIG9wdGlvbmFsbHkgaW5jbHVkaW5nIHRoZSBkaXNwYXRjaGVyJ3MgZXJyb3JcbiAqIHBheWxvYWQgKHZhbGlkYXRpb24gc3VtbWFyaWVzIHN0YXkgZmFpdGhmdWwg4oCUIG5vdGhpbmcgaXMgc3dhbGxvd2VkKS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFtwYXlsb2FkXSAtIEZ1bGwgZGlzcGF0Y2hlciBlcnJvciBwYXlsb2FkLlxuICogQHJldHVybnMge01jcFRvb2xSZXN1bHR9IC0gTUNQIHRvb2wgcmVzdWx0LlxuICovXG5mdW5jdGlvbiBlcnJvclJlc3VsdChtZXNzYWdlLCBwYXlsb2FkKSB7XG4gIGNvbnN0IGRldGFpbCA9IHBheWxvYWQgPyBgXFxuJHtKU09OLnN0cmluZ2lmeShwYXlsb2FkLCBudWxsLCAyKX1gIDogXCJcIlxuXG4gIHJldHVybiB7XG4gICAgY29udGVudDogW3t0ZXh0OiBgJHttZXNzYWdlfSR7ZGV0YWlsfWAsIHR5cGU6IFwidGV4dFwifV0sXG4gICAgaXNFcnJvcjogdHJ1ZVxuICB9XG59XG4iXX0=