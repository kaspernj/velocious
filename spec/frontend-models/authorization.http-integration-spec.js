// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import Project from "../dummy/src/models/project.js"
import TaskModel from "../dummy/src/models/task.js"
import Task from "../dummy/src/frontend-models/task.js"

/**
 * @param {"destroy" | "read" | "update" | undefined} deniedAbilityAction - Ability action to deny.
 * @param {() => Promise<void>} callback - Callback.
 * @returns {Promise<void>}
 */
async function withDeniedTaskAbilityAction(deniedAbilityAction, callback) {
  const previousDeniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION

  try {
    process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION = deniedAbilityAction
    await callback()
  } finally {
    if (previousDeniedAction === undefined) {
      delete process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION
    } else {
      process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION = previousDeniedAction
    }
  }
}

/**
 * @returns {void}
 */
function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({
    baseUrl: undefined,
    baseUrlResolver: undefined,
    credentials: undefined,
    pathPrefix: undefined,
    pathPrefixResolver: undefined,
    request: undefined
  })
}

/**
 * @returns {void}
 */
function configureNodeTransport() {
  FrontendModelBase.configureTransport({
    baseUrl: "http://127.0.0.1:3006"
  })
}

/**
 * @param {string} name - Task name.
 * @returns {Promise<TaskModel>}
 */
async function createTask(name) {
  const project = await Project.create({name: `Project for ${name}`})

  return /** @type {TaskModel} */ (await TaskModel.create({
    name,
    projectId: project.id()
  }))
}

describe("Frontend models - authorization http integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("returns no rows from toArray when read ability denies access", async () => {
    await withDeniedTaskAbilityAction("read", async () => {
      await Dummy.run(async () => {
        configureNodeTransport()

        try {
          await createTask("Denied list task")

          const tasks = await Task.toArray()

          expect(tasks).toEqual([])
        } finally {
          resetFrontendModelTransport()
        }
      })
    })
  })

  it("raises from find when read ability denies access", async () => {
    await withDeniedTaskAbilityAction("read", async () => {
      await Dummy.run(async () => {
        configureNodeTransport()

        try {
          const backendTask = await createTask("Denied find task")

          await expect(async () => {
            await Task.find(backendTask.id())
          }).toThrow(/Task not found/)
        } finally {
          resetFrontendModelTransport()
        }
      })
    })
  })

  it("raises from update when update ability denies access", async () => {
    await withDeniedTaskAbilityAction("update", async () => {
      await Dummy.run(async () => {
        configureNodeTransport()

        try {
          const backendTask = await createTask("Denied update task")

          const frontendTask = await Task.find(backendTask.id())

          await expect(async () => {
            await frontendTask.update({name: "Changed name"})
          }).toThrow(/Task not found/)

          const persistedTask = await TaskModel.findBy({id: backendTask.id()})

          expect(persistedTask?.name()).toEqual("Denied update task")
        } finally {
          resetFrontendModelTransport()
        }
      })
    })
  })

  it("raises from destroy when destroy ability denies access", async () => {
    await withDeniedTaskAbilityAction("destroy", async () => {
      await Dummy.run(async () => {
        configureNodeTransport()

        try {
          const backendTask = await createTask("Denied destroy task")

          const frontendTask = await Task.find(backendTask.id())

          await expect(async () => {
            await frontendTask.destroy()
          }).toThrow(/Task not found/)

          const persistedTask = await TaskModel.findBy({id: backendTask.id()})

          expect(persistedTask?.name()).toEqual("Denied destroy task")
        } finally {
          resetFrontendModelTransport()
        }
      })
    })
  })
})
