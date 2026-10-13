// @ts-check

import {PassThrough} from "node:stream"
import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {handleMcpRequest, startMcpStdioServer} from "../../src/mcp/json-rpc-server.js"
import {metaToolName} from "../../src/mcp/manifest-tools.js"

describe("MCP JSON-RPC server", () => {
  it("answers initialize with the MCP protocol handshake", async () => {
    await Dummy.run(async () => {
      const response = await handleMcpRequest({
        configuration: dummyConfiguration,
        request: {id: 1, jsonrpc: "2.0", method: "initialize", params: {capabilities: {}, protocolVersion: "2025-03-26"}}
      })

      expect(response.id).toEqual(1)
      expect(response.result.protocolVersion).toEqual("2025-03-26")
      expect(response.result.serverInfo.name).toEqual("velocious-mcp")
      expect(response.result.capabilities.tools).not.toEqual(undefined)
    })
  })

  it("answers ping with an empty result", async () => {
    await Dummy.run(async () => {
      const response = await handleMcpRequest({configuration: dummyConfiguration, request: {id: 2, jsonrpc: "2.0", method: "ping"}})

      expect(response.id).toEqual(2)
      expect(response.result).toEqual({})
    })
  })

  it("lists tools on tools/list", async () => {
    await Dummy.run(async () => {
      const response = await handleMcpRequest({configuration: dummyConfiguration, request: {id: 3, jsonrpc: "2.0", method: "tools/list"}})

      expect(Array.isArray(response.result.tools)).toEqual(true)

      const toolNames = response.result.tools.map((tool) => tool.name)

      expect(toolNames).toContain("task_index")
      expect(toolNames).toContain("frontend_model_api_manifest")
    })
  })

  it("executes tools/call through the dispatcher", async () => {
    await Dummy.run(async () => {
      const response = await handleMcpRequest({
        configuration: dummyConfiguration,
        request: {id: 4, jsonrpc: "2.0", method: "tools/call", params: {arguments: {count: true}, name: "task_index"}}
      })

      expect(response.id).toEqual(4)
      expect(response.result.isError).toEqual(false)

      const payload = JSON.parse(response.result.content[0].text)

      expect(payload.status).toEqual("success")
      expect(typeof payload.count).toEqual("number")
    })
  })

  it("returns a JSON-RPC error for unknown methods", async () => {
    await Dummy.run(async () => {
      const response = await handleMcpRequest({configuration: dummyConfiguration, request: {id: 5, jsonrpc: "2.0", method: "resources/list"}})

      expect(response.error.code).toEqual(-32601)
    })
  })

  it("returns a JSON-RPC error for invalid requests", async () => {
    await Dummy.run(async () => {
      const response = await handleMcpRequest({configuration: dummyConfiguration, request: {method: "tools/list"}})

      expect(response.error.code).toEqual(-32600)
    })
  })

  it("serves line-delimited JSON-RPC over stdio streams", async () => {
    await Dummy.run(async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const lines = []

      output.on("data", (chunk) => {
        lines.push(chunk.toString("utf8"))
      })

      const server = startMcpStdioServer({configuration: dummyConfiguration, input, output})

      input.write(`${JSON.stringify({id: 1, jsonrpc: "2.0", method: "initialize", params: {capabilities: {}, protocolVersion: "2025-03-26"}})}\n`)
      input.write(`${JSON.stringify({id: 2, jsonrpc: "2.0", method: "tools/list"})}\n`)
      input.write(`${JSON.stringify({jsonrpc: "2.0", method: "notifications/initialized"})}\n`)
      input.end()

      await server.done

      const responses = lines.map((line) => JSON.parse(line))

      expect(responses.length).toEqual(2)
      expect(responses[0].id).toEqual(1)
      expect(responses[0].result.protocolVersion).toEqual("2025-03-26")
      expect(responses[1].id).toEqual(2)
      expect(Array.isArray(responses[1].result.tools)).toEqual(true)
    })
  })

  it("writes tool call responses that complete after the input stream closed", async () => {
    await Dummy.run(async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const lines = []

      output.on("data", (chunk) => {
        lines.push(chunk.toString("utf8"))
      })

      const server = startMcpStdioServer({configuration: dummyConfiguration, input, output})

      input.write(`${JSON.stringify({id: 1, jsonrpc: "2.0", method: "tools/call", params: {arguments: {}, name: metaToolName()}})}\n`)
      input.end()

      await server.done

      const responses = lines.map((line) => JSON.parse(line))

      expect(responses.length).toEqual(1)
      expect(responses[0].id).toEqual(1)
      expect(responses[0].result.isError).toEqual(false)
    })
  })

  it("reports parse errors on malformed input lines", async () => {
    await Dummy.run(async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const lines = []

      output.on("data", (chunk) => {
        lines.push(chunk.toString("utf8"))
      })

      const server = startMcpStdioServer({configuration: dummyConfiguration, input, output})

      input.write("this is not json\n")
      input.end()

      await server.done

      const responses = lines.map((line) => JSON.parse(line))

      expect(responses.length).toEqual(1)
      expect(responses[0].error.code).toEqual(-32700)
    })
  })
})
