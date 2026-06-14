// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import DatabaseRecord from "../../src/database/record/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"

/** @returns {Promise<void>} */
async function initializeTaskResourceModels() {
  await Project.initializeRecord({configuration: dummyConfiguration})
  await Task.initializeRecord({configuration: dummyConfiguration})
}

describe("FrontendModelBaseResource", {databaseCleaning: {transaction: true}}, () => {
  it("defaults to permitting nothing — subclasses must override to enable writes", () => {
    class ProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name", "description"]
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {}
    })

    expect(resource.permittedParams({action: "create"})).toEqual([])
  })

  it("supports Rails-style flat arrays mixing strings and nested-attributes keys", () => {
    class ProjectResource extends FrontendModelBaseResource {
      permittedParams() {
        return [
          "name",
          "description",
          {tasksAttributes: ["id", "_destroy", "name"]}
        ]
      }
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {}
    })

    expect(resource.permittedParams()).toEqual([
      "name",
      "description",
      {tasksAttributes: ["id", "_destroy", "name"]}
    ])
  })

  it("supports subclass overrides that vary by action and locals", () => {
    class ProjectResource extends FrontendModelBaseResource {
      /** @param {{action?: string, locals?: {isAdmin?: boolean}}} [arg] */
      permittedParams(arg) {
        const attrs = ["name", "description"]

        if (arg?.locals?.isAdmin) attrs.push("internalNotes")

        if (arg?.action === "create") {
          return [...attrs, {tasksAttributes: ["name"]}]
        }

        return attrs
      }
    }

    const adminResource = new ProjectResource({
      locals: {isAdmin: true},
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {}
    })
    const memberResource = new ProjectResource({
      locals: {isAdmin: false},
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {}
    })

    expect(adminResource.permittedParams({action: "create", locals: {isAdmin: true}})).toEqual([
      "name",
      "description",
      "internalNotes",
      {tasksAttributes: ["name"]}
    ])
    expect(memberResource.permittedParams({action: "update", locals: {isAdmin: false}})).toEqual([
      "name",
      "description"
    ])
  })

  it("runs mutation hooks through the base create and update implementations", async () => {
    await initializeTaskResourceModels()

    /**
     * @typedef {object} TaskResourceCreateAttributes
     * @property {string} [name] - Task name.
     * @property {number} [projectId] - Project id.
     */
    /**
     * @typedef {object} TaskResourceUpdateAttributes
     * @property {string} [name] - Task name.
     */
    class TaskResource extends FrontendModelBaseResource {
      events = []

      /** @returns {string[]} */
      permittedParams() {
        return ["name", "projectId"]
      }

      /** @param {TaskResourceCreateAttributes} attributes */
      normalizeCreateAttributes(attributes) {
        const name = attributes.name
        const projectId = attributes.projectId

        if (typeof name !== "string") throw new Error("Expected create name")
        if (typeof projectId !== "number") throw new Error("Expected create projectId")

        this.events.push(`normalize-create:${name}`)

        return {name: `${name} created`, projectId}
      }

      /** @param {Task} model */
      beforeCreate(model) {
        this.events.push(`before-create:${model.isNewRecord()}`)
      }

      /** @param {Task} model */
      afterCreate(model) {
        this.events.push(`after-create:${model.name()}`)
      }

      /**
       * @param {Task} model
       * @param {TaskResourceUpdateAttributes} attributes
       */
      normalizeUpdateAttributes(model, attributes) {
        const name = attributes.name

        if (typeof name !== "string") throw new Error("Expected update name")

        this.events.push(`normalize-update:${model.name()}:${name}`)

        return {name: `${name} updated`}
      }

      /** @param {Task} model */
      beforeUpdate(model) {
        this.events.push(`before-update:${model.name()}`)
      }

      /** @param {Task} model */
      afterUpdate(model) {
        this.events.push(`after-update:${model.name()}`)
      }

      /**
       * @template Result
       * @param {{action: "create" | "update" | "destroy", model: Task, callback: () => Promise<Result>}} args
       * @returns {Promise<Result>}
       */
      async runMutationTransaction({action, model, callback}) {
        this.events.push(`transaction-${action}-before:${model.isNewRecord()}`)
        const result = await callback()

        this.events.push(`transaction-${action}-after:${model.isNewRecord()}`)

        return result
      }
    }

    const resource = new TaskResource({
      modelClass: Task,
      modelName: "Task",
      params: {}
    })
    const project = await Project.create({})
    const createdTask = /** @type {Task} */ (await resource.create({name: "Original", projectId: project.id()}))
    const updatedTask = /** @type {Task} */ (await resource.update(createdTask, {name: "Renamed"}))

    expect(updatedTask.name()).toEqual("Renamed updated")
    expect(resource.events).toEqual([
      "normalize-create:Original",
      "transaction-create-before:true",
      "before-create:true",
      "after-create:Original created",
      "transaction-create-after:false",
      "normalize-update:Original created:Renamed",
      "transaction-update-before:false",
      "before-update:Original created",
      "after-update:Renamed updated",
      "transaction-update-after:false"
    ])
  })

  it("runs destroy hooks through the base destroy implementation", async () => {
    await initializeTaskResourceModels()

    class TaskResource extends FrontendModelBaseResource {
      events = []

      /** @param {Task} model */
      beforeDestroy(model) {
        this.events.push(`before-destroy:${model.name()}`)
      }

      /** @param {Task} model */
      afterDestroy(model) {
        this.events.push(`after-destroy:${model.name()}`)
      }

      /**
       * @template Result
       * @param {{action: "create" | "update" | "destroy", model: Task, callback: () => Promise<Result>}} args
       * @returns {Promise<Result>}
       */
      async runMutationTransaction({action, model, callback}) {
        this.events.push(`transaction-${action}-before:${model.isPersisted()}`)
        const result = await callback()

        this.events.push(`transaction-${action}-after:${model.isPersisted()}`)

        return result
      }
    }

    const resource = new TaskResource({
      modelClass: Task,
      modelName: "Task",
      params: {}
    })
    const project = await Project.create({})
    const task = await Task.create({name: "Destroy hooks", projectId: project.id()})
    const taskId = task.id()

    await resource.destroy(task)

    expect(await Task.findBy({id: taskId})).toEqual(null)
    expect(resource.events).toEqual([
      "transaction-destroy-before:true",
      "before-destroy:Destroy hooks",
      "after-destroy:Destroy hooks",
      "transaction-destroy-after:true"
    ])
  })
})
