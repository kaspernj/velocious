// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"
import Dummy from "../dummy/index.js"
import Comment from "../dummy/src/models/comment.js"
import backendProjects from "../dummy/src/config/backend-projects.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Project from "../dummy/src/models/project.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import Task from "../dummy/src/models/task.js"
import User from "../dummy/src/models/user.js"

const FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE = "Request failed."

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
 * @param {"destroy" | "find" | "index" | "update" | "attach" | "download" | "url"} commandType - Command.
 * @param {Record<string, any>} payload - Command payload.
 * @returns {Promise<Record<string, any>>} - Command response payload.
 */
async function postSharedTaskFrontendModelCommand(commandType, payload) {
  const response = await postFrontendModel("/frontend-models", {
    modelName: "Task",
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
 * @param {string} environment - Environment.
 * @returns {Configuration} - Test configuration.
 */
function buildFrontendModelControllerConfiguration(environment) {
  return new Configuration({
    backendProjects,
    cookieSecret: "dummy-cookie-secret",
    database: {[environment]: {}},
    directory: dummyDirectory(),
    environment,
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

/**
 * @param {object} args - Arguments.
 * @param {Configuration} args.configuration - Configuration.
 * @param {Record<string, any>} args.params - Controller params.
 * @returns {Promise<Record<string, any>>} - Parsed frontend API payload.
 */
async function runFrontendApi({configuration, params}) {
  const {payload} = await runFrontendApiWithResponse({configuration, params})

  return payload
}

/**
 * @param {object} args - Arguments.
 * @param {Configuration} args.configuration - Configuration.
 * @param {Record<string, any>} args.params - Controller params.
 * @returns {Promise<{payload: Record<string, any>, response: Response}>} - Parsed frontend API payload and raw response.
 */
async function runFrontendApiWithResponse({configuration, params}) {
  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  request.feed(Buffer.from([
    "POST /frontend-models HTTP/1.1",
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  await donePromise

  const response = new Response({configuration})
  const controller = new FrontendModelController({
    action: "frontendApi",
    configuration,
    controller: "frontend-models",
    params,
    request,
    response,
    viewPath: `${dummyDirectory()}/src/routes/frontend-models`
  })

  await controller.frontendApi()
  const body = response.getBody()
  const responseText = typeof body === "string"
    ? body
    : Buffer.from(body).toString("utf8")
  const responseJson = responseText.length > 0 ? JSON.parse(responseText) : {}

  return {
    payload: /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(responseJson)),
    response
  }
}

/**
 * @param {Record<string, any>} payload - Error payload.
 * @param {RegExp} messagePattern - Expected debug message.
 * @returns {void}
 */
function expectDebugFrontendModelError(payload, messagePattern) {
  expect(payload.status).toEqual("error")
  expect(payload.errorMessage).toEqual(FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE)
  expect(payload.debugErrorClass).toEqual("Error")
  expect(payload.debugErrorMessage).toMatch(messagePattern)
  expect(Array.isArray(payload.debugBacktrace)).toEqual(true)
  expect(payload.debugBacktrace[0]).toMatch(messagePattern)
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
 * @param {() => Promise<void>} callback - Callback.
 * @returns {Promise<void>}
 */
async function withTaskReadDistinctAbilityScope(callback) {
  const previousDistinctScope = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_READ_DISTINCT_SCOPE

  try {
    process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_READ_DISTINCT_SCOPE = "1"
    await callback()
  } finally {
    if (previousDistinctScope === undefined) {
      delete process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_READ_DISTINCT_SCOPE
    } else {
      process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_READ_DISTINCT_SCOPE = previousDistinctScope
    }
  }
}

/**
 * @param {"create" | "destroy" | "find" | "index" | "update"} commandType - Command.
 * @param {Record<string, any>} payload - Command payload.
 * @returns {Promise<Record<string, any>>} - Command response payload.
 */
async function postSharedProjectFrontendModelCommand(commandType, payload) {
  const response = await postFrontendModel("/frontend-models", {
    modelName: "Project",
    requests: [{
      commandType,
      model: "Project",
      payload,
      requestId: "request-1"
    }]
  })

  return /** @type {Record<string, any>} */ (response.responses?.[0]?.response || response)
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
    await withTaskReadDistinctAbilityScope(async () => {
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

      const payload = await postSharedTaskFrontendModelCommand("index", {
        sort: "name asc"
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Index Alpha", "Index Beta"])
      expect(payload.models[0].identifier).toMatch(/^task-/)
    })
  })

  it("serializes declared column-backed attributes through model methods", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Boolean normalization task")
      await task.update({isDone: true})

      const payload = await postSharedTaskFrontendModelCommand("index", {
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].isDone).toEqual(true)
    })
  })

  it("handles shared frontend-model API batch requests by model name", async () => {
    await Dummy.run(async () => {
      await createTask("Batch Alpha")
      await createTask("Batch Beta")

      const payload = await postFrontendModel("/frontend-models", {
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

  it("returns client-safe errors from shared frontend-model API when command execution fails", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/frontend-models", {
        requests: [
          {
            commandType: "index",
            model: "Task",
            payload: {distinct: "1 OR 1=1"},
            requestId: "request-1"
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.responses.length).toEqual(1)
      expect(payload.responses[0].response.status).toEqual("error")
      expect(payload.responses[0].response.errorMessage).toMatch(/Invalid distinct/)
    })
  })

  it("returns generic client-safe errors from shared frontend-model API for unexpected failures", async () => {
    await Dummy.run(async () => {
      const payload = await postFrontendModel("/frontend-models", {
        requests: [
          {
            commandType: "index",
            model: "UnknownModel",
            payload: {},
            requestId: "request-1"
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.responses.length).toEqual(1)
      expectDebugFrontendModelError(payload.responses[0].response, /No frontend model resource configuration/)
    })
  })

  it("forwards Set-Cookie headers from shared custom frontend-model commands", async () => {
    const configuration = buildFrontendModelControllerConfiguration("test")

    await configuration.initializeModels()

    const {response} = await runFrontendApiWithResponse({
      configuration,
      params: {
        requests: [{
          commandType: "set-session-cookie",
          customPath: "/users/set-session-cookie",
          model: "User",
          payload: {},
          requestId: "request-1"
        }]
      }
    })

    expect(response.headers["Set-Cookie"]).toEqual([
      "frontend_model_session=frontend-model-shared-cookie; Path=/; HttpOnly; SameSite=Lax"
    ])
  })

  it("keeps unexpected shared frontend-model failures generic in production", async () => {
    const configuration = buildFrontendModelControllerConfiguration("production")
    const payload = await runFrontendApi({
      configuration,
      params: {
        requests: [{
          commandType: "index",
          model: "UnknownModel",
          payload: {},
          requestId: "request-1"
        }]
      }
    })

    expect(payload.status).toEqual("success")
    expect(payload.responses.length).toEqual(1)
    expect(payload.responses[0].response.status).toEqual("error")
    expect(payload.responses[0].response.errorMessage).toEqual(FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE)
    expect(payload.responses[0].response.debugErrorClass).toEqual(undefined)
    expect(payload.responses[0].response.debugErrorMessage).toEqual(undefined)
    expect(payload.responses[0].response.debugBacktrace).toEqual(undefined)
  })

  it("applies preload params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Preload Task")

      const payload = await postSharedTaskFrontendModelCommand("index", {
        preload: {project: true},
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].__preloadedRelationships?.project).toBeDefined()
      expect(payload.models[0].__preloadedRelationships.project?.id).toEqual(task.readAttribute("projectId"))
    })
  })

  it("merges nested preload entries from array shorthand", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Merged preload task")

      const payload = await postSharedTaskFrontendModelCommand("index", {
        preload: [
          {project: ["tasks"]},
          {project: ["projectDetail"]}
        ],
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].__preloadedRelationships?.project).toBeDefined()
    })
  })

  it("applies limit, offset, perPage, and page params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      await createTask("Page Alpha")
      await createTask("Page Bravo")

      const limitOffsetPayload = await postSharedTaskFrontendModelCommand("index", {
        limit: 1,
        offset: 1,
        sort: "name asc"
      })
      const pagePayload = await postSharedTaskFrontendModelCommand("index", {
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

      const withoutDistinctPayload = await postSharedTaskFrontendModelCommand("index", {
        searches: [{column: "id", operator: "gteq", path: ["comments"], value: 1}]
      })
      const withDistinctPayload = await postSharedTaskFrontendModelCommand("index", {
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
      const payload = await postSharedTaskFrontendModelCommand("index", {
        distinct: "1 OR 1=1"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid distinct/)
    })
  })

  it("rejects non-numeric pagination params on frontendIndex", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedTaskFrontendModelCommand("index", {
        limit: "1; DROP TABLE accounts"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid limit/)
    })
  })

  it("filters serialized frontendIndex attributes by select map", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Select Task")

      const payload = await postSharedTaskFrontendModelCommand("index", {
        select: {Task: ["id"]},
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.id)).toEqual([task.id()])
    })
  })

  it("treats select array shorthand as root-model attributes", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Select Array Task")
      const baselinePayload = await postSharedTaskFrontendModelCommand("index", {
        where: {id: task.id()}
      })

      const payload = await postSharedTaskFrontendModelCommand("index", {
        joins: {project: true},
        select: ["id", "createdAt"],
        where: {id: task.id()}
      })

      expect(baselinePayload.status).toEqual("success")
      expect(baselinePayload.models.length).toEqual(1)
      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.id)).toEqual([task.id()])
      const baselineCreatedAt = baselinePayload.models[0].createdAt instanceof Date
        ? baselinePayload.models[0].createdAt.toISOString()
        : baselinePayload.models[0].createdAt
      const selectedCreatedAt = payload.models[0].createdAt instanceof Date
        ? payload.models[0].createdAt.toISOString()
        : payload.models[0].createdAt

      expect(selectedCreatedAt).toEqual(baselineCreatedAt)
      expect(payload.models[0].name).toEqual(undefined)
    })
  })

  it("applies search params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      await createTask("Search Alpha")
      await createTask("Search Beta")

      const payload = await postSharedTaskFrontendModelCommand("index", {
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

  it("accepts symbolic search operators on frontendIndex", async () => {
    await Dummy.run(async () => {
      const taskA = await createTask("Symbolic Search A")
      const taskB = await createTask("Symbolic Search B")

      const payload = await postSharedTaskFrontendModelCommand("index", {
        searches: [
          {
            column: "id",
            operator: ">",
            path: [],
            value: taskA.id()
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.id)).toEqual([taskB.id()])
    })
  })

  it("applies relationship-path search params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const taskA = await createTaskWithProject({projectName: "Search Project A", taskName: "Task A"})
      const taskB = await createTaskWithProject({projectName: "Search Project B", taskName: "Task B"})

      const payload = await postSharedTaskFrontendModelCommand("index", {
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

  it("applies like search params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      await createTask("Ransack Alpha")
      await createTask("Ransack Beta")

      const payload = await postSharedTaskFrontendModelCommand("index", {
        searches: [
          {
            column: "name",
            operator: "like",
            path: [],
            value: "%Beta%"
          }
        ]
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Ransack Beta"])
    })
  })

  it("applies joins params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Join filter task")

      await Comment.create({body: "Join comment A", taskId: task.id()})
      await Comment.create({body: "Join comment B", taskId: task.id()})

      const payloadWithoutJoins = await postSharedTaskFrontendModelCommand("index", {
        where: {id: task.id()}
      })
      const payloadWithJoins = await postSharedTaskFrontendModelCommand("index", {
        joins: {comments: true},
        where: {id: task.id()}
      })

      const withoutJoinsCount = payloadWithoutJoins.models.filter((model) => model.id === task.id()).length
      const withJoinsCount = payloadWithJoins.models.filter((model) => model.id === task.id()).length

      expect(payloadWithoutJoins.status).toEqual("success")
      expect(payloadWithJoins.status).toEqual("success")
      expect(withoutJoinsCount).toEqual(1)
      expect(withJoinsCount).toEqual(2)
    })
  })

  it("supports nested joins params without duplicating parent joins", async () => {
    await Dummy.run(async () => {
      await User.create({
        email: "nested-join-owner@example.com",
        encryptedPassword: "secret",
        reference: "nested-join-owner"
      })
      const task = await createTaskWithProject({
        creatingUserReference: "nested-join-owner",
        projectName: "Nested join project",
        taskName: "Nested join task"
      })

      const payload = await postSharedTaskFrontendModelCommand("index", {
        joins: {
          project: {
            creatingUser: true
          }
        },
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.id)).toEqual([task.id()])
    })
  })

  it("rejects raw string joins params", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedTaskFrontendModelCommand("index", {
        joins: "LEFT JOIN comments ON comments.task_id = tasks.id"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid joins type/)
    })
  })

  it("rejects unsafe string group params", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedTaskFrontendModelCommand("index", {
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

      const payload = await postSharedTaskFrontendModelCommand("index", {
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

      const payload = await postSharedTaskFrontendModelCommand("index", {
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

      const payload = await postSharedTaskFrontendModelCommand("index", {
        pluck: {project: ["id"]},
        searches: [
          {
            column: "id",
            operator: "gteq",
            path: ["project"],
            value: 1
          }
        ],
        sort: {project: ["id", "asc"]},
        where: {id: [firstTask.id(), secondTask.id()]}
      })

      expect(payload.status).toEqual("success")
      expect(payload.values.length).toEqual(2)
    })
  })

  it("rejects unsafe string pluck params", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedTaskFrontendModelCommand("index", {
        pluck: "id; DROP TABLE accounts"
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Invalid pluck column/)
    })
  })

  it("returns one model from frontendFind", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Find task")
      const payload = await postSharedTaskFrontendModelCommand("find", {id: task.id()})

      expect(payload.status).toEqual("success")
      expect(payload.model.id).toEqual(task.id())
      expect(payload.model.name).toEqual("Find task")
    })
  })

  it("applies preload params to frontendFind query", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Find preload task")

      const payload = await postSharedTaskFrontendModelCommand("find", {
        id: task.id(),
        preload: {project: true}
      })

      expect(payload.status).toEqual("success")
      expect(payload.model.__preloadedRelationships?.project).toBeDefined()
      expect(payload.model.__preloadedRelationships.project?.id).toEqual(task.readAttribute("projectId"))
    })
  })

  it("returns error payload when frontendFind record is missing", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedTaskFrontendModelCommand("find", {id: 404})

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toEqual("Task not found.")
    })
  })

  it("returns no models from frontendIndex when read ability scope denies access", async () => {
    await withDeniedTaskAbilityAction("read", async () => {
      await Dummy.run(async () => {
        await createTask("Denied index")

        const payload = await postSharedTaskFrontendModelCommand("index", {})

        expect(payload.status).toEqual("success")
        expect(payload.models).toEqual([])
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

      const payload = await postSharedTaskFrontendModelCommand("update", {
        attributes: {name: "Updated task"},
        id: task.id()
      })
      const persisted = await Task.find(task.id())

      expect(payload.status).toEqual("success")
      expect(payload.model.name).toEqual("Updated task")
      expect(persisted.name()).toEqual("Updated task")
    })
  })

  it("rejects computed read-only attributes on frontendUpdate", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Update computed attr")

      const payload = await postSharedTaskFrontendModelCommand("update", {
        attributes: {
          identifier: "task-overridden",
          name: "Updated task"
        },
        id: task.id()
      })
      const persisted = await Task.find(task.id())

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toEqual(FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE)
      expect(persisted.name()).toEqual("Update computed attr")
      expect(persisted.identifier()).toEqual(`task-${task.id()}`)
    })
  })

  it("updates models from frontendUpdate with has-one attachment payload", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Update attachment")

      const payload = await postSharedTaskFrontendModelCommand("update", {
        attributes: {
          descriptionFile: {
            contentBase64: Buffer.from("attachment-content").toString("base64"),
            filename: "my-doc.doc"
          }
        },
        id: task.id()
      })

      const downloadedAttachment = await task.descriptionFile().download()

      expect(payload.status).toEqual("success")
      expect(downloadedAttachment.filename()).toEqual("my-doc.doc")
      expect(downloadedAttachment.content().toString()).toEqual("attachment-content")
    })
  })

  it("attaches and downloads files through frontend-model attachment endpoints", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Attach endpoint")
      const attachPayload = await postSharedTaskFrontendModelCommand("attach", {
        attachment: {
          contentBase64: Buffer.from("endpoint-content").toString("base64"),
          filename: "endpoint.doc"
        },
        attachmentName: "descriptionFile",
        id: task.id()
      })
      const downloadPayload = await postSharedTaskFrontendModelCommand("download", {
        attachmentName: "descriptionFile",
        id: task.id()
      })

      expect(attachPayload.status).toEqual("success")
      expect(attachPayload.model.id).toEqual(task.id())
      expect(downloadPayload.status).toEqual("success")
      expect(downloadPayload.attachment.filename).toEqual("endpoint.doc")
      expect(Buffer.from(downloadPayload.attachment.contentBase64, "base64").toString()).toEqual("endpoint-content")
      expect(typeof downloadPayload.attachment.url).toEqual("string")
      expect(downloadPayload.attachment.url.startsWith("file://")).toEqual(true)
    })
  })

  it("returns attachment URL through frontend-model URL endpoint", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Attachment URL endpoint")

      await postSharedTaskFrontendModelCommand("attach", {
        attachment: {
          contentBase64: Buffer.from("url-endpoint-content").toString("base64"),
          filename: "url-endpoint.doc"
        },
        attachmentName: "descriptionFile",
        id: task.id()
      })

      const urlPayload = await postSharedTaskFrontendModelCommand("url", {
        attachmentName: "descriptionFile",
        id: task.id()
      })

      expect(urlPayload.status).toEqual("success")
      expect(typeof urlPayload.url).toEqual("string")
      expect(urlPayload.url.startsWith("file://")).toEqual(true)
    })
  })

  it("rejects path attachment input from frontend endpoints by default", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Path input blocked")

      const payload = await postSharedTaskFrontendModelCommand("attach", {
        attachment: {
          filename: "file.txt",
          path: "/etc/passwd"
        },
        attachmentName: "descriptionFile",
        id: task.id()
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toEqual(FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE)
    })
  })

  it("destroys models from frontendDestroy", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Destroy me")

      const payload = await postSharedTaskFrontendModelCommand("destroy", {id: task.id()})
      const persisted = await Task.findBy({id: task.id()})

      expect(payload.status).toEqual("success")
      expect(persisted).toEqual(null)
    })
  })

  it("returns error when frontendFind id is missing", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedTaskFrontendModelCommand("find", {})

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toEqual("Expected model id.")
    })
  })

  it("applies relationship-path where params to frontendIndex query", async () => {
    await Dummy.run(async () => {
      await User.create({
        email: "where-owner-a@example.com",
        encryptedPassword: "secret",
        reference: "where-owner-a"
      })
      await User.create({
        email: "where-owner-b@example.com",
        encryptedPassword: "secret",
        reference: "where-owner-b"
      })
      await createTaskWithProject({
        creatingUserReference: "where-owner-a",
        projectName: "Where Owner Project A",
        taskName: "Where Owner Task A"
      })
      await createTaskWithProject({
        creatingUserReference: "where-owner-b",
        projectName: "Where Owner Project B",
        taskName: "Where Owner Task B"
      })

      const payload = await postSharedTaskFrontendModelCommand("index", {
        where: {
          project: {
            creatingUser: {
              reference: "where-owner-b"
            }
          }
        }
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name)).toEqual(["Where Owner Task B"])
    })
  })

  it("treats plain-object values on root where columns as values", async () => {
    await Dummy.run(async () => {
      await createTask("Object where value")

      const payload = await postSharedTaskFrontendModelCommand("index", {
        where: {id: {raw: 1}}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models).toEqual([])
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

      const payload = await postSharedTaskFrontendModelCommand("index", {
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

  it("creates a model with translatedAttributes through the shared frontend-model API", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedProjectFrontendModelCommand("create", {
        attributes: {name: "Translated create project"}
      })

      expect(payload.status).toEqual("success")
      expect(payload.model.id).toBeDefined()

      const persisted = await Project.preload({translations: {}}).findBy({id: payload.model.id})

      expect(persisted).toBeDefined()
      expect(persisted.name()).toEqual("Translated create project")
    })
  })

  it("updates a model with translatedAttributes through the shared frontend-model API", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Original project name"})

      const payload = await postSharedProjectFrontendModelCommand("update", {
        attributes: {name: "Updated project name"},
        id: project.id()
      })

      expect(payload.status).toEqual("success")

      const persisted = await Project.preload({translations: {}}).findBy({id: project.id()})

      expect(persisted).toBeDefined()
      expect(persisted.name()).toEqual("Updated project name")
    })
  })

  it("auto-preloads translations when selecting a translated attribute", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Select test project"})

      const payload = await postSharedProjectFrontendModelCommand("index", {
        select: {Project: ["id", "name"]},
        where: {id: project.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].name).toEqual("Select test project")
    })
  })

  it("excludes name from default serialization when selectedByDefault is false", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Hidden name project"})

      const payload = await postSharedProjectFrontendModelCommand("index", {
        where: {id: project.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.length).toEqual(1)
      expect(payload.models[0].id).toEqual(project.id())
      expect(payload.models[0].name).toEqual(undefined)
    })
  })
})
