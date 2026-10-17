// @ts-check

import {buildSyntheticRequestLines, callMcpTool} from "../../src/mcp/dispatcher.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {metaToolName} from "../../src/mcp/manifest-tools.js"
import Dummy from "../dummy/index.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * Reads the JSON text content of one MCP tool result.
 * @param {Record<string, any>} result - MCP tool result.
 * @returns {Record<string, any>} - Parsed JSON payload.
 */
function toolResultJson(result) {
  return JSON.parse(result.content[0].text)
}

describe("MCP dispatcher", () => {
  it("runs index commands through the frontend-model dispatcher", {timeoutSeconds: 180}, async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "MCP project"})

      await Task.create({name: "MCP index task", projectId: project.id()})

      const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {where: {name: "MCP index task"}}, toolName: "task_index"})

      expect(result.isError).toEqual(false)

      const payload = toolResultJson(result)

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].name).toEqual("MCP index task")
    })
  })

  it("runs create commands and persists the record", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "MCP create project"})
      const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {attributes: {description: "created via mcp", name: "MCP create task", projectId: project.id()}}, toolName: "composite_task_create"})

      expect(result.content[0].text).not.toContain("error")
      expect(result.isError).toEqual(false)

      const record = await Task.findBy({name: "MCP create task", projectId: project.id()})

      expect(record).not.toEqual(null)
      expect(record.description()).toEqual("created via mcp")
    })
  })

  it("runs update commands by id", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "MCP update project"})
      const task = await Task.create({name: "MCP update task", projectId: project.id()})

      const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {attributes: {name: "MCP updated task"}, id: String(task.id())}, toolName: "task_update_by_id"})

      expect(result.isError).toEqual(false)

      await task.reload()
      expect(task.name()).toEqual("MCP updated task")
    })
  })

  it("runs destroy commands by id", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "MCP destroy project"})
      const task = await Task.create({name: "MCP destroy task", projectId: project.id()})

      const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {id: String(task.id())}, toolName: "task_destroy_by_id"})

      expect(result.isError).toEqual(false)
      expect(await Task.findBy({id: task.id()})).toEqual(null)
    })
  })

  it("runs custom collection commands through the custom path dispatch", async () => {
    await Dummy.run(async () => {
      const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {email: "mcp-dispatcher@example.com"}, toolName: "user_lookup_by_email"})

      expect(result.isError).toEqual(false)

      const payload = toolResultJson(result)

      expect(Array.isArray(payload.users)).toEqual(true)
    })
  })

  it("surfaces dispatcher errors as MCP error results", async () => {
    await Dummy.run(async () => {
      const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {}, toolName: "task_find_by_id"})

      expect(result.isError).toEqual(true)
      expect(result.content[0].text).toContain("Expected model id.")
    })
  })

  it("denies unauthorized commands through the app ability resolver", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "MCP denied project"})
      const task = await Task.create({name: "MCP denied destroy task", projectId: project.id()})
      const previousDeniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION

      try {
        process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION = "destroy"

        const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {id: String(task.id())}, toolName: "task_destroy_by_id"})

        expect(result.isError).toEqual(true)
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

  it("returns the raw manifest from the meta tool", async () => {
    await Dummy.run(async () => {
      const result = await callMcpTool({configuration: dummyConfiguration, toolArguments: {}, toolName: metaToolName()})

      expect(result.isError).toEqual(false)

      const manifest = toolResultJson(result)

      expect(manifest.formatVersion).toEqual(1)
      expect(manifest.resources.Task).not.toEqual(undefined)
    })
  })

  it("forwards the request-context authorization as the synthetic request Authorization header", () => {
    const lines = buildSyntheticRequestLines({requestContext: {authorization: "Bearer tbz_service_token"}})

    expect(lines.includes("Authorization: Bearer tbz_service_token")).toEqual(true)
  })

  it("omits the Authorization header when no request-context authorization is configured", () => {
    expect(buildSyntheticRequestLines({requestContext: undefined}).includes("Authorization:")).toEqual(false)
    expect(buildSyntheticRequestLines({requestContext: {tenant: "acme"}}).includes("Authorization:")).toEqual(false)
  })

  it("strips line breaks from request-context authorization so request lines cannot be injected", () => {
    const lines = buildSyntheticRequestLines({requestContext: {authorization: "Bearer x\r\nX-Injected: 1"}})
    const headerLines = lines.split("\r\n")

    expect(headerLines.includes("X-Injected: 1")).toEqual(false)
    expect(headerLines.includes("Authorization: Bearer xX-Injected: 1")).toEqual(true)
  })
})
