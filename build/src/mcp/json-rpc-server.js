// @ts-check
/**
 * @typedef {Record<string, unknown> & {error?: {code: number, message: string}, id?: number | string | null, jsonrpc: string, method?: string, params?: Record<string, unknown>, result?: Record<string, unknown>}} JsonRpcMessage
 */
import readline from "node:readline";
import { callMcpTool, listMcpTools } from "./dispatcher.js";
const MCP_PROTOCOL_VERSION = "2025-03-26";
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
export async function handleMcpRequest({ configuration, request, requestContext }) {
    if (!request || typeof request !== "object" || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        return jsonRpcError(null, -32600, "Invalid Request");
    }
    const id = request.id;
    if (request.method.startsWith("notifications/"))
        return null;
    if (request.method === "initialize") {
        return jsonRpcResult(id, {
            capabilities: { tools: { listChanged: false } },
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: { name: "velocious-mcp", title: "Velocious frontend-model MCP server", version: "1.0.0" }
        });
    }
    if (request.method === "ping")
        return jsonRpcResult(id, {});
    if (request.method === "tools/list") {
        return jsonRpcResult(id, { tools: await listMcpTools({ configuration }) });
    }
    if (request.method === "tools/call") {
        const params = request.params || {};
        if (typeof params.name !== "string")
            return jsonRpcError(id, -32602, "Expected tools/call params.name");
        const toolArguments = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? /** @type {Record<string, unknown>} */ (params.arguments)
            : {};
        return jsonRpcResult(id, await callMcpTool({ configuration, requestContext, toolArguments, toolName: params.name }));
    }
    return jsonRpcError(id, -32601, `Method not found: ${request.method}`);
}
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
export function startMcpStdioServer({ configuration, input = process.stdin, output = process.stdout, requestContext }) {
    let closed = false;
    let doneResolved = false;
    /** @type {((value: void) => void) | undefined} */
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    /**
     * Writes one JSON-RPC message as a line.
     * @param {JsonRpcMessage | null} message - Message to write.
     * @returns {void} - No return value.
     */
    const writeMessage = (message) => {
        // Responses for in-flight requests are still written after the input
        // stream closed; only after `done` resolved are writes suppressed.
        if (message === null || doneResolved)
            return;
        output.write(`${JSON.stringify(message)}\n`);
    };
    const readlineInterface = readline.createInterface({ input });
    let pendingRequests = 0;
    const finishIfClosed = () => {
        if (closed && pendingRequests === 0 && resolveDone && !doneResolved) {
            doneResolved = true;
            resolveDone(undefined);
        }
    };
    readlineInterface.on("line", (/** @type {string} */ line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0)
            return;
        /** @type {JsonRpcMessage} */
        let request;
        try {
            request = JSON.parse(trimmed);
        }
        catch {
            writeMessage(jsonRpcError(null, -32700, "Parse error"));
            return;
        }
        pendingRequests++;
        handleMcpRequest({ configuration, request, requestContext }).then((response) => {
            writeMessage(response);
        }).catch((error) => {
            writeMessage(jsonRpcError(request.id ?? null, -32603, `Internal error: ${error instanceof Error ? error.message : String(error)}`));
        }).finally(() => {
            pendingRequests--;
            finishIfClosed();
        });
    });
    readlineInterface.on("close", () => {
        closed = true;
        finishIfClosed();
    });
    return {
        close() {
            if (closed)
                return;
            closed = true;
            readlineInterface.close();
            finishIfClosed();
        },
        done
    };
}
/**
 * Builds a JSON-RPC success response.
 * @param {number | string | null | undefined} id - Request id.
 * @param {Record<string, unknown>} result - Result payload.
 * @returns {JsonRpcMessage} - JSON-RPC response.
 */
function jsonRpcResult(id, result) {
    return { id, jsonrpc: "2.0", result };
}
/**
 * Builds a JSON-RPC error response.
 * @param {number | string | null | undefined} id - Request id.
 * @param {number} code - JSON-RPC error code.
 * @param {string} message - Error message.
 * @returns {JsonRpcMessage} - JSON-RPC response.
 */
