// @ts-check

import {waitFor} from "awaitery"
import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import FrontendModelBase, {VelociousAttachment} from "../../src/frontend-models/base.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import {modelPrimaryKeyCacheKey} from "../../src/utils/model-primary-key.js"
import Dummy from "../dummy/index.js"
import backendProjects from "../dummy/src/config/backend-projects.js"
import ProjectRecord from "../dummy/src/models/project.js"
import TaskRecord from "../dummy/src/models/task.js"
import {configureNodeTransport, configureWebsocketSharedTransport, resetFrontendModelTransport} from "../helpers/frontend-model-http-transport.js"

/** Frontend model with a composite resource identity backed by dummy tasks. */
class CompositeTask extends FrontendModelBase {
  /** @returns {import("../../src/frontend-models/base.js").FrontendModelResourceConfig} - Resource config. */
  static resourceConfig() {
    return {
      attributes: ["name", "projectId", "description"],
      attachments: {descriptionFile: {type: "hasOne"}},
      builtInCollectionCommands: ["create", "index"],
      builtInMemberCommands: ["find", "update", "destroy"],
      modelName: "CompositeTask",
      primaryKey: ["name", "projectId"]
    }
  }

  /** @returns {string} - Task name. */
  name() { return this.readAttribute("name") }

  /** @param {string} value - Task name. @returns {void} */
  setName(value) { this.setAttribute("name", value) }

  /** @returns {number} - Project id. */
  projectId() { return this.readAttribute("projectId") }

  /** @param {number} value - Project id. @returns {void} */
  setProjectId(value) { this.setAttribute("projectId", value) }

  /** @returns {string | null} - Task description. */
  description() { return this.readAttribute("description") }

  /** @param {string} value - Task description. @returns {void} */
  setDescription(value) { this.setAttribute("description", value) }
}

FrontendModelBase.registerModel(CompositeTask)

