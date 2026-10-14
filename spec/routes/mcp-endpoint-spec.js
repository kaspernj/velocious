// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import Dummy from "../dummy/index.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {boolean | {path?: string, token?: string}} mcp - MCP endpoint configuration.
 * @returns {Configuration} - Test configuration.
 */
function buildConfiguration(mcp = false) {
  return new Configuration({
    backendProjects: [],
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          name: "test-db",
          poolType: SingleMultiUsePool,
          type: "sqlite"
        }
      }
    },
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: true, file: false, levels: ["info", "warn", "error"]},
    mcp
  })
}

/**
 * @param {Configuration} configuration - Configuration instance.
 * @param {Record<string, unknown>} payload - JSON-RPC request payload.
 * @param {{authorization?: string, method?: string, path?: string}} [options] - Request options.
 * @returns {Promise<Response>} - Response after route resolution.
 */
async function resolvePost(configuration, payload, {authorization, method = "POST", path = "/mcp"} = {}) {
  const previousConfiguration = currentConfigurationOrUndefined()
  configuration.setCurrent()
  configuration.setRoutes(dummyRoutes.routes)

  const response = new Response({configuration})
  const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const authorizationHeaderLine = authorization ? ("Authorization: " + authorization + "\r\n") : ""
  const body = JSON.stringify(payload)

  try {
    request.feed(Buffer.from(
      method + " " + path + " HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: " + Buffer.byteLength(body) + "\r\n" + authorizationHeaderLine + "\r\n" + body,
      "utf8"
    ))
    await donePromise

    const resolver = new RoutesResolver({configuration, request, response})
    await resolver.resolve()
  } finally {
    await configuration.closeDatabaseConnections()

    if (previousConfiguration) previousConfiguration.setCurrent()
  }

  return response
}

/** @returns {Configuration | undefined} - Current configuration when one has been set. */
function currentConfigurationOrUndefined() {
  try {
    return Configuration.current()
  } catch {
    return
  }
}

/**
 * @param {Response} response - HTTP response.
 * @returns {Record<string, unknown>} - Parsed JSON body.
 */
function jsonBody(response) {
  const body = response.getBody()

  if (typeof body !== "string") throw new Error("Expected MCP response body to be a string")

  return JSON.parse(body)
}

/**
 * POSTs one JSON-RPC message to the dummy app's MCP endpoint over its real HTTP server.
 * @param {Record<string, unknown>} payload - JSON-RPC request payload.
 * @param {{authorization?: string}} [options] - Request options.
 * @returns {Promise<{payload: Record<string, unknown>, status: number}>} - Status and parsed JSON-RPC payload.
 */
async function postToDummyMcp(payload, {authorization} = {}) {
  const response = await fetch("http://127.0.0.1:3006/mcp", {
    body: JSON.stringify(payload),
    headers: {
      ...(authorization ? {Authorization: authorization} : {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  })
  const text = await response.text()

  return {payload: text.length > 0 ? JSON.parse(text) : {}, status: response.status}
}

describe("routes - mcp endpoint", () => {
  it("is disabled by default", async () => {
    const response = await resolvePost(buildConfiguration(), {id: 1, jsonrpc: "2.0", method: "initialize"})

    expect(response.getStatusCode()).toEqual(404)
  })

  it("rejects non-POST requests to the MCP path", async () => {
    const response = await resolvePost(buildConfiguration(true), {id: 4, jsonrpc: "2.0", method: "ping"}, {method: "GET"})

    expect(response.getStatusCode()).toEqual(404)
  })

  it("hides the endpoint when a token is configured and missing or wrong", async () => {
    const configuration = buildConfiguration({token: "secret-mcp-token"})

    expect((await resolvePost(configuration, {id: 5, jsonrpc: "2.0", method: "ping"})).getStatusCode()).toEqual(404)
    expect((await resolvePost(configuration, {id: 5, jsonrpc: "2.0", method: "ping"}, {authorization: "Bearer wrong-token"})).getStatusCode()).toEqual(404)
  })

  it("answers when the configured token is present", async () => {
    const configuration = buildConfiguration({token: "secret-mcp-token"})
    const response = await resolvePost(configuration, {id: 6, jsonrpc: "2.0", method: "ping"}, {authorization: "Bearer secret-mcp-token"})

    expect(response.getStatusCode()).toEqual(200)
    expect(jsonBody(response).result).toEqual({})
  })

  it("supports a custom path", async () => {
    const configuration = buildConfiguration({path: "/internal/mcp"})
    const response = await resolvePost(configuration, {id: 7, jsonrpc: "2.0", method: "ping"}, {path: "/internal/mcp"})

    expect(response.getStatusCode()).toEqual(200)
    expect(jsonBody(response).result).toEqual({})
  })

  it("answers initialize over the real HTTP server", async () => {
    await Dummy.run(async () => {
      const {payload, status} = await postToDummyMcp({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {capabilities: {}, protocolVersion: "2025-03-26"}
      })

      expect(status).toEqual(200)
      expect(payload.id).toEqual(1)
      expect(payload.result.protocolVersion).toEqual("2025-03-26")
      expect(payload.result.serverInfo.name).toEqual("velocious-mcp")
    })
  })

  it("lists the frontend-model tools over the real HTTP server", async () => {
    await Dummy.run(async () => {
      const {payload, status} = await postToDummyMcp({id: 2, jsonrpc: "2.0", method: "tools/list"})

      expect(status).toEqual(200)

      const toolNames = payload.result.tools.map((tool) => tool.name)

      expect(toolNames).toContain("task_index")
      expect(toolNames).toContain("frontend_model_api_manifest")
    })
  })

  it("executes tools/call through the frontend-model dispatcher over HTTP", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "MCP HTTP project"})

      await Task.create({name: "MCP HTTP task", projectId: project.id()})

      const {payload, status} = await postToDummyMcp({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {arguments: {where: {name: "MCP HTTP task"}}, name: "task_index"}
      })

      expect(status).toEqual(200)

      const toolResult = payload.result

      expect(toolResult.isError).toEqual(false)

      const commandPayload = JSON.parse(toolResult.content[0].text)

      expect(commandPayload.status).toEqual("success")
      expect(commandPayload.models[0].name).toEqual("MCP HTTP task")
    })
  })

  it("answers notifications with 202 and no JSON-RPC response", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://127.0.0.1:3006/mcp", {
        body: JSON.stringify({jsonrpc: "2.0", method: "notifications/initialized"}),
        headers: {"Content-Type": "application/json"},
        method: "POST"
      })

      expect(response.status).toEqual(202)
      expect(await response.text()).toEqual("")
    })
  })

  it("returns a JSON-RPC invalid-request error for malformed envelopes", async () => {
    await Dummy.run(async () => {
      const {payload, status} = await postToDummyMcp({foo: "bar"})

      expect(status).toEqual(200)
      expect(payload.error.code).toEqual(-32600)
    })
  })

  it("denies unauthorized tool calls through the app ability resolver over HTTP", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "MCP HTTP denied project"})
      const task = await Task.create({name: "MCP HTTP denied task", projectId: project.id()})
      const previousDeniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION

      try {
        process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION = "destroy"

        const {payload} = await postToDummyMcp({
          id: 8,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {arguments: {id: String(task.id())}, name: "task_destroy_by_id"}
        })

        expect(payload.result.isError).toEqual(true)
        expect(await Task.findBy({id: task.id()})).not.toEqual(null)
      } finally {
        if (previousDeniedAction === undefined) {
          delete process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION
        } else {
          process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION = previousDeniedAction
        }
      }
    })
  })
})
