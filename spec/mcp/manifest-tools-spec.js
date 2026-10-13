// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {frontendModelApiManifest} from "../../src/frontend-models/resource-definition.js"
import backendProjects from "../dummy/src/config/backend-projects.js"
import {generateMcpTools, metaToolName, parseMcpToolName} from "../../src/mcp/manifest-tools.js"

describe("MCP manifest tools", () => {
  const manifest = frontendModelApiManifest(backendProjects)

  it("generates one tool per built-in collection and member command", () => {
    const toolNames = generateMcpTools(manifest).map((tool) => tool.name)

    expect(toolNames).toContain("task_index")
    expect(toolNames).toContain("task_find_by_id")
    expect(toolNames).toContain("task_update_by_id")
    expect(toolNames).toContain("task_destroy_by_id")
    expect(toolNames).toContain("composite_task_create")
    expect(toolNames).toContain("composite_task_index")
  })

  it("generates tools for custom collection and member commands", () => {
    const toolNames = generateMcpTools(manifest).map((tool) => tool.name)

    expect(toolNames).toContain("user_lookup_by_email")
    expect(toolNames).toContain("user_echo_message")
    expect(toolNames).toContain("user_refresh_profile_by_id")
    expect(toolNames).toContain("task_board_move_card_by_id")
  })

  it("appends the manifest meta tool", () => {
    const tools = generateMcpTools(manifest)
    const metaTool = tools.find((tool) => tool.name === metaToolName())

    expect(metaTool).not.toEqual(undefined)
    expect(tools[tools.length - 1].name).toEqual(metaToolName())
  })

  it("builds index tool schemas from the frontend-model index payload surface", () => {
    const tools = generateMcpTools(manifest)
    const taskIndex = tools.find((tool) => tool.name === "task_index")
    const properties = /** @type {Record<string, any>} */ (taskIndex.inputSchema).properties

    expect(properties.where).not.toEqual(undefined)
    expect(properties.searches).not.toEqual(undefined)
    expect(properties.sort).not.toEqual(undefined)
    expect(properties.limit).not.toEqual(undefined)
    expect(properties.offset).not.toEqual(undefined)
    expect(properties.count).not.toEqual(undefined)
    expect(properties.pluck).not.toEqual(undefined)
  })

  it("requires primary key inputs for member tools", () => {
    const tools = generateMcpTools(manifest)
    const taskFind = /** @type {Record<string, any>} */ (tools.find((tool) => tool.name === "task_find_by_id"))

    expect(taskFind.inputSchema.required).toContain("id")
  })

  it("maps declared command arg types to JSON Schema types", () => {
    const typedManifest = {
      formatVersion: 1,
      resources: {
        Widget: {
          abilities: {},
          attributes: ["id"],
          builtInCommands: {collection: [], member: []},
          commands: {
            member: [{args: [{name: "size", type: "number"}, {name: "label", type: "string"}, {name: "active", type: "boolean"}], methodName: "resize", path: "/widgets/<id>/resize", scope: "member"}]
          },
          modelName: "Widget",
          path: "/widgets",
          primaryKey: "id"
        }
      }
    }
    const tools = generateMcpTools(typedManifest)
    const resize = /** @type {Record<string, any>} */ (tools.find((tool) => tool.name === "widget_resize_by_id"))
    const properties = resize.inputSchema.properties

    expect(properties.size.type).toEqual("number")
    expect(properties.label.type).toEqual("string")
    expect(properties.active.type).toEqual("boolean")
    expect(properties.id).not.toEqual(undefined)
  })

  it("parses generated tool names back to manifest command identities", () => {
    expect(parseMcpToolName({manifest, toolName: "task_index"})).toEqual({commandName: "index", modelKey: "Task", scope: "collection"})
    expect(parseMcpToolName({manifest, toolName: "task_destroy_by_id"})).toEqual({commandName: "destroy", modelKey: "Task", scope: "member"})
    expect(parseMcpToolName({manifest, toolName: "task_board_move_card_by_id"})).toEqual({commandName: "moveCard", modelKey: "TaskBoard", scope: "member"})
    expect(parseMcpToolName({manifest, toolName: "nope_index"})).toEqual(null)
    expect(parseMcpToolName({manifest, toolName: metaToolName()})).toEqual(null)
  })
})