describe("Frontend models - composite primary key HTTP integration", {databaseCleaning: {transaction: true}}, () => {
  it("creates, finds, updates, rekeys, and destroys a composite-identity model", async () => {
    await Dummy.run(async () => {
      const originalProject = await ProjectRecord.create({name: "Composite frontend original project"})
      const replacementProject = await ProjectRecord.create({name: "Composite frontend replacement project"})

      configureNodeTransport()

      try {
        const task = await CompositeTask.create({
          description: "Before",
          name: "Composite frontend task",
          projectId: originalProject.id()
        })
        await CompositeTask.create({
          description: "Second",
          name: "Composite frontend task two",
          projectId: originalProject.id()
        })

        expect(task.primaryKeyValue()).toEqual({name: "Composite frontend task", projectId: originalProject.id()})

        const listedTasks = await CompositeTask
          .where({projectId: originalProject.id()})
          .sort(["name"])
          .toArray()

        expect(listedTasks.map((listedTask) => listedTask.name())).toEqual([
          "Composite frontend task",
          "Composite frontend task two"
        ])

        const foundTask = await CompositeTask.find(task.primaryKeyValue())

        expect(foundTask.description()).toEqual("Before")
        foundTask.setDescription("After")
        await foundTask.save()
        expect(foundTask.description()).toEqual("After")

        foundTask.setName("Composite frontend renamed")
        foundTask.setProjectId(replacementProject.id())
        await foundTask.save()

        expect(foundTask.primaryKeyValue()).toEqual({name: "Composite frontend renamed", projectId: replacementProject.id()})
        expect((await CompositeTask.find(foundTask.primaryKeyValue())).description()).toEqual("After")

        await foundTask.destroy()
        await expect(async () => await CompositeTask.find(foundTask.primaryKeyValue())).toThrow(/not found/u)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("rejects malformed composite frontend identities before transport", async () => {
    const invalidIdentities = [
      "Composite frontend task",
      ["Composite frontend task", 1],
      null,
      {name: "Composite frontend task"},
      {name: "Composite frontend task", projectId: 1, extra: true},
      {name: null, projectId: 1},
      {name: "Composite frontend task", projectId: undefined}
    ]

    for (const identity of invalidIdentities) {
      await expect(async () => await CompositeTask.find(identity)).toThrow(/composite primary key identity/u)
    }
  })

  it("loads composite-resource attachment metadata through the backing record identity", async () => {
    await Dummy.run(async () => {
      const project = await ProjectRecord.create({name: "Composite attachment project"})
      const task = await TaskRecord.create({name: "Composite attachment task", project})

      await task.getAttachmentByName("descriptionFile").attach({
        contentBase64: Buffer.from("composite attachment").toString("base64"),
        contentType: "text/plain",
        filename: "composite.txt"
      })
      configureNodeTransport()

      try {
        const loadedTask = await CompositeTask.find({name: task.name(), projectId: project.id()})
        const attachment = await loadedTask.getAttachmentByName("descriptionFile").first()

        if (!attachment) throw new Error("Expected composite attachment metadata")
        expect(attachment.filename()).toEqual("composite.txt")
        expect(attachment.recordType()).toEqual("Task")
        expect(attachment.recordId()).toEqual(modelPrimaryKeyCacheKey(TaskRecord.primaryKey(), task.id()))
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("publishes lifecycle events for every frontend resource backed by the same model", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await ProjectRecord.create({name: "Shared lifecycle project"})
      /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
      const taskIds = []
      /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
      const compositeTaskIds = []

      await websocketClient.connect()
      const taskSubscription = websocketClient.subscribeChannel("frontend-models", {
        onMessage: (body) => { taskIds.push(body.id) },
        params: {model: "Task"}
      })
      await taskSubscription.waitForReady()
      configureWebsocketSharedTransport(websocketClient)
      const offCompositeTaskCreate = await CompositeTask.onCreate((event) => { compositeTaskIds.push(event.id) })

      try {
        const task = await TaskRecord.create({name: "Shared lifecycle task", project})

        await waitFor(() => {
          if (taskIds.length < 1 || compositeTaskIds.length < 1) {
            throw new Error(`Expected both resource events but got Task=${taskIds.length}, CompositeTask=${compositeTaskIds.length}`)
          }
        })

        expect(taskIds).toEqual([task.id()])
        expect(compositeTaskIds).toEqual([{name: task.name(), projectId: project.id()}])
      } finally {
        taskSubscription.close()
        offCompositeTaskCreate()
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("serializes unprojected lifecycle records through the subscribed resource", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await ProjectRecord.create({name: "Serialized lifecycle project"})
      const task = await TaskRecord.create({name: "Serialized lifecycle task", project})

      configureWebsocketSharedTransport(websocketClient)

      /** @type {CompositeTask | undefined} */
      let lifecycleTask
      const offUpdate = await CompositeTask.onUpdate((event) => {
        lifecycleTask = /** @type {CompositeTask} */ (event.model)
      })

      try {
        task.setDescription("Serialized lifecycle description")
        await task.save()

        await waitFor(() => {
          if (!lifecycleTask) throw new Error("Expected serialized composite lifecycle update")
        })
        if (!lifecycleTask) throw new Error("Expected serialized composite lifecycle task")

        expect(Object.keys(lifecycleTask.attributes()).sort()).toEqual(["description", "name", "projectId"])
      } finally {
        offUpdate()
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("keeps canonical attachment ownership on unprojected lifecycle records", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await ProjectRecord.create({name: "Lifecycle attachment project"})
      const task = await TaskRecord.create({name: "Lifecycle attachment task", project})

      await task.getAttachmentByName("descriptionFile").attach({
        contentBase64: Buffer.from("lifecycle attachment").toString("base64"),
        contentType: "text/plain",
        filename: "lifecycle.txt"
      })
      configureWebsocketSharedTransport(websocketClient)

      /** @type {CompositeTask | undefined} */
      let lifecycleTask
      const offUpdate = await CompositeTask.onUpdate((event) => {
        lifecycleTask = /** @type {CompositeTask} */ (event.model)
      })

      try {
        task.setDescription("Lifecycle attachment updated")
        await task.save()

        await waitFor(() => {
          if (!lifecycleTask) throw new Error("Expected composite lifecycle update")
        })
        if (!lifecycleTask) throw new Error("Expected composite lifecycle task")

        const attachment = await lifecycleTask.getAttachmentByName("descriptionFile").first()

        if (!attachment) throw new Error("Expected lifecycle attachment metadata")
        expect(attachment.filename()).toEqual("lifecycle.txt")
        expect(attachment.recordType()).toEqual("Task")
        expect(attachment.recordId()).toEqual(modelPrimaryKeyCacheKey(TaskRecord.primaryKey(), task.id()))
      } finally {
        offUpdate()
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("routes a projected backing-record rekey through the previous composite identity", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await ProjectRecord.create({name: "Remote rekey project"})
      const task = await TaskRecord.create({name: "Remote rekey task", project})

      configureNodeTransport()
      const loadedTask = await CompositeTask.find({name: task.name(), projectId: project.id()})
      const projectedTask = await TaskRecord
        .select(["id", "description", "projectId"])
        .find(task.id())

      if (!projectedTask) throw new Error("Expected projected backing task")

      configureWebsocketSharedTransport(websocketClient)

      /** @type {Array<import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
      const updateIds = []
      const offUpdate = await loadedTask.onUpdate((event) => {
        updateIds.push(/** @type {import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue} */ (event.id))
      })

      try {
        projectedTask.setName("Remote rekey renamed")
        await projectedTask.save()

        await waitFor(() => {
          if (updateIds.length < 1) throw new Error("Expected projected remote rekey update")
        })
        expect(updateIds[0]).toEqual({name: "Remote rekey renamed", projectId: project.id()})
        expect(loadedTask.name()).toEqual("Remote rekey renamed")
      } finally {
        offUpdate()
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("publishes destroy events for projected backing records through the composite identity", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await ProjectRecord.create({name: "Projected destroy project"})
      const task = await TaskRecord.create({name: "Projected destroy task", project})
      const projectedTask = await TaskRecord
        .select(["id", "description", "projectId"])
        .find(task.id())

      if (!projectedTask) throw new Error("Expected projected backing task")

      configureWebsocketSharedTransport(websocketClient)
      /** @type {Array<import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
      const destroyIds = []
      const offDestroy = await CompositeTask.onDestroy((event) => {
        destroyIds.push(/** @type {import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue} */ (event.id))
      })

      try {
        await projectedTask.destroy()

        await waitFor(() => {
          if (destroyIds.length < 1) throw new Error("Expected projected composite destroy")
        })
        expect(destroyIds).toEqual([{name: task.name(), projectId: project.id()}])
      } finally {
        offDestroy()
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("authorizes attachment metadata through an alias-only frontend resource", async () => {
    await Dummy.run(async () => {
      const configuration = Configuration.current()
      const configuredBackendProjects = configuration.getBackendProjects()
      const originalBackendProjects = configuredBackendProjects.slice()
      const project = await ProjectRecord.create({name: "HTTP attachment project"})
      const task = await TaskRecord.create({name: "HTTP attachment task", projectId: project.id()})

      await task.descriptionFile().attach({
        content: "description attachment",
        contentType: "text/plain",
        filename: "description.txt"
      })

      const compositeTaskResource = backendProjects[0].frontendModels.CompositeTask

      configuredBackendProjects.splice(0, configuredBackendProjects.length, {
        frontendModels: {CompositeTask: compositeTaskResource},
        path: backendProjects[0].path
      })
      configureNodeTransport()

      try {
        const loadedTask = await CompositeTask.find({name: task.name(), projectId: project.id()})
        const attachment = await loadedTask.getAttachmentByName("descriptionFile").first()

        if (!attachment) throw new Error("Expected alias attachment metadata")
        expect(attachment.filename()).toEqual("description.txt")
        expect((await VelociousAttachment.find(attachment.id())).filename()).toEqual("description.txt")
      } finally {
        configuredBackendProjects.splice(0, configuredBackendProjects.length, ...originalBackendProjects)
        resetFrontendModelTransport()
      }
    })
  })
})
