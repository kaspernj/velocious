// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Dummy from "../dummy/index.js"
import Comment from "../dummy/src/models/comment.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"

/**
 * Builds a controller for direct serialization testing.
 *
 * The request path is intentionally not a frontend-model ability route so that
 * ability-related authorization queries are skipped; this keeps the test
 * deterministic and free of extra database round-trips.
 *
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Frontend-model params.
 * @returns {FrontendModelController} - Controller instance.
 */
function buildSerializationController(params) {
  const request = {
    baseURL: () => "http://localhost:3006",
    header: () => undefined,
    headers: () => ({}),
    httpMethod: () => "POST",
    params: () => params,
    path: () => "/test-serialization"
  }
  const response = {}
  const controller = new FrontendModelController({
    action: "test",
    configuration: dummyConfiguration,
    controller: "test",
    params,
    request,
    response,
    viewPath: dummyConfiguration.getDirectory()
  })

  // Bypass transport deserialization so the test can feed plain params directly.
  controller._frontendModelParams = params

  return controller
}

/**
 * Captures resource instances resolved during serialization.
 * @param {() => Promise<void>} callback - Callback whose serialization is captured.
 * @returns {Promise<Map<string, Set<import("../../src/frontend-model-resource/base-resource.js").default>>>} - Resource instances grouped by model class name.
 */
async function captureSerializationResources(callback) {
  /** @type {Map<string, Set<import("../../src/frontend-model-resource/base-resource.js").default>>} */
  const resourcesByModelClassName = new Map()
  const original = FrontendModelController.prototype._serializationResourceInstanceForModel

  FrontendModelController.prototype._serializationResourceInstanceForModel = function(model) {
    const resource = original.call(this, model)
    const modelClassName = /** @type {typeof import("../../src/database/record/index.js").default} */ (model.constructor).getModelName()

    if (resource) {
      const set = resourcesByModelClassName.get(modelClassName) || new Set()

      set.add(resource)
      resourcesByModelClassName.set(modelClassName, set)
    }

    return resource
  }

  try {
    await callback()
  } finally {
    FrontendModelController.prototype._serializationResourceInstanceForModel = original
  }

  return resourcesByModelClassName
}

describe("FrontendModel serialization resource metadata", {databaseCleaning: {transaction: true}}, () => {
  it("reuses the same resource instance for multiple models of the same class", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Shared resource project"})
      const taskOne = await Task.create({name: "Task one", project})
      const taskTwo = await Task.create({name: "Task two", project})

      await Comment.create({body: "Comment one", task: taskOne})
      await Comment.create({body: "Comment two", task: taskTwo})

      const tasks = await Task.where({id: [taskOne.id(), taskTwo.id()]}).preload(["project", "comments"]).toArray()
      const controller = buildSerializationController({
        model: "Task",
        preload: ["project", "comments"]
      })
      const resourcesByModelClassName = await captureSerializationResources(async () => {
        await controller.serializeFrontendModels(tasks)
      })

      expect(resourcesByModelClassName.get("Task")?.size).toEqual(1)
      expect(resourcesByModelClassName.get("Project")?.size).toEqual(1)
      expect(resourcesByModelClassName.get("Comment")?.size).toEqual(1)
    })
  })

  it("still invokes custom virtual attributes on preloaded related resources", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Custom attribute project"})
      const task = await Task.create({name: "Task with comment", project})

      await Comment.create({body: "A comment", task})

      const tasks = await Task.where({id: task.id()}).preload(["comments"]).toArray()
      const controller = buildSerializationController({
        model: "Task",
        preload: ["comments"],
        select: {Comment: ["id", "body", "requestBaseUrl"]}
      })
      const serialized = await controller.serializeFrontendModels(tasks)
      const firstTask = serialized[0]
      const comments = firstTask?.__preloadedRelationships?.comments

      expect(comments).toBeInstanceOf(Array)
      expect(comments[0]?.requestBaseUrl).toMatch(/localhost:3006$/)
    })
  })

  it("does not share serialization resource instances across controllers", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Cross-request project"})
      const task = await Task.create({name: "Task A", project})

      const tasks = await Task.where({id: task.id()}).preload(["project"]).toArray()

      /**
       * @param {string} _label - Controller label.
       * @returns {Promise<import("../../src/frontend-model-resource/base-resource.js").default | undefined>} - Root Task resource instance.
       */
      async function captureRootResource(_label) {
        const controller = buildSerializationController({
          model: "Task",
          preload: ["project"]
        })
        let rootResource
        const original = FrontendModelController.prototype._serializationResourceInstanceForModel

        FrontendModelController.prototype._serializationResourceInstanceForModel = function(model) {
          const resource = original.call(this, model)

          if (model.constructor === Task && !rootResource) {
            rootResource = resource
          }

          return resource
        }

        try {
          await controller.serializeFrontendModels(tasks)
        } finally {
          FrontendModelController.prototype._serializationResourceInstanceForModel = original
        }

        return rootResource
      }

      const firstResource = await captureRootResource("first")
      const secondResource = await captureRootResource("second")

      expect(firstResource).toBeTruthy()
      expect(secondResource).toBeTruthy()
      expect(firstResource).not.toBe(secondResource)
    })
  })
})
