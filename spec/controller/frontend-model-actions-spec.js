// @ts-check

import Ability from "../../src/authorization/ability.js"
import BaseResource from "../../src/authorization/base-resource.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Comment from "../dummy/src/models/comment.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import User from "../dummy/src/models/user.js"

/**
 * @param {string} path - Request path.
 * @param {Record<string, any>} payload - JSON payload.
 * @returns {Promise<Record<string, any>>} - Parsed response payload.
 */
async function postFrontendModel(path, payload) {
  const response = await fetch(`http://127.0.0.1:3006${path}`, {
    body: JSON.stringify(serializeFrontendModelTransportValue(payload)),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  })
  const responseText = await response.text()
  try {
    const responseJson = responseText.length > 0 ? JSON.parse(responseText) : {}

    return /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(responseJson))
  } catch (error) {
    void error

    return {
      errorMessage: responseText,
      status: "error"
    }
  }
}

/**
 * @param {"destroy" | "find" | "index" | "update"} commandType - Command.
 * @param {Record<string, any>} payload - Command payload.
 * @returns {Promise<Record<string, any>>} - Command response payload.
 */
async function postSharedTaskFrontendModelCommand(commandType, payload) {
  const response = await postFrontendModel("/velocious/api", {
    requests: [{
      commandType,
      model: "Task",
      payload,
      requestId: "request-1"
    }]
  })

  return /** @type {Record<string, any>} */ (response.responses?.[0]?.response || response)
}

/**
 * @param {import("../../src/configuration-types.js").AbilityResolverType | undefined} resolver - Temporary resolver.
 * @param {() => Promise<void>} callback - Callback.
 * @returns {Promise<void>}
 */
async function withDummyAbilityResolver(resolver, callback) {
  const previousResolver = dummyConfiguration.getAbilityResolver()

  dummyConfiguration.setAbilityResolver(resolver)

  try {
    await callback()
  } finally {
    dummyConfiguration.setAbilityResolver(previousResolver)
  }
}

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
 * @param {string} name - Task name.
 * @returns {Promise<Task>} - Created task.
 */
async function createTask(name) {
  const project = await Project.create({name: `Project for ${name}`})

  return /** @type {Task} */ (await Task.create({
    name,
    projectId: project.id()
  }))
}

/**
 * @param {object} args - Arguments.
 * @param {string} args.projectName - Project name.
 * @param {string} args.taskName - Task name.
 * @param {string} [args.creatingUserReference] - Optional project owner reference.
 * @returns {Promise<Task>} - Created task model.
 */
async function createTaskWithProject({projectName, taskName, creatingUserReference}) {
  const project = await Project.create({
    creatingUserReference,
    name: projectName
  })

  return /** @type {Task} */ (await Task.create({
    name: taskName,
    projectId: project.id()
  }))
}

