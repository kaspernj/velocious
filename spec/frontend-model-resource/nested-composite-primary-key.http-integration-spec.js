// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"
import Configuration from "../../src/configuration.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import DatabaseRecord from "../../src/database/record/index.js"
import Dummy from "../dummy/index.js"
import Project from "../dummy/src/models/project.js"

/** Composite-key view of the dummy tasks table for nested-write coverage. */
class NestedCompositeTask extends DatabaseRecord {}

/** Parent view of the dummy projects table for nested-write coverage. */
class NestedCompositeProject extends DatabaseRecord {}

NestedCompositeTask.setTableName("tasks")
NestedCompositeTask.setPrimaryKey(["name", "project_id"])
NestedCompositeProject.setTableName("projects")
NestedCompositeProject.hasMany("nestedCompositeTasks", {className: "NestedCompositeTask", foreignKey: "project_id"})
NestedCompositeProject.acceptsNestedAttributesFor("nestedCompositeTasks", {allowDestroy: true})

/** Resource whose implicit composite key must resolve to frontend attribute names. */
class NestedCompositeTaskResource extends FrontendModelBaseResource {
  static ModelClass = NestedCompositeTask
  static attributes = ["name", "projectId", "description"]
  static builtInMemberCommands = ["find", "update", "destroy"]

  /** @returns {string[]} - Writable child attributes. */
  permittedParams() { return ["name", "projectId", "description"] }
}

/** Parent resource that accepts nested composite task updates and destroys. */
class NestedCompositeProjectResource extends FrontendModelBaseResource {
  static ModelClass = NestedCompositeProject
  static attributes = ["id"]
  static builtInMemberCommands = ["find", "update"]

  /** @returns {import("../../src/database/query/model-class-query.js").default<typeof NestedCompositeProject>} - Unscoped test query. */
  authorizedQuery() { return NestedCompositeProject.where({}) }

  /** @returns {Array<{nestedCompositeTasksAttributes: string[]}>} - Writable nested task attributes. */
  permittedParams() {
    return [{nestedCompositeTasksAttributes: ["id", "_destroy", "name", "description"]}]
  }
}

/**
 * Executes one shared frontend-model command against the real dummy server.
 * @param {"destroy" | "update"} commandType - Nested parent command.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} payload - Command payload.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Command response.
 */
async function postNestedProjectCommand(commandType, payload) {
  const response = await fetch("http://127.0.0.1:3006/frontend-models", {
    body: JSON.stringify(serializeFrontendModelTransportValue({
      modelName: "NestedCompositeProject",
      requests: [{
        commandType,
        model: "NestedCompositeProject",
        payload,
        requestId: "nested-composite-request"
      }]
    })),
    headers: {"Content-Type": "application/json"},
    method: "POST"
  })
  const responsePayload = deserializeFrontendModelTransportValue(JSON.parse(await response.text()))

  return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (responsePayload.responses?.[0]?.response || responsePayload)
}

describe("Frontend model resource - nested implicit composite keys", {databaseCleaning: {transaction: true}}, () => {
  it("updates and destroys nested children with frontend-safe identity attributes", async () => {
    await Dummy.run(async () => {
      const configuration = Configuration.current()
      const configuredBackendProjects = configuration.getBackendProjects()
      const originalBackendProjects = configuredBackendProjects.slice()
      const originalAbilityResolver = configuration.getAbilityResolver()
      const project = await Project.create({name: "Nested implicit composite project"})

      NestedCompositeTask.registerRecordClass({configuration})
      NestedCompositeProject.registerRecordClass({configuration})
      await NestedCompositeTask.ensureInitialized({configuration})
      await NestedCompositeProject.ensureInitialized({configuration})

      const task = await NestedCompositeTask.create({
        description: "Before",
        name: "Nested implicit composite task",
        projectId: project.id()
      })

      configuredBackendProjects.splice(0, configuredBackendProjects.length, {
        frontendModels: {
          NestedCompositeProject: NestedCompositeProjectResource,
          NestedCompositeTask: NestedCompositeTaskResource
        },
        path: originalBackendProjects[0].path
      })
      configuration.setAbilityResolver(undefined)

      try {
        const id = {name: task.readAttribute("name"), projectId: project.id()}
        const updatePayload = await postNestedProjectCommand("update", {
          attributes: {
            nestedCompositeTasksAttributes: [{description: "After", id}]
          },
          id: project.id()
        })

        if (updatePayload.status !== "success") {
          throw new Error(`Expected nested update success: ${JSON.stringify(updatePayload)}`)
        }
        expect((await NestedCompositeTask.findBy(id))?.readAttribute("description")).toEqual("After")

        const destroyPayload = await postNestedProjectCommand("update", {
          attributes: {
            nestedCompositeTasksAttributes: [{_destroy: true, id}]
          },
          id: project.id()
        })

        if (destroyPayload.status !== "success") {
          throw new Error(`Expected nested destroy success: ${JSON.stringify(destroyPayload)}`)
        }
        expect(await NestedCompositeTask.findBy(id)).toBeNull()
      } finally {
        configuration.setAbilityResolver(originalAbilityResolver)
        configuredBackendProjects.splice(0, configuredBackendProjects.length, ...originalBackendProjects)
      }
    })
  })
})
