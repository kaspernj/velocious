// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import DatabaseRecord from "../../src/database/record/index.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"

describe("FrontendModelBaseResource", {databaseCleaning: {transaction: true}}, () => {
  it("falls back to shared resource static config when environment resource omits it", () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name"]
      static abilities = ["approve", "archive"]
      static relationships = ["tasks"]
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    expect(ProjectResource.resourceConfig()).toEqual({
      abilities: ["approve", "archive"],
      attributes: ["id", "name"],
      relationships: ["tasks"]
    })
  })

  it("uses environment resource static config before shared resource static config", () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name"]
      static abilities = ["approve"]
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
      static attributes = ["id", "title"]
    }

    expect(ProjectResource.resourceConfig()).toEqual({
      abilities: ["approve"],
      attributes: ["id", "title"]
    })
  })

  it("falls back to shared resource translated attributes", () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      static translatedAttributes = ["name", "description"]
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    expect(ProjectResource.translatedAttributesConfig()).toEqual(["name", "description"])
  })

  it("falls back to shared static command config", () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "name"]

      static collectionCommands = ["refreshAll"]

      static memberCommands = ["archive"]
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    expect(ProjectResource.resourceConfig()).toEqual({
      attributes: ["id", "name"],
      collectionCommands: ["refreshAll"],
      memberCommands: ["archive"]
    })
  })

  it("preserves inherited environment static config before shared resource static config", () => {
    class ParentProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "parentName"]
      static abilities = ["parentRead"]
    }

    class SharedProjectResource extends FrontendModelBaseResource {
      static attributes = ["id", "sharedName", "sharedSecret"]
      static abilities = ["sharedRead", "sharedUpdate"]
    }

    class ProjectResource extends ParentProjectResource {
      static SharedResource = SharedProjectResource
    }

    expect(ProjectResource.resourceConfig()).toEqual({
      abilities: ["parentRead"],
      attributes: ["id", "parentName"]
    })
  })

  it("runs shared abilities against the environment resource model class", () => {
    const ModelClass = class ProjectForSharedAbilities extends DatabaseRecord {}
    /** @type {{actions: string, conditions: unknown, modelClass: typeof DatabaseRecord}[]} */
    const calls = []
    const ability = /** @type {import("../../src/authorization/ability.js").default} */ ({
      /**
       * @param {string} actions - Ability action.
       * @param {typeof DatabaseRecord} modelClass - Ability model class.
       * @param {unknown} conditions - Ability conditions.
       * @returns {void}
       */
      can(actions, modelClass, conditions) {
        calls.push({actions, conditions, modelClass})
      }
    })

    class SharedProjectResource extends FrontendModelBaseResource {
      abilities() {
        this.can("read")
      }
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    const resource = new ProjectResource({
      ability,
      modelClass: ModelClass,
      modelName: "Project",
      params: {}
    })

    resource.abilities()

    expect(calls).toEqual([{actions: "read", conditions: undefined, modelClass: ModelClass}])
  })

  it("falls back to shared resource instance methods when environment resource uses defaults", () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      /** @returns {Array<string | Record<string, ?>>} */
      permittedParams() {
        return ["name", {tasksAttributes: ["name"]}]
      }

      /** @returns {{sharedNormalized: boolean}} */
      normalizeCreateAttributes() {
        return {sharedNormalized: true}
      }
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {}
    })

    expect(resource.permittedParams({action: "create"})).toEqual(["name", {tasksAttributes: ["name"]}])
    expect(resource.normalizeCreateAttributes({}, {})).toEqual({sharedNormalized: true})
  })

  it("uses environment resource instance methods before shared resource methods", () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      /** @returns {string[]} */
      permittedParams() {
        return ["sharedName"]
      }
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource

      /** @returns {string[]} */
      permittedParams() {
        return ["environmentName"]
      }
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {}
    })

    expect(resource.permittedParams({action: "create"})).toEqual(["environmentName"])
  })

  it("resolves shared custom command and attribute hook methods", () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      /** @returns {{status: string}} */
      refresh() {
        return {status: "shared"}
      }

      /** @returns {string} */
      statusAttribute() {
        return "shared-status"
      }
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    const resource = new ProjectResource({
      modelClass: class extends DatabaseRecord {},
      modelName: "Project",
      params: {}
    })

    const command = resource.resourceMethod("refresh")
    const attribute = resource.resourceMethod("statusAttribute")

    expect(command?.method.call(command.resource)).toEqual({status: "shared"})
    expect(attribute?.method.call(attribute.resource)).toEqual("shared-status")
  })

  it("exposes portable context helpers and model registry to shared resources", () => {
    const now = new Date("2026-01-02T03:04:05.000Z")
    const currentUser = {id: 123}
    const currentDevice = {id: "scanner-1"}
    const offlineGrant = {id: "grant-1"}

    class SharedProjectResource extends FrontendModelBaseResource {
      /** @returns {Record<string, ?>} */
      contextSnapshot() {
        return {
          currentDevice: this.currentDevice(),
          currentUser: this.currentUser(),
          isBackend: this.isBackend(),
          isFrontend: this.isFrontend(),
          isOffline: this.isOffline(),
          now: this.now(),
          offlineGrant: this.offlineGrant(),
          taskModel: this.model("Task")
        }
      }
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    const resource = new ProjectResource({
      context: {
        currentDevice,
        currentUser,
        modelRegistry: {Task},
        now: () => now,
        offlineGrant,
        resourceRuntime: "backend"
      },
      modelClass: Project,
      modelName: "Project",
      params: {}
    })
    const method = resource.resourceMethod("contextSnapshot")

    expect(method?.method.call(method.resource)).toEqual({
      currentDevice,
      currentUser,
      isBackend: true,
      isFrontend: false,
      isOffline: true,
      now,
      offlineGrant,
      taskModel: Task
    })
  })

  it("applies shared virtual setters", async () => {
    class SharedProjectResource extends FrontendModelBaseResource {
      /** @returns {string[]} */
      permittedParams() {
        return ["status"]
      }

      /**
       * @param {Project} model - Project model.
       * @param {unknown} value - Status value.
       * @returns {void}
       */
      setStatusAttribute(model, value) {
        model.setTasksCount(Number(value))
      }
    }

    class ProjectResource extends FrontendModelBaseResource {
      static SharedResource = SharedProjectResource
    }

    const resource = new ProjectResource({
      modelClass: Project,
      modelName: "Project",
      params: {}
    })
    const model = await Project.create({})

    await resource.update(model, {status: 42})

    expect(model.tasksCount()).toEqual(42)
  })

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

  it("runs mutation hooks through the base create and update implementations", {type: "model"}, async () => {
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
        if (projectId == null) throw new Error("Expected create projectId")

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

    expect(createdTask.projectId()).toEqual(project.id())
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

  it("runs destroy hooks through the base destroy implementation", {type: "model"}, async () => {
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