describe("Controller frontend model actions", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("does not override scoped distinct when distinct param is omitted", async () => {
    /** Ability resource adding a distinct scope for Task reads. */
    class TaskDistinctScopeResource extends BaseResource {
      static ModelClass = Task

      /** @returns {void} */
      abilities() {
        this.can("read", Task, (query) => query.distinct(true))
      }
    }

    await withDummyAbilityResolver(async ({configuration, params, request, response}) => {
      const requestPath = request.path().split("?")[0]
      const modelName = params.modelName

      if (!(requestPath === "/velocious/api" && modelName === "Task")) return

      return new Ability({
        context: {configuration, params, request, response},
        resources: [TaskDistinctScopeResource]
      })
    }, async () => {
      await Dummy.run(async () => {
        const task = await createTask(`Distinct scoped ${Date.now()}`)

        await Comment.create({body: "Scoped comment A", taskId: task.id()})
        await Comment.create({body: "Scoped comment B", taskId: task.id()})

        const payload = await postSharedTaskFrontendModelCommand("index", {
          searches: [{column: "id", operator: "gteq", path: ["comments"], value: 1}],
          where: {id: task.id()}
        })

        const occurrences = payload.models.filter((model) => model.id === task.id()).length

        expect(payload.status).toEqual("success")
        expect(occurrences).toEqual(1)
      })
    })
  })

  it("returns models from frontendIndex", async () => {
    await Dummy.run(async () => {
      await createTask("Index Alpha")
      await createTask("Index Beta")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        sort: "name asc"
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Index Alpha", "Index Beta"])
    })
  })

  it("handles shared frontend-model API batch requests by model name", async () => {
    await Dummy.run(async () => {
      await createTask("Batch Alpha")
      await createTask("Batch Beta")

      const payload = await postFrontendModel("/velocious/api", {
        requests: [
          {
            commandType: "index",
            model: "Task",
            payload: {sort: "name asc"},
            requestId: "request-1"
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.responses.length).toEqual(1)
      expect(payload.responses[0].requestId).toEqual("request-1")
      expect(payload.responses[0].response.status).toEqual("success")
      expect(payload.responses[0].response.models.map((model) => model.name)).toEqual(["Batch Alpha", "Batch Beta"])
    })
  })

  it("applies preload params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Preload Task")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        preload: {project: true},
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].__preloadedRelationships.project).toEqual(null)
    })
  })

  it("merges nested preload entries from array shorthand", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Merged preload task")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        preload: [
          {project: ["tasks"]},
          {project: ["projectDetail"]}
        ],
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].__preloadedRelationships.project).toEqual(null)
    })
  })

  it("applies limit, offset, perPage, and page params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      await createTask("Page Alpha")
      await createTask("Page Bravo")

      const limitOffsetPayload = await postFrontendModel("/api/frontend-models/tasks/list", {
        limit: 1,
        offset: 1,
        sort: "name asc"
      })
      const pagePayload = await postFrontendModel("/api/frontend-models/tasks/list", {
        page: 2,
        perPage: 1,
        sort: "name asc"
      })

      expect(limitOffsetPayload.models.map((model) => model.name)).toEqual(["Page Bravo"])
      expect(pagePayload.models.map((model) => model.name)).toEqual(["Page Bravo"])
    })
  })

  it("applies distinct params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const task = await createTask(`Distinct Controller ${Date.now()}`)

      await Comment.create({body: "Distinct comment A", taskId: task.id()})
      await Comment.create({body: "Distinct comment B", taskId: task.id()})

      const withoutDistinctPayload = await postFrontendModel("/api/frontend-models/tasks/list", {
        searches: [{column: "id", operator: "gteq", path: ["comments"], value: 1}]
      })
      const withDistinctPayload = await postFrontendModel("/api/frontend-models/tasks/list", {
        distinct: true,
        searches: [{column: "id", operator: "gteq", path: ["comments"], value: 1}]
      })

      const withoutDistinctCount = withoutDistinctPayload.models.filter((model) => model.id === task.id()).length
      const withDistinctCount = withDistinctPayload.models.filter((model) => model.id === task.id()).length

      expect(withoutDistinctCount).toEqual(2)
      expect(withDistinctCount).toEqual(1)
    })
  })

  it("rejects non-boolean distinct params on frontendIndex", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        distinct: "1 OR 1=1"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid distinct/)
    })
  })

  it("rejects non-numeric pagination params on frontendIndex", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        limit: "1; DROP TABLE accounts"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid limit/)
    })
  })

  it("filters serialized frontendIndex attributes by select map", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Select Task")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        select: {Task: ["id"]},
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0]).toEqual({id: task.id()})
    })
  })

  it("applies search params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      await createTask("Search Alpha")
      await createTask("Search Beta")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        searches: [
          {
            column: "name",
            operator: "eq",
            path: [],
            value: "Search Beta"
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Search Beta"])
    })
  })

  it("applies relationship-path search params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const taskA = await createTaskWithProject({projectName: "Search Project A", taskName: "Task A"})
      const taskB = await createTaskWithProject({projectName: "Search Project B", taskName: "Task B"})

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        searches: [
          {
            column: "id",
            operator: "eq",
            path: ["project"],
            value: taskB.projectId()
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Task B"])
      expect(payload.models[0].id).toEqual(taskB.id())
      expect(payload.models.find((model) => model.id === taskA.id())).toEqual(undefined)
    })
  })

  it("applies relationship-path group params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      await createTask("Grouped Task A")
      await createTask("Grouped Task B")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        group: ["id"],
        sort: "name asc"
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(2)
    })
  })

  it("rejects unsafe string group params", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        group: "id; DROP TABLE accounts"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid group column/)
    })
  })

  it("returns plucked values from frontendIndex", async () => {
    await Dummy.run(async () => {
      const alphaTask = await createTask("Pluck Alpha")
      const betaTask = await createTask("Pluck Beta")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        pluck: ["id", "name"],
        sort: "name asc",
        where: {id: [alphaTask.id(), betaTask.id()]}
      })

      expect(payload.status).toEqual("success")
      expect(payload.values.length).toEqual(2)
      expect(payload.values.map((row) => row[0]).sort((a, b) => a - b)).toEqual([alphaTask.id(), betaTask.id()].sort((a, b) => a - b))
    })
  })

  it("applies relationship-path pluck params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const firstTask = await createTaskWithProject({projectName: "Pluck project A", taskName: "Pluck relation A"})
      const secondTask = await createTaskWithProject({projectName: "Pluck project B", taskName: "Pluck relation B"})

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        pluck: {project: ["id"]},
        sort: "name asc",
        where: {id: [firstTask.id(), secondTask.id()]}
      })

      expect(payload.status).toEqual("success")
      expect(payload.values.length).toEqual(2)
      expect(payload.values[0]).not.toEqual(payload.values[1])
    })
  })

  it("reuses existing joined paths when pluck path overlaps search and sort joins", async () => {
    await Dummy.run(async () => {
      const firstTask = await createTaskWithProject({projectName: "Overlap project A", taskName: "Overlap task A"})
      const secondTask = await createTaskWithProject({projectName: "Overlap project B", taskName: "Overlap task B"})

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        pluck: {project: ["id"]},
        searches: [
          {
            column: "id",
            operator: "gteq",
            path: ["project"],
            value: 1
          }
        ],
        sort: "project.id asc",
        where: {id: [firstTask.id(), secondTask.id()]}
      })

      expect(payload.status).toEqual("success")
      expect(payload.values.length).toEqual(2)
    })
  })

  it("rejects unsafe string pluck params", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        pluck: "id; DROP TABLE accounts"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid pluck column/)
    })
  })

  it("returns one model from frontendFind", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Find task")
      const payload = await postFrontendModel("/api/frontend-models/tasks/find", {id: task.id()})

      expect(payload.status).toEqual("success")
      expect(payload.model.id).toEqual(task.id())
      expect(payload.model.name).toEqual("Find task")
    })
  })

  it("applies preload params to frontendFind query", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Find preload task")

      const payload = await postFrontendModel("/api/frontend-models/tasks/find", {
        id: task.id(),
        preload: {project: true}
      })

      expect(payload.status).toEqual("success")
      expect(payload.model.__preloadedRelationships.project).toEqual(null)
    })
  })

  it("returns error payload when frontendFind record is missing", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/api/frontend-models/tasks/find", {id: 404})

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toEqual("Task not found.")
    })
  })

  it("returns no models from frontendIndex when read ability scope denies access", async () => {
    await withDeniedTaskAbilityAction("read", async () => {
      await Dummy.run(async () => {
        await createTask("Denied index")

        const payload = await postSharedTaskFrontendModelCommand("index", {})

        expect(payload).toEqual({models: [], status: "success"})
      })
    })
  })

  it("returns not found from frontendFind when read ability scope denies access", async () => {
    await withDeniedTaskAbilityAction("read", async () => {
      await Dummy.run(async () => {
        const task = await createTask("Denied find")
        const payload = await postSharedTaskFrontendModelCommand("find", {id: task.id()})

        expect(payload.status).toEqual("error")
        expect(payload.errorMessage).toEqual("Task not found.")
      })
    })
  })

  it("returns not found from frontendUpdate when update ability scope denies access", async () => {
    await withDeniedTaskAbilityAction("update", async () => {
      await Dummy.run(async () => {
        const task = await createTask("Denied update")

        const payload = await postSharedTaskFrontendModelCommand("update", {
          attributes: {name: "Changed"},
          id: task.id()
        })

        expect(payload.status).toEqual("error")
        expect(payload.errorMessage).toEqual("Task not found.")
      })
    })
  })

  it("returns not found from frontendDestroy when destroy ability scope denies access", async () => {
    await withDeniedTaskAbilityAction("destroy", async () => {
      await Dummy.run(async () => {
        const task = await createTask("Denied destroy")

        const payload = await postSharedTaskFrontendModelCommand("destroy", {
          id: task.id()
        })

        expect(payload.status).toEqual("error")
        expect(payload.errorMessage).toEqual("Task not found.")
      })
    })
  })

  it("updates models from frontendUpdate", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Update me")

      const payload = await postFrontendModel("/api/frontend-models/tasks/update", {
        attributes: {name: "Updated task"},
        id: task.id()
      })
      const persisted = await Task.find(task.id())

      expect(payload.status).toEqual("success")
      expect(payload.model.name).toEqual("Updated task")
      expect(persisted.name()).toEqual("Updated task")
    })
  })

  it("destroys models from frontendDestroy", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Destroy me")

      const payload = await postFrontendModel("/api/frontend-models/tasks/destroy", {id: task.id()})
      const persisted = await Task.findBy({id: task.id()})

      expect(payload.status).toEqual("success")
      expect(persisted).toEqual(null)
    })
  })

  it("returns error when frontendFind id is missing", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/api/frontend-models/tasks/find", {})

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toEqual("Expected model id.")
    })
  })

  it("supports relationship-path search through project creating user", async () => {
    await Dummy.run(async () => {
      await User.create({
        email: "owner-a@example.com",
        encryptedPassword: "secret",
        reference: "owner-a"
      })
      await User.create({
        email: "owner-b@example.com",
        encryptedPassword: "secret",
        reference: "owner-b"
      })
      await createTaskWithProject({
        creatingUserReference: "owner-a",
        projectName: "Owner Project A",
        taskName: "Owner Task A"
      })
      await createTaskWithProject({
        creatingUserReference: "owner-b",
        projectName: "Owner Project B",
        taskName: "Owner Task B"
      })

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        searches: [
          {
            column: "reference",
            operator: "eq",
            path: ["project", "creatingUser"],
            value: "owner-b"
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Owner Task B"])
    })
  })
})
