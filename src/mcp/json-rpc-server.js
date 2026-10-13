// @ts-check

/**
 * @typedef {Record<string, unknown> & {error?: {code: number, message: string}, id?: number | string | null, jsonrpc: string, method?: string, params?: Record<string, unknown>, result?: Record<string, unknown>}} JsonRpcMessage
 */

import readline from "node:readline"
import {callMcpTool, listMcpTools} from "./dispatcher.js"

const MCP_PROTOCOL_VERSION = "2025-03-26"

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
export async function handleMcpRequest({configuration, request, requestContext}) {
  if (!request || typeof request !== "object" || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(null, -32600, "Invalid Request")
  }

  const id = request.id

  if (request.method.startsWith("notifications/")) return null

  if (request.method === "initialize") {
    return jsonRpcResult(id, {
      capabilities: {tools: {listChanged: false}},
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {name: "velocious-mcp", title: "Velocious frontend-model MCP server", version: "1.0.0"}
    })
  }

  if (request.method === "ping") return jsonRpcResult(id, {})

  if (request.method === "tools/list") {
    return jsonRpcResult(id, {tools: await listMcpTools({configuration})})
  }

  if (request.method === "tools/call") {
    const params = request.params || {}

    if (typeof params.name !== "string") return jsonRpcError(id, -32602, "Expected tools/call params.name")

    const toolArguments = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? /** @type {Record<string, unknown>} */ (params.arguments)
      : {}

    return jsonRpcResult(id, await callMcpTool({configuration, requestContext, toolArguments, toolName: params.name}))
  }

  return jsonRpcError(id, -32601, `Method not found: ${request.method}`)
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
export function startMcpStdioServer({configuration, input = process.stdin, output = process.stdout, requestContext}) {
  let closed = false
  let doneResolved = false
  /** @type {((value: void) => void) | undefined} */
  let resolveDone

  const done = new Promise((resolve) => { resolveDone = resolve })

  /**
   * Writes one JSON-RPC message as a line.
   * @param {JsonRpcMessage | null} message - Message to write.
   * @returns {void} - No return value.
   */
  const writeMessage = (message) => {
    // Responses for in-flight requests are still written after the input
    // stream closed; only after `done` resolved are writes suppressed.
    if (message === null || doneResolved) return

    output.write(`${JSON.stringify(message)}\n`)
  }

  const readlineInterface = readline.createInterface({input})

  let pendingRequests = 0

  const finishIfClosed = () => {
    if (closed && pendingRequests === 0 && resolveDone && !doneResolved) {
      doneResolved = true
      resolveDone(undefined)
    }
  }

  readlineInterface.on("line", (/** @type {string} */ line) => {
    const trimmed = line.trim()

    if (trimmed.length === 0) return

    /** @type {JsonRpcMessage} */
    let request

    try {
      request = JSON.parse(trimmed)
    } catch {
      writeMessage(jsonRpcError(null, -32700, "Parse error"))

      return
    }

    pendingRequests++

    handleMcpRequest({configuration, request, requestContext}).then((response) => {
      writeMessage(response)
    }).catch((error) => {
      writeMessage(jsonRpcError(request.id ?? null, -32603, `Internal error: ${error instanceof Error ? error.message : String(error)}`))
    }).finally(() => {
      pendingRequests--
      finishIfClosed()
    })
  })

  readlineInterface.on("close", () => {
    closed = true
    finishIfClosed()
  })

  return {
    close() {
      if (closed) return

      closed = true
      readlineInterface.close()
      finishIfClosed()
    },
    done
  }
}

/**
 * Builds a JSON-RPC success response.
 * @param {number | string | null | undefined} id - Request id.
 * @param {Record<string, unknown>} result - Result payload.
 * @returns {JsonRpcMessage} - JSON-RPC response.
 */
function jsonRpcResult(id, result) {
  return {id, jsonrpc: "2.0", result}
}

/**
 * Builds a JSON-RPC error response.
 * @param {number | string | null | undefined} id - Request id.
 * @param {number} code - JSON-RPC error code.
 * @param {string} message - Error message.
 * @returns {JsonRpcMessage} - JSON-RPC response.
 */
function jsonRpcError(id, code, message) {
  return {error: {code, message}, id, jsonrpc: "2.0"}
}
