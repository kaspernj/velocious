export type JsonRpcMessage = Record<string, unknown> & {
    error?: {
        code: number;
        message: string;
    };
    id?: number | string | null;
    jsonrpc: string;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
};
/**
 * Handles one JSON-RPC message of the MCP protocol (initialize / tools/list /
 * tools/call / ping) against a Velocious configuration. Returns null for
 * notifications (no response expected).
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {JsonRpcMessage} args.request - Parsed JSON-RPC request.
 * @param {Record<string, string | number | boolean> | undefined} [args.requestContext] - Remote request context forwarded to every tool call.
 * @returns {Promise<JsonRpcMessage | null>} - JSON-RPC response, or null for notifications.
 */
export declare function handleMcpRequest({ configuration, request, requestContext }: {
    configuration: import("../configuration.js").default;
    request: JsonRpcMessage;
    requestContext?: Record<string, string | number | boolean> | undefined;
}): Promise<JsonRpcMessage | null>;
/**
 * Starts a line-delimited JSON-RPC MCP server over stdio (the primary MCP
 * transport for local tool servers). Each input line is one JSON-RPC message;
 * each response is written as one JSON line.
 * @param {object} args - Arguments.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {import("node:stream").Readable} [args.input] - Input stream (defaults to stdin).
 * @param {import("node:stream").Writable} [args.output] - Output stream (defaults to stdout).
 * @param {Record<string, string | number | boolean> | undefined} [args.requestContext] - Remote request context forwarded to every tool call.
 * @returns {{close: () => void, done: Promise<void>}} - Server handle; `done` resolves when the input stream closes.
 */
export declare function startMcpStdioServer({ configuration, input, output, requestContext }: {
    configuration: import("../configuration.js").default;
    input?: import("node:stream").Readable;
    output?: import("node:stream").Writable;
    requestContext?: Record<string, string | number | boolean> | undefined;
}): {
    close: () => void;
    done: Promise<void>;
};
//# sourceMappingURL=json-rpc-server.d.ts.map