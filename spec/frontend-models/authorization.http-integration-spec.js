// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import Comment from "../dummy/src/models/comment.js"
import Project from "../dummy/src/models/project.js"
import TaskModel from "../dummy/src/models/task.js"
import Task from "../dummy/src/frontend-models/task.js"
import User from "../dummy/src/models/user.js"

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

/**
 * @param {object} args - Arguments.
 * @param {string} args.projectName - Project name.
 * @param {string} args.taskName - Task name.
 * @param {string} [args.creatingUserReference] - Optional project owner reference.
 * @returns {Promise<TaskModel>} - Created task model.
 */
async function createTaskWithProject({projectName, taskName, creatingUserReference}) {
  const project = await Project.create({
    creatingUserReference,
    name: projectName
  })

  return /** @type {TaskModel} */ (await TaskModel.create({
    name: taskName,
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

  it("sorts frontend-model records by one-level relationship path", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await createTaskWithProject({projectName: "Alpha project", taskName: "Alpha task"})
        await createTaskWithProject({projectName: "Zulu project", taskName: "Zulu task"})

        const tasks = await Task
          .sort({project: ["name", "desc"]})
          .toArray()

        expect(tasks.map((task) => task.name())).toEqual(["Zulu task", "Alpha task"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("sorts frontend-model records by nested relationship path", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await User.create({
          email: "alpha-owner@example.com",
          encryptedPassword: "secret",
          reference: "owner-alpha"
        })
        await User.create({
          email: "zulu-owner@example.com",
          encryptedPassword: "secret",
          reference: "owner-zulu"
        })

        await createTaskWithProject({
          creatingUserReference: "owner-alpha",
          projectName: "Project A",
          taskName: "Alpha owner task"
        })
        await createTaskWithProject({
          creatingUserReference: "owner-zulu",
          projectName: "Project Z",
          taskName: "Zulu owner task"
        })

        const tasks = await Task
          .sort({project: {creatingUser: ["reference", "desc"]}})
          .toArray()

        expect(tasks.map((task) => task.name())).toEqual(["Zulu owner task", "Alpha owner task"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("paginates frontend-model records with limit/offset and page/perPage", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await createTask("Alpha task")
        await createTask("Bravo task")

        const limitOffsetTasks = await Task
          .order("name")
          .offset(1)
          .limit(1)
          .toArray()
        const pageTasks = await Task
          .order("name")
          .page(2)
          .perPage(1)
          .toArray()

        expect(limitOffsetTasks.map((task) => task.name())).toEqual(["Bravo task"])
        expect(pageTasks.map((task) => task.name())).toEqual(["Bravo task"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("sorts frontend-model records with multiple nested sort tuples", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await User.create({
          email: "alpha-owner-2@example.com",
          encryptedPassword: "secret",
          reference: "owner-alpha-2"
        })
        await User.create({
          email: "zulu-owner-2@example.com",
          encryptedPassword: "secret",
          reference: "owner-zulu-2"
        })

        await createTaskWithProject({
          creatingUserReference: "owner-alpha-2",
          projectName: "Project A2",
          taskName: "Alpha owner task 2"
        })
        await createTaskWithProject({
          creatingUserReference: "owner-zulu-2",
          projectName: "Project Z2",
          taskName: "Zulu owner task 2"
        })

        const tasks = await Task
          .sort({project: {creatingUser: [["reference", "desc"], ["createdAt", "asc"]]}})
          .toArray()

        expect(tasks.map((task) => task.name())).toEqual(["Zulu owner task 2", "Alpha owner task 2"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("deduplicates frontend-model rows with distinct() across has-many joins", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const task = await createTask(`Distinct task ${Date.now()}`)

        await Comment.create({body: "Comment A", taskId: task.id()})
        await Comment.create({body: "Comment B", taskId: task.id()})

        const withoutDistinct = await Task
          .search(["comments"], "id", "gteq", 1)
          .toArray()
        const withDistinct = await Task
          .select({Task: ["id"]})
          .search(["comments"], "id", "gteq", 1)
          .distinct()
          .toArray()

        const withoutDistinctTaskIds = withoutDistinct
          .map((record) => record.id())
          .filter((recordId) => recordId === task.id())
        const withDistinctTaskIds = withDistinct
          .map((record) => record.id())
          .filter((recordId) => recordId === task.id())

        expect(withoutDistinctTaskIds.length).toEqual(2)
        expect(withDistinctTaskIds.length).toEqual(1)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("rejects non-boolean distinct() values", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await expect(async () => {
          await Task.distinct("1 OR 1=1").toArray()
        }).toThrow(/distinct must be a boolean/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })
})
