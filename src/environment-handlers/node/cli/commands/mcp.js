// @ts-check

import Application from "../../../../application.js"
import BaseCommand from "../../../../cli/base-command.js"
import {startMcpStdioServer} from "../../../../mcp/json-rpc-server.js"

/**
 * Parses `--request-context key=value` occurrences from raw process args and the
 * `MCP_REQUEST_CONTEXT` environment variable (JSON object) into one context hash.
 * @param {object} args - Arguments.
 * @param {string[]} [args.processArgs] - Raw CLI process args.
 * @returns {Record<string, string | number | boolean> | undefined} - Parsed request context, or undefined when none configured.
 */
export function parseMcpRequestContext({processArgs = []}) {
  /** @type {Record<string, string | number | boolean>} */
  const context = {}

  const envValue = process.env.MCP_REQUEST_CONTEXT

  if (envValue) {
    const parsedEnv = /** @type {Record<string, unknown>} */ (JSON.parse(envValue))

    for (const [key, value] of Object.entries(parsedEnv)) {
      assignContextValue(context, key, value)
    }
  }

  for (let i = 0; i < processArgs.length; i++) {
    if (processArgs[i] !== "--request-context") continue

    const pair = processArgs[i + 1]

    if (typeof pair !== "string") throw new Error("--request-context requires a key=value pair")

    const separatorIndex = pair.indexOf("=")

    if (separatorIndex < 1) throw new Error(`--request-context pair '${pair}' must be key=value`)

    assignContextValue(context, pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1))
    i++
  }

  return Object.keys(context).length > 0 ? context : undefined
}

/**
 * Assigns one scalar context value, converting numeric strings to numbers.
 * @param {Record<string, string | number | boolean>} context - Target context hash.
 * @param {string} key - Context key.
 * @param {unknown} value - Raw value.
 * @returns {void} - No return value.
 */
function assignContextValue(context, key, value) {
  if (typeof value === "number" || typeof value === "boolean") {
    context[key] = value

    return
  }

  if (typeof value !== "string") throw new Error(`Request context value for '${key}' must be a scalar`)

  const asNumber = Number(value)

  context[key] = value.length > 0 && Number.isFinite(asNumber) ? asNumber : value
}

export default class VelociousCliCommandsMcp extends BaseCommand{
  /**
   * Runs execute.
   * @returns {Promise<void>} - Starts the MCP stdio server and waits until stdin closes.
   */
  async execute() {
    // Identify this process in `ps`/`top` instead of a generic "node" entry.
    process.title = "velocious mcp"

    const configuration = this.getConfiguration()
    const requestContext = parseMcpRequestContext({processArgs: this.processArgs})
    const application = new Application({configuration, type: "mcp"})

    await application.initialize()

    const server = startMcpStdioServer({configuration, requestContext})

    await server.done
    await application.stop()
  }
}
