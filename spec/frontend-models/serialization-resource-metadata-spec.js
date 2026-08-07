// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import Comment from "../dummy/src/models/comment.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"

const sharedApiUrl = "http://localhost:3006/frontend-models"

/**
 * Builds a shared frontend-model index request body.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} payload - Index payload.
 * @returns {string} - JSON request body.
 */
function indexRequestBody(payload) {
  return JSON.stringify({
    requests: [{
      commandType: "index",
      model: "Task",
      payload,
      requestId: "1"
    }]
  })
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

      const body = indexRequestBody({
        limit: 10,
        preload: ["project", "comments"]
      })
      const resourcesByModelClassName = await captureSerializationResources(async () => {
        const response = await fetch(sharedApiUrl, {
          body,
          headers: {"content-type": "application/json"},
          method: "POST"
        })

        if (!response.ok) {
          throw new Error(`Frontend-model index failed: ${response.status} ${await response.text()}`)
        }
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

      const body = indexRequestBody({
        limit: 10,
        preload: ["comments"],
        select: {Comment: ["id", "body", "requestBaseUrl"]}
      })
      const response = await fetch(sharedApiUrl, {
        body,
        headers: {"content-type": "application/json"},
        method: "POST"
      })

      if (!response.ok) {
        throw new Error(`Frontend-model index failed: ${response.status} ${await response.text()}`)
      }

      const json = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (await response.json())
      const firstResponse = json.responses?.[0]
      const models = firstResponse?.response?.models

      expect(models).toBeInstanceOf(Array)

      const firstTask = models[0]
      const comments = firstTask?.__preloadedRelationships?.comments

      expect(comments).toBeInstanceOf(Array)
      expect(comments[0]?.requestBaseUrl).toMatch(/localhost:3006$/)
    })
  })

  it("does not share serialization resource instances across requests", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Cross-request project"})

      await Task.create({name: "Task A", project})

      /**
       * @param {string} _requestId - Request identifier.
       * @returns {Promise<import("../../src/frontend-model-resource/base-resource.js").default | undefined>} - Root Task resource instance.
       */
      async function fetchRootResource(_requestId) {
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
          const response = await fetch(sharedApiUrl, {
            body: indexRequestBody({limit: 10, preload: ["project"]}),
            headers: {"content-type": "application/json"},
            method: "POST"
          })

          if (!response.ok) {
            throw new Error(`Frontend-model index failed: ${response.status} ${await response.text()}`)
          }
        } finally {
          FrontendModelController.prototype._serializationResourceInstanceForModel = original
        }

        return rootResource
      }

      const firstResource = await fetchRootResource("first")
      const secondResource = await fetchRootResource("second")

      expect(firstResource).toBeTruthy()
      expect(secondResource).toBeTruthy()
      expect(firstResource).not.toBe(secondResource)
    })
  })
})
