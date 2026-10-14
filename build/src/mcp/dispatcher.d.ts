export type McpToolResult = {
    /**
     * - Tool result content blocks.
     */
    content: Array<{
        text: string;
        type: "text";
    }>;
    /**
     * - Whether the tool call failed.
     */
    isError: boolean;
};
export type FrontendModelRequestEntry = {
    /**
     * - Built-in command type.
     */
    commandType?: string;
    /**
     * - Custom command path.
     */
    customPath?: string;
    /**
     * - Backend model name.
     */
    model: string;
    /**
     * - Command payload.
     */
    payload: Record<string, unknown>;
    /**
     * - Remote request context.
     */
    requestContext?: Record<string, string | number | boolean> | undefined;
    /**
     * - Request correlation id.
     */
    requestId: string;
};
export type ApiManifest = Record<string, unknown> & {
    formatVersion?: number;
    resources?: Record<string, unknown>;
};
export type ManifestCommandEntry = {
    /**
     * - Declared typed command arguments.
     */
    args?: Array<{
        name: string;
        type: string;
    }>;
    /**
     * - Whether the entry is a synthesized built-in command.
     */
    isBuiltIn?: boolean;
    /**
     * - Command method name.
     */
    methodName: string;
    /**
     * - Manifest command path (member paths carry `<id>`).
     */
    path?: string;
    /**
     * - Declared JSDoc return type.
     */
    returnType?: string | null;
    /**
     * - Command scope.
     */
    scope: "collection" | "member";
};
export type ManifestResourceEntry = {
    /**
     * - Scope-keyed custom command entries.
     */
    commands?: Record<string, ManifestCommandEntry[]>;
    /**
     * - Scope-keyed built-in command maps.
     */
    builtInCommands?: Record<string, Record<string, string>>;
    /**
     * - Backend model name.
     */
    modelName: string;
    /**
     * - Primary key attribute name(s).
     */
    primaryKey?: string | string[];
};
/**
 * Lists the MCP tools exposed by a configuration's frontend-model API manifest.
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @returns {Promise<Record<string, unknown>[]>} - MCP `tools/list` tool definitions.
 */
export declare function listMcpTools({ configuration }: {
    configuration: import("../configuration.js").default;
}): Promise<Record<string, unknown>[]>;
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
export declare function callMcpTool({ configuration, requestContext, toolArguments, toolName }: {
    configuration: import("../configuration.js").default;
    requestContext?: Record<string, string | number | boolean> | undefined;
    toolArguments: Record<string, unknown>;
    toolName: string;
}): Promise<McpToolResult>;
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
export declare function buildSyntheticRequestLines({ requestContext }: {
    requestContext: Record<string, string | number | boolean> | undefined;
}): string;
//# sourceMappingURL=dispatcher.d.ts.map