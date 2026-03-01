// @ts-check

import Ability from "../../src/authorization/ability.js"
import BaseResource from "../../src/authorization/base-resource.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"
import Dummy from "../dummy/index.js"
import backendProjects from "../dummy/src/config/backend-projects.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Comment from "../dummy/src/models/comment.js"
import Project from "../dummy/src/models/project.js"
import ProjectDetail from "../dummy/src/models/project-detail.js"
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
  const responseJson = responseText.length > 0 ? JSON.parse(responseText) : {}

  return /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(responseJson))
}

/**
 * @param {string} path - Request path.
 * @param {Record<string, any>} payload - JSON payload.
 * @returns {Promise<Record<string, any>>} - Parsed response payload without transport deserialization.
 */
async function postFrontendModelRaw(path, payload) {
  const response = await fetch(`http://127.0.0.1:3006${path}`, {
    body: JSON.stringify(serializeFrontendModelTransportValue(payload)),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  })
  const responseText = await response.text()

  return responseText.length > 0 ? JSON.parse(responseText) : {}
}

/** @returns {Record<string, any>} - Task frontend resource configuration. */
function taskResourceConfiguration() {
  return /** @type {Record<string, any>} */ (backendProjects[0].resources.Task)
}

/**
 * @param {Partial<Record<string, any>>} overrides - Resource overrides.
 * @param {() => Promise<void>} callback - Callback.
 * @returns {Promise<void>}
 */
async function withTaskResourceConfiguration(overrides, callback) {
  const resource = taskResourceConfiguration()
  const previous = {...resource}

  Object.assign(resource, overrides)

  try {
    await callback()
  } finally {
    Object.keys(resource).forEach((key) => {
      if (!(key in previous)) {
        delete resource[key]
      }
    })
    Object.assign(resource, previous)
  }
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

      if (requestPath !== "/api/frontend-models/tasks/list") return

      return new Ability({
        context: {configuration, params, request, response},
        resources: [TaskDistinctScopeResource]
      })
    }, async () => {
      await Dummy.run(async () => {
        const task = await createTask(`Distinct scoped ${Date.now()}`)

        await Comment.create({body: "Scoped comment A", taskId: task.id()})
        await Comment.create({body: "Scoped comment B", taskId: task.id()})

        const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
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
      expect(payload.models[0].__preloadedRelationships.project.name).toMatch(/Project for Preload Task/)
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
      expect(payload.models[0].__preloadedRelationships.project.__preloadedRelationships.tasks.length).toEqual(1)
      expect(payload.models[0].__preloadedRelationships.project.__preloadedRelationships.projectDetail).toEqual(null)
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
      expect(payload.models).toEqual([{id: task.id()}])
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
      await createTaskWithProject({projectName: "Search Project A", taskName: "Task A"})
      await createTaskWithProject({projectName: "Search Project B", taskName: "Task B"})

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        searches: [
          {
            column: "name",
            operator: "eq",
            path: ["project"],
            value: "Search Project B"
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Task B"])
    })
  })

  it("applies relationship-path group params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Grouped project"})
      await Task.create({name: "Grouped Task A", projectId: project.id()})
      await Task.create({name: "Grouped Task B", projectId: project.id()})

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        group: {project: ["id"]},
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

      expect(payload).toEqual({
        status: "success",
        values: [
          [alphaTask.id(), "Pluck Alpha"],
          [betaTask.id(), "Pluck Beta"]
        ]
      })
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
      expect(payload.model.__preloadedRelationships.project.id).toEqual(task.projectId())
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

        const payload = await postFrontendModel("/api/frontend-models/tasks/list", {})

        expect(payload).toEqual({models: [], status: "success"})
      })
    })
  })

  it("returns not found from frontendFind when read ability scope denies access", async () => {
    await withDeniedTaskAbilityAction("read", async () => {
      await Dummy.run(async () => {
        const task = await createTask("Denied find")
        const payload = await postFrontendModel("/api/frontend-models/tasks/find", {id: task.id()})

        expect(payload.status).toEqual("error")
        expect(payload.errorMessage).toEqual("Task not found.")
      })
    })
  })

  it("returns not found from frontendUpdate when update ability scope denies access", async () => {
    await withDeniedTaskAbilityAction("update", async () => {
      await Dummy.run(async () => {
        const task = await createTask("Denied update")

        const payload = await postFrontendModel("/api/frontend-models/tasks/update", {
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

        const payload = await postFrontendModel("/api/frontend-models/tasks/destroy", {
          id: task.id()
        })

        expect(payload.status).toEqual("error")
        expect(payload.errorMessage).toEqual("Task not found.")
      })
    })
  })

  it("runs server beforeAction callback", async () => {
    let beforeActionCalls = 0

    await withTaskResourceConfiguration({
      server: {
        beforeAction: async () => {
          beforeActionCalls += 1
          return true
        }
      }
    }, async () => {
      await Dummy.run(async () => {
        const payload = await postFrontendModel("/api/frontend-models/tasks/list", {})

        expect(payload.status).toEqual("success")
      })
    })

    expect(beforeActionCalls).toEqual(1)
  })

  it("supports server records callback", async () => {
    await withTaskResourceConfiguration({
      server: {
        records: async () => {
          const callbackTask = await createTask("Records callback task")

          return [callbackTask]
        }
      }
    }, async () => {
      await Dummy.run(async () => {
        await createTask("Regular task")

        const payload = await postFrontendModel("/api/frontend-models/tasks/list", {})

        expect(payload.status).toEqual("success")
        expect(payload.models.map((model) => model.name)).toEqual(["Records callback task"])
      })
    })
  })

  it("supports server serialize callback", async () => {
    await withTaskResourceConfiguration({
      server: {
        serialize: async ({model}) => {
          return {
            id: model.id(),
            label: model.name()
          }
        }
      }
    }, async () => {
      await Dummy.run(async () => {
        const task = await createTask("Serialize callback task")

        const payload = await postFrontendModel("/api/frontend-models/tasks/find", {id: task.id()})

        expect(payload.status).toEqual("success")
        expect(payload.model).toEqual({
          id: task.id(),
          label: "Serialize callback task"
        })
      })
    })
  })

  it("deserializes Date and undefined markers from request params", async () => {
    /** @type {{attributes: Record<string, any> | null}} */
    const seen = {attributes: null}
    const dueAt = new Date("2026-02-20T12:00:00.000Z")

    await withTaskResourceConfiguration({
      server: {
        update: async ({attributes, model}) => {
          seen.attributes = attributes
          model.assign({name: "Updated from callback"})
          await model.save()

          return model
        }
      }
    }, async () => {
      await Dummy.run(async () => {
        const task = await createTask("Deserialize markers task")

        const payload = await postFrontendModel("/api/frontend-models/tasks/update", {
          attributes: {
            dueAt,
            optionalValue: undefined
          },
          id: task.id()
        })

        expect(payload.status).toEqual("success")
      })
    })

    expect(seen.attributes?.dueAt instanceof Date).toEqual(true)
    expect(seen.attributes?.dueAt.toISOString()).toEqual("2026-02-20T12:00:00.000Z")
    expect("optionalValue" in /** @type {Record<string, any>} */ (seen.attributes)).toEqual(true)
    expect(seen.attributes?.optionalValue).toEqual(undefined)
  })

  it("serializes Date, undefined, bigint and non-finite number values in frontend JSON responses", async () => {
    const createdAt = new Date("2026-02-20T12:00:00.000Z")

    await withTaskResourceConfiguration({
      server: {
        serialize: async ({model}) => {
          return {
            createdAt,
            hugeCounter: 9007199254740993n,
            id: model.id(),
            missing: undefined,
            notANumber: Number.NaN,
            positiveInfinity: Number.POSITIVE_INFINITY
          }
        }
      }
    }, async () => {
      await Dummy.run(async () => {
        const task = await createTask("Serialize markers task")
        const payload = await postFrontendModelRaw("/api/frontend-models/tasks/find", {id: task.id()})

        expect(payload).toEqual({
          model: {
            createdAt: {__velocious_type: "date", value: "2026-02-20T12:00:00.000Z"},
            hugeCounter: {__velocious_type: "bigint", value: "9007199254740993"},
            id: task.id(),
            missing: {__velocious_type: "undefined"},
            notANumber: {__velocious_type: "number", value: "NaN"},
            positiveInfinity: {__velocious_type: "number", value: "Infinity"}
          },
          status: "success"
        })
      })
    })
  })

  it("fails when resource abilities are missing", async () => {
    await withTaskResourceConfiguration({abilities: undefined}, async () => {
      await Dummy.run(async () => {
        const payload = await postFrontendModel("/api/frontend-models/tasks/list", {})

        expect(payload.status).toEqual("error")
        expect(payload.errorMessage).toMatch(/must define an 'abilities' object/)
      })
    })
  })

  it("serializes missing preloaded singular relationships as null", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Missing preloaded singular task")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        preload: {project: ["projectDetail"]},
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models[0].__preloadedRelationships.project.__preloadedRelationships.projectDetail).toEqual(null)
    })
  })

  it("filters serialized preloaded model attributes by select map", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Select preloaded task")

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        preload: {project: true},
        select: {
          Project: ["name"],
          Task: ["id"]
        },
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models).toEqual([
        {
          __preloadedRelationships: {
            project: {
              name: `Project for Select preloaded task`
            }
          },
          id: task.id()
        }
      ])
    })
  })

  it("does not serialize unauthorized nested preloaded relationships", async () => {
    /** Ability resource allowing Task but not Project reads. */
    class TaskOnlyResource extends BaseResource {
      static ModelClass = Task

      /** @returns {void} */
      abilities() {
        this.can("read", Task)
      }
    }

    await withDummyAbilityResolver(async ({configuration, params, request, response}) => {
      const requestPath = request.path().split("?")[0]
      const modelName = params.modelName

      if (!(requestPath === "/velocious/api" && modelName === "Task")) return

      return new Ability({
        context: {configuration, params, request, response},
        resources: [TaskOnlyResource]
      })
    }, async () => {
      await Dummy.run(async () => {
        await createTask("Unauthorized nested preload task")

        const payload = await postFrontendModel("/velocious/api", {
          modelName: "Task",
          payload: {preload: {project: true}, sort: "name asc"},
          requestId: "request-unauthorized-nested",
          requests: [{
            commandType: "index",
            model: "Task",
            payload: {preload: {project: true}, sort: "name asc"},
            requestId: "request-unauthorized-nested"
          }]
        })
        const modelPayload = payload.responses[0].response.models[0]

        expect(payload.status).toEqual("success")
        expect(modelPayload.__preloadedRelationships.project).toEqual(null)
      })
    })
  })

  it("authorizes preloaded has-many relationships in bulk", async () => {
    /** Ability resource allowing Project and selected Task rows. */
    class ProjectTaskResource extends BaseResource {
      static ModelClass = Project

      /** @returns {void} */
      abilities() {
        this.can("read", Project)
        this.can("read", Task, {name: ["Allowed has-many task A", "Allowed has-many task B"]})
      }
    }

    await withDummyAbilityResolver(async ({configuration, params, request, response}) => {
      const requestPath = request.path().split("?")[0]

      if (requestPath !== "/api/frontend-models/projects/list") return

      return new Ability({
        context: {configuration, params, request, response},
        resources: [ProjectTaskResource]
      })
    }, async () => {
      await Dummy.run(async () => {
        const project = await Project.create({name: "Has-many authorization project"})

        await Task.create({name: "Allowed has-many task A", projectId: project.id()})
        await Task.create({name: "Denied has-many task", projectId: project.id()})
        await Task.create({name: "Allowed has-many task B", projectId: project.id()})

        const payload = await postFrontendModel("/api/frontend-models/projects/list", {
          preload: {tasks: true},
          where: {id: project.id()}
        })

        expect(payload.status).toEqual("success")
        expect(payload.models[0].__preloadedRelationships.tasks.map((taskModel) => taskModel.name)).toEqual([
          "Allowed has-many task A",
          "Allowed has-many task B"
        ])
      })
    })
  })

  it("authorizes preloaded singular relationships in bulk for index serialization", async () => {
    /** Ability resource allowing Task and selected Project rows. */
    class TaskProjectResource extends BaseResource {
      static ModelClass = Task

      /** @returns {void} */
      abilities() {
        this.can("read", Task)
        this.can("read", Project, {name: ["Allowed singular project A", "Allowed singular project B"]})
      }
    }

    await withDummyAbilityResolver(async ({configuration, params, request, response}) => {
      const requestPath = request.path().split("?")[0]

      if (requestPath !== "/api/frontend-models/tasks/list") return

      return new Ability({
        context: {configuration, params, request, response},
        resources: [TaskProjectResource]
      })
    }, async () => {
      await Dummy.run(async () => {
        const allowedProjectA = await Project.create({name: "Allowed singular project A"})
        const deniedProject = await Project.create({name: "Denied singular project"})
        const allowedProjectB = await Project.create({name: "Allowed singular project B"})

        await Task.create({name: "Singular task A", projectId: allowedProjectA.id()})
        await Task.create({name: "Singular task B", projectId: deniedProject.id()})
        await Task.create({name: "Singular task C", projectId: allowedProjectB.id()})

        const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
          preload: {project: true},
          sort: "name asc"
        })

        expect(payload.status).toEqual("success")
        expect(payload.models.map((model) => model.__preloadedRelationships.project?.name || null)).toEqual([
          "Allowed singular project A",
          null,
          "Allowed singular project B"
        ])
      })
    })
  })

  it("does not serialize nested preloaded models without frontend resource definitions", async () => {
    await Dummy.run(async () => {
      const task = await createTask("No frontend resource relationship task")
      const project = await Project.find(task.projectId())

      await ProjectDetail.create({
        isActive: true,
        note: "Secret backend only detail",
        projectId: project.id()
      })

      const payload = await postFrontendModel("/api/frontend-models/tasks/list", {
        preload: {project: ["projectDetail"]},
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models[0].__preloadedRelationships.project.__preloadedRelationships.projectDetail).toEqual(null)
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

      expect(payload).toEqual({status: "success"})
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