function jsonRpcError(id, code, message) {
    return { error: { code, message }, id, jsonrpc: "2.0" };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoianNvbi1ycGMtc2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL21jcC9qc29uLXJwYy1zZXJ2ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOztHQUVHO0FBRUgsT0FBTyxRQUFRLE1BQU0sZUFBZSxDQUFBO0FBQ3BDLE9BQU8sRUFBQyxXQUFXLEVBQUUsWUFBWSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFFekQsTUFBTSxvQkFBb0IsR0FBRyxZQUFZLENBQUE7QUFFekM7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxnQkFBZ0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFDO0lBQzdFLElBQUksQ0FBQyxPQUFPLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxJQUFJLE9BQU8sQ0FBQyxPQUFPLEtBQUssS0FBSyxJQUFJLE9BQU8sT0FBTyxDQUFDLE1BQU0sS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUMvRyxPQUFPLFlBQVksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLENBQUMsQ0FBQTtJQUN0RCxDQUFDO0lBRUQsTUFBTSxFQUFFLEdBQUcsT0FBTyxDQUFDLEVBQUUsQ0FBQTtJQUVyQixJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLGdCQUFnQixDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFFNUQsSUFBSSxPQUFPLENBQUMsTUFBTSxLQUFLLFlBQVksRUFBRSxDQUFDO1FBQ3BDLE9BQU8sYUFBYSxDQUFDLEVBQUUsRUFBRTtZQUN2QixZQUFZLEVBQUUsRUFBQyxLQUFLLEVBQUUsRUFBQyxXQUFXLEVBQUUsS0FBSyxFQUFDLEVBQUM7WUFDM0MsZUFBZSxFQUFFLG9CQUFvQjtZQUNyQyxVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLEtBQUssRUFBRSxxQ0FBcUMsRUFBRSxPQUFPLEVBQUUs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QyxDQUFDLENBQUE7SUFFRixPQUFPO1FBQ0wsS0FBSztZQUNILElBQUksTUFBTTtnQkFBRSxPQUFNO1lBRWxCLE1BQU0sR0FBRyxJQUFJLENBQUE7WUFDYixpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUN6QixjQUFjLEVBQUUsQ0FBQTtRQUNsQixDQUFDO1FBQ0QsSUFBSTtLQUNMLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGFBQWEsQ0FBQyxFQUFFLEVBQUUsTUFBTTtJQUMvQixPQUFPLEVBQUMsRUFBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFDLENBQUE7QUFDckMsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsWUFBWSxDQUFDLEVBQUUsRUFBRSxJQUFJLEVBQUUsT0FBTztJQUNyQyxPQUFPLEVBQUMsS0FBSyxFQUFFLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFDLENBQUE7QUFDckQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHtlcnJvcj86IHtjb2RlOiBudW1iZXIsIG1lc3NhZ2U6IHN0cmluZ30sIGlkPzogbnVtYmVyIHwgc3RyaW5nIHwgbnVsbCwganNvbnJwYzogc3RyaW5nLCBtZXRob2Q/OiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCByZXN1bHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn19IEpzb25ScGNNZXNzYWdlXG4gKi9cblxuaW1wb3J0IHJlYWRsaW5lIGZyb20gXCJub2RlOnJlYWRsaW5lXCJcbmltcG9ydCB7Y2FsbE1jcFRvb2wsIGxpc3RNY3BUb29sc30gZnJvbSBcIi4vZGlzcGF0Y2hlci5qc1wiXG5cbmNvbnN0IE1DUF9QUk9UT0NPTF9WRVJTSU9OID0gXCIyMDI1LTAzLTI2XCJcblxuLyoqXG4gKiBIYW5kbGVzIG9uZSBKU09OLVJQQyBtZXNzYWdlIG9mIHRoZSBNQ1AgcHJvdG9jb2wgKGluaXRpYWxpemUgLyB0b29scy9saXN0IC9cbiAqIHRvb2xzL2NhbGwgLyBwaW5nKSBhZ2FpbnN0IGEgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24uIFJldHVybnMgbnVsbCBmb3JcbiAqIG5vdGlmaWNhdGlvbnMgKG5vIHJlc3BvbnNlIGV4cGVjdGVkKS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge0pzb25ScGNNZXNzYWdlfSBhcmdzLnJlcXVlc3QgLSBQYXJzZWQgSlNPTi1SUEMgcmVxdWVzdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj4gfCB1bmRlZmluZWR9IFthcmdzLnJlcXVlc3RDb250ZXh0XSAtIFJlbW90ZSByZXF1ZXN0IGNvbnRleHQgZm9yd2FyZGVkIHRvIGV2ZXJ5IHRvb2wgY2FsbC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPEpzb25ScGNNZXNzYWdlIHwgbnVsbD59IC0gSlNPTi1SUEMgcmVzcG9uc2UsIG9yIG51bGwgZm9yIG5vdGlmaWNhdGlvbnMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVNY3BSZXF1ZXN0KHtjb25maWd1cmF0aW9uLCByZXF1ZXN0LCByZXF1ZXN0Q29udGV4dH0pIHtcbiAgaWYgKCFyZXF1ZXN0IHx8IHR5cGVvZiByZXF1ZXN0ICE9PSBcIm9iamVjdFwiIHx8IHJlcXVlc3QuanNvbnJwYyAhPT0gXCIyLjBcIiB8fCB0eXBlb2YgcmVxdWVzdC5tZXRob2QgIT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4ganNvblJwY0Vycm9yKG51bGwsIC0zMjYwMCwgXCJJbnZhbGlkIFJlcXVlc3RcIilcbiAgfVxuXG4gIGNvbnN0IGlkID0gcmVxdWVzdC5pZFxuXG4gIGlmIChyZXF1ZXN0Lm1ldGhvZC5zdGFydHNXaXRoKFwibm90aWZpY2F0aW9ucy9cIikpIHJldHVybiBudWxsXG5cbiAgaWYgKHJlcXVlc3QubWV0aG9kID09PSBcImluaXRpYWxpemVcIikge1xuICAgIHJldHVybiBqc29uUnBjUmVzdWx0KGlkLCB7XG4gICAgICBjYXBhYmlsaXRpZXM6IHt0b29sczoge2xpc3RDaGFuZ2VkOiBmYWxzZX19LFxuICAgICAgcHJvdG9jb2xWZXJzaW9uOiBNQ1BfUFJPVE9DT0xfVkVSU0lPTixcbiAgICAgIHNlcnZlckluZm86IHtuYW1lOiBcInZlbG9jaW91cy1tY3BcIiwgdGl0bGU6IFwiVmVsb2Npb3VzIGZyb250ZW5kLW1vZGVsIE1DUCBzZXJ2ZXJcIiwgdmVyc2lvbjogXCIxLjAuMFwifVxuICAgIH0pXG4gIH1cblxuICBpZiAocmVxdWVzdC5tZXRob2QgPT09IFwicGluZ1wiKSByZXR1cm4ganNvblJwY1Jlc3VsdChpZCwge30pXG5cbiAgaWYgKHJlcXVlc3QubWV0aG9kID09PSBcInRvb2xzL2xpc3RcIikge1xuICAgIHJldHVybiBqc29uUnBjUmVzdWx0KGlkLCB7dG9vbHM6IGF3YWl0IGxpc3RNY3BUb29scyh7Y29uZmlndXJhdGlvbn0pfSlcbiAgfVxuXG4gIGlmIChyZXF1ZXN0Lm1ldGhvZCA9PT0gXCJ0b29scy9jYWxsXCIpIHtcbiAgICBjb25zdCBwYXJhbXMgPSByZXF1ZXN0LnBhcmFtcyB8fCB7fVxuXG4gICAgaWYgKHR5cGVvZiBwYXJhbXMubmFtZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGpzb25ScGNFcnJvcihpZCwgLTMyNjAyLCBcIkV4cGVjdGVkIHRvb2xzL2NhbGwgcGFyYW1zLm5hbWVcIilcblxuICAgIGNvbnN0IHRvb2xBcmd1bWVudHMgPSBwYXJhbXMuYXJndW1lbnRzICYmIHR5cGVvZiBwYXJhbXMuYXJndW1lbnRzID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHBhcmFtcy5hcmd1bWVudHMpXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChwYXJhbXMuYXJndW1lbnRzKVxuICAgICAgOiB7fVxuXG4gICAgcmV0dXJuIGpzb25ScGNSZXN1bHQoaWQsIGF3YWl0IGNhbGxNY3BUb29sKHtjb25maWd1cmF0aW9uLCByZXF1ZXN0Q29udGV4dCwgdG9vbEFyZ3VtZW50cywgdG9vbE5hbWU6IHBhcmFtcy5uYW1lfSkpXG4gIH1cblxuICByZXR1cm4ganNvblJwY0Vycm9yKGlkLCAtMzI2MDEsIGBNZXRob2Qgbm90IGZvdW5kOiAke3JlcXVlc3QubWV0aG9kfWApXG59XG5cbi8qKlxuICogU3RhcnRzIGEgbGluZS1kZWxpbWl0ZWQgSlNPTi1SUEMgTUNQIHNlcnZlciBvdmVyIHN0ZGlvICh0aGUgcHJpbWFyeSBNQ1BcbiAqIHRyYW5zcG9ydCBmb3IgbG9jYWwgdG9vbCBzZXJ2ZXJzKS4gRWFjaCBpbnB1dCBsaW5lIGlzIG9uZSBKU09OLVJQQyBtZXNzYWdlO1xuICogZWFjaCByZXNwb25zZSBpcyB3cml0dGVuIGFzIG9uZSBKU09OIGxpbmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOnN0cmVhbVwiKS5SZWFkYWJsZX0gW2FyZ3MuaW5wdXRdIC0gSW5wdXQgc3RyZWFtIChkZWZhdWx0cyB0byBzdGRpbikuXG4gKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6c3RyZWFtXCIpLldyaXRhYmxlfSBbYXJncy5vdXRwdXRdIC0gT3V0cHV0IHN0cmVhbSAoZGVmYXVsdHMgdG8gc3Rkb3V0KS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj4gfCB1bmRlZmluZWR9IFthcmdzLnJlcXVlc3RDb250ZXh0XSAtIFJlbW90ZSByZXF1ZXN0IGNvbnRleHQgZm9yd2FyZGVkIHRvIGV2ZXJ5IHRvb2wgY2FsbC5cbiAqIEByZXR1cm5zIHt7Y2xvc2U6ICgpID0+IHZvaWQsIGRvbmU6IFByb21pc2U8dm9pZD59fSAtIFNlcnZlciBoYW5kbGU7IGBkb25lYCByZXNvbHZlcyB3aGVuIHRoZSBpbnB1dCBzdHJlYW0gY2xvc2VzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRNY3BTdGRpb1NlcnZlcih7Y29uZmlndXJhdGlvbiwgaW5wdXQgPSBwcm9jZXNzLnN0ZGluLCBvdXRwdXQgPSBwcm9jZXNzLnN0ZG91dCwgcmVxdWVzdENvbnRleHR9KSB7XG4gIGxldCBjbG9zZWQgPSBmYWxzZVxuICBsZXQgZG9uZVJlc29sdmVkID0gZmFsc2VcbiAgLyoqIEB0eXBlIHsoKHZhbHVlOiB2b2lkKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgbGV0IHJlc29sdmVEb25lXG5cbiAgY29uc3QgZG9uZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlc29sdmVEb25lID0gcmVzb2x2ZSB9KVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgb25lIEpTT04tUlBDIG1lc3NhZ2UgYXMgYSBsaW5lLlxuICAgKiBAcGFyYW0ge0pzb25ScGNNZXNzYWdlIHwgbnVsbH0gbWVzc2FnZSAtIE1lc3NhZ2UgdG8gd3JpdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNvbnN0IHdyaXRlTWVzc2FnZSA9IChtZXNzYWdlKSA9PiB7XG4gICAgLy8gUmVzcG9uc2VzIGZvciBpbi1mbGlnaHQgcmVxdWVzdHMgYXJlIHN0aWxsIHdyaXR0ZW4gYWZ0ZXIgdGhlIGlucHV0XG4gICAgLy8gc3RyZWFtIGNsb3NlZDsgb25seSBhZnRlciBgZG9uZWAgcmVzb2x2ZWQgYXJlIHdyaXRlcyBzdXBwcmVzc2VkLlxuICAgIGlmIChtZXNzYWdlID09PSBudWxsIHx8IGRvbmVSZXNvbHZlZCkgcmV0dXJuXG5cbiAgICBvdXRwdXQud3JpdGUoYCR7SlNPTi5zdHJpbmdpZnkobWVzc2FnZSl9XFxuYClcbiAgfVxuXG4gIGNvbnN0IHJlYWRsaW5lSW50ZXJmYWNlID0gcmVhZGxpbmUuY3JlYXRlSW50ZXJmYWNlKHtpbnB1dH0pXG5cbiAgbGV0IHBlbmRpbmdSZXF1ZXN0cyA9IDBcblxuICBjb25zdCBmaW5pc2hJZkNsb3NlZCA9ICgpID0+IHtcbiAgICBpZiAoY2xvc2VkICYmIHBlbmRpbmdSZXF1ZXN0cyA9PT0gMCAmJiByZXNvbHZlRG9uZSAmJiAhZG9uZVJlc29sdmVkKSB7XG4gICAgICBkb25lUmVzb2x2ZWQgPSB0cnVlXG4gICAgICByZXNvbHZlRG9uZSh1bmRlZmluZWQpXG4gICAgfVxuICB9XG5cbiAgcmVhZGxpbmVJbnRlcmZhY2Uub24oXCJsaW5lXCIsICgvKiogQHR5cGUge3N0cmluZ30gKi8gbGluZSkgPT4ge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKVxuXG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7SnNvblJwY01lc3NhZ2V9ICovXG4gICAgbGV0IHJlcXVlc3RcblxuICAgIHRyeSB7XG4gICAgICByZXF1ZXN0ID0gSlNPTi5wYXJzZSh0cmltbWVkKVxuICAgIH0gY2F0Y2gge1xuICAgICAgd3JpdGVNZXNzYWdlKGpzb25ScGNFcnJvcihudWxsLCAtMzI3MDAsIFwiUGFyc2UgZXJyb3JcIikpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHBlbmRpbmdSZXF1ZXN0cysrXG5cbiAgICBoYW5kbGVNY3BSZXF1ZXN0KHtjb25maWd1cmF0aW9uLCByZXF1ZXN0LCByZXF1ZXN0Q29udGV4dH0pLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgICB3cml0ZU1lc3NhZ2UocmVzcG9uc2UpXG4gICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICB3cml0ZU1lc3NhZ2UoanNvblJwY0Vycm9yKHJlcXVlc3QuaWQgPz8gbnVsbCwgLTMyNjAzLCBgSW50ZXJuYWwgZXJyb3I6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApKVxuICAgIH0pLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgcGVuZGluZ1JlcXVlc3RzLS1cbiAgICAgIGZpbmlzaElmQ2xvc2VkKClcbiAgICB9KVxuICB9KVxuXG4gIHJlYWRsaW5lSW50ZXJmYWNlLm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgIGNsb3NlZCA9IHRydWVcbiAgICBmaW5pc2hJZkNsb3NlZCgpXG4gIH0pXG5cbiAgcmV0dXJuIHtcbiAgICBjbG9zZSgpIHtcbiAgICAgIGlmIChjbG9zZWQpIHJldHVyblxuXG4gICAgICBjbG9zZWQgPSB0cnVlXG4gICAgICByZWFkbGluZUludGVyZmFjZS5jbG9zZSgpXG4gICAgICBmaW5pc2hJZkNsb3NlZCgpXG4gICAgfSxcbiAgICBkb25lXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBKU09OLVJQQyBzdWNjZXNzIHJlc3BvbnNlLlxuICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBpZCAtIFJlcXVlc3QgaWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSByZXN1bHQgLSBSZXN1bHQgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtKc29uUnBjTWVzc2FnZX0gLSBKU09OLVJQQyByZXNwb25zZS5cbiAqL1xuZnVuY3Rpb24ganNvblJwY1Jlc3VsdChpZCwgcmVzdWx0KSB7XG4gIHJldHVybiB7aWQsIGpzb25ycGM6IFwiMi4wXCIsIHJlc3VsdH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBKU09OLVJQQyBlcnJvciByZXNwb25zZS5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gaWQgLSBSZXF1ZXN0IGlkLlxuICogQHBhcmFtIHtudW1iZXJ9IGNvZGUgLSBKU09OLVJQQyBlcnJvciBjb2RlLlxuICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICogQHJldHVybnMge0pzb25ScGNNZXNzYWdlfSAtIEpTT04tUlBDIHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiBqc29uUnBjRXJyb3IoaWQsIGNvZGUsIG1lc3NhZ2UpIHtcbiAgcmV0dXJuIHtlcnJvcjoge2NvZGUsIG1lc3NhZ2V9LCBpZCwganNvbnJwYzogXCIyLjBcIn1cbn1cbiJdfQ==