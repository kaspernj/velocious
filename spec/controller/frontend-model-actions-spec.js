// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Comment from "../dummy/src/models/comment.js"
import backendProjects from "../dummy/src/config/backend-projects.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Interaction from "../dummy/src/models/interaction.js"
import Project from "../dummy/src/models/project.js"
import Record from "../../src/database/record/index.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import Task from "../dummy/src/models/task.js"
import User from "../dummy/src/models/user.js"
import VelociousError from "../../src/velocious-error.js"

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
 * @returns {number} - Active shared frontend-model controller action checkouts.
 */
function activeFrontendModelControllerActionConnectionCount() {
  const snapshot = dummyConfiguration.getDatabasePool("default").getDebugSnapshot()

  return snapshot.connections.filter((connection) => {
    return connection.state === "in-use" && connection.checkoutName === "FrontendModelController.frontendApi"
  }).length
}

/**
 * @param {"create" | "destroy" | "find" | "index" | "update" | "attach" | "attachmentList" | "download" | "url"} commandType - Command.
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
 * @param {{exposeInternalErrorsToClients?: boolean, resolveFrontendModelAbility?: boolean}} [options] - Configuration options.
 * @returns {Configuration} - Test configuration.
 */
function buildFrontendModelControllerConfiguration(environment, options = {}) {
  return new Configuration({
    abilityResolver: options.resolveFrontendModelAbility ? dummyConfiguration.getAbilityResolver() : undefined,
    backendProjects,
    cookieSecret: "dummy-cookie-secret",
    database: {[environment]: {}},
    directory: dummyDirectory(),
    environment,
    environmentHandler: new EnvironmentHandlerNode(),
    exposeInternalErrorsToClients: options.exposeInternalErrorsToClients === true,
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
 * @param {Record<string, any>} [args.requestPayload] - Optional JSON request body payload.
 * @returns {Promise<Record<string, any>>} - Parsed frontend API payload.
 */
async function runFrontendApi({configuration, params, requestPayload}) {
  const {payload} = await runFrontendApiWithResponse({configuration, params, requestPayload})

  return payload
}

/**
 * @param {object} args - Arguments.
 * @param {Configuration} args.configuration - Configuration.
 * @param {Record<string, any>} args.params - Controller params.
 * @param {Record<string, any>} [args.requestPayload] - Optional JSON request body payload.
 * @returns {Promise<{payload: Record<string, any>, response: Response}>} - Parsed frontend API payload and raw response.
 */
async function runFrontendApiWithResponse({configuration, params, requestPayload}) {
  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const requestBody = requestPayload ? JSON.stringify(serializeFrontendModelTransportValue(requestPayload)) : ""
  const requestHeaders = [
    "POST /frontend-models HTTP/1.1",
    "Host: example.com",
    `Content-Length: ${Buffer.byteLength(requestBody)}`
  ]

  if (requestBody.length > 0) {
    requestHeaders.push("Content-Type: application/json")
  }

  request.feed(Buffer.from([
    ...requestHeaders,
    "",
    requestBody
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
 * @param {Record<string, any>} payload - Error payload.
 * @returns {void}
 */
function expectGenericFrontendModelError(payload) {
  expect(payload.status).toEqual("error")
  expect(payload.errorMessage).toEqual(FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE)
  expect(payload.debugErrorClass).toEqual(undefined)
  expect(payload.debugErrorMessage).toEqual(undefined)
  expect(payload.debugBacktrace).toEqual(undefined)
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

/** Task resource that customizes the base index query without replacing records/count. */
class ScopedTaskFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Task

    static attributes = ["id", "name"]

  static builtInCollectionCommands = ["index"]

  /**
   * @param {{includePagination?: boolean, includeSort?: boolean}} [options] - Index-query options.
   * @returns {import("../../src/database/query/model-class-query.js").default<typeof Task>} - Scoped index query.
   */
  indexQuery(options = {}) {
    return /** @type {import("../../src/database/query/model-class-query.js").default<typeof Task>} */ (super.indexQuery(options).where({name: ["Scoped Alpha", "Scoped Bravo"]}))
  }

  /** @returns {{includePagination: false, includeSort: false}} - Index-query options for count. */
  countIndexQueryOptions() {
    return {
      includePagination: false,
      includeSort: false
    }
  }
}

/** Task resource exposing description only when explicitly requested. */
class DescriptionPluckTaskFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Task

    static attributes = ["id", {name: "description", selectedByDefault: false}]

  static builtInCollectionCommands = ["index"]
}

/** Task resource using the legacy all-model-columns serialization default. */
class AllColumnsPluckTaskFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Task

    static attributes = []

  static builtInCollectionCommands = ["index"]
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

  it("checks shared frontend-model API controller action connections back in", async () => {
    await Dummy.run(async () => {
      await createTask("Connection checkout release")

      const successPayload = await postFrontendModel("/frontend-models", {
        requests: [
          {
            commandType: "index",
            model: "Task",
            payload: {where: {name: "Connection checkout release"}},
            requestId: "request-1"
          }
        ]
      })

      expect(successPayload.responses[0].response.status).toEqual("success")
      expect(activeFrontendModelControllerActionConnectionCount()).toEqual(0)

      const errorPayload = await postFrontendModel("/frontend-models", {
        requests: [
          {
            commandType: "index",
            model: "Task",
            payload: {distinct: "1 OR 1=1"},
            requestId: "request-1"
          }
        ]
      })

      expect(errorPayload.responses[0].response.status).toEqual("error")
      expect(activeFrontendModelControllerActionConnectionCount()).toEqual(0)
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

  it("only initializes the requested frontend-model class", async () => {
    class RequestedLazyFrontendModel extends Record {
      /** @returns {Promise<void>} */
      static async initializeRecord() {
        this._initialized = true
      }
    }

    class UnrequestedLazyFrontendModel extends Record {
      /** @returns {Promise<void>} */
      static async initializeRecord() {
        throw new Error("Unrequested lazy frontend model should not initialize")
      }
    }

    class RequestedLazyFrontendResource extends FrontendModelBaseResource {
      static ModelClass = RequestedLazyFrontendModel

      static attributes = ["id"]

      static builtInCollectionCommands = ["index"]
    }

    class UnrequestedLazyFrontendResource extends FrontendModelBaseResource {
      static ModelClass = UnrequestedLazyFrontendModel

      static attributes = ["id"]

      static builtInCollectionCommands = ["index"]
    }

    const configuration = new Configuration({
      backendProjects: [{
        frontendModels: {
          RequestedLazyFrontendModel: RequestedLazyFrontendResource,
          UnrequestedLazyFrontendModel: UnrequestedLazyFrontendResource
        },
        path: dummyDirectory()
      }],
      cookieSecret: "dummy-cookie-secret",
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const client = {remoteAddress: "127.0.0.1"}
    const request = new Request({client, configuration})
    const response = new Response({configuration})
    const controller = new FrontendModelController({
      action: "frontendApi",
      configuration,
      controller: "frontend-models",
      params: {model: "RequestedLazyFrontendModel"},
      request,
      response,
      viewPath: `${dummyDirectory()}/src/routes/frontend-models`
    })

    await controller.withFrontendModelParams({model: "RequestedLazyFrontendModel"}, async () => {
      await controller.ensureFrontendModelClassInitialized()
    })

    expect(RequestedLazyFrontendModel.isInitialized()).toEqual(true)
    expect(UnrequestedLazyFrontendModel.isInitialized()).toEqual(false)
  })

  /**
   * @returns {{requests: Array<{commandType: string, model: string, payload: Record<string, any>, requestId: string}>}} - Params for an invalid shared frontend-model request.
   */
  function unknownSharedFrontendModelRequestParams() {
    return {
      requests: [{
        commandType: "index",
        model: "UnknownModel",
        payload: {},
        requestId: "request-1"
      }]
    }
  }

  /**
   * @param {Record<string, any>} payload - Shared frontend-model API payload.
   * @returns {Record<string, any>} - The first response payload.
   */
  function expectSingleSharedFrontendModelResponse(payload) {
    expect(payload.status).toEqual("success")
    expect(payload.responses.length).toEqual(1)

    return payload.responses[0].response
  }

  it("keeps unexpected shared frontend-model failures generic in production", async () => {
    const configuration = buildFrontendModelControllerConfiguration("production")
    const payload = await runFrontendApi({
      configuration,
      params: unknownSharedFrontendModelRequestParams()
    })

    expectGenericFrontendModelError(expectSingleSharedFrontendModelResponse(payload))
  })

  it("keeps unexpected shared frontend-model failures generic in staging by default", async () => {
    const configuration = buildFrontendModelControllerConfiguration("staging")
    const payload = await runFrontendApi({
      configuration,
      params: unknownSharedFrontendModelRequestParams()
    })

    expectGenericFrontendModelError(expectSingleSharedFrontendModelResponse(payload))
  })

  it("returns debug details for unexpected shared frontend-model failures when staging opts in", async () => {
    const configuration = buildFrontendModelControllerConfiguration("staging", {exposeInternalErrorsToClients: true})
    const payload = await runFrontendApi({
      configuration,
      params: unknownSharedFrontendModelRequestParams()
    })

    expectDebugFrontendModelError(expectSingleSharedFrontendModelResponse(payload), /No frontend model resource configuration/)
  })

  it("adds registered client error reporter payloads to shared frontend-model failures", async () => {
    const configuration = buildFrontendModelControllerConfiguration("production")
    /** @type {import("../../src/configuration-types.js").ClientErrorPayloadContext[]} */
    const reporterContexts = []
    /** @type {Array<import("../../src/configuration-types.js").ErrorRequestDetails | null>} */
    const reporterRequestDetails = []
    const requestPayload = unknownSharedFrontendModelRequestParams()

    requestPayload.requests[0].payload = {
      authorization: "Bearer private-token",
      comments: ["x".repeat(1200)],
      payload: {contentBase64: "raw-base64"}
    }

    configuration.addClientErrorPayloadReporter(async ({context, error, requestDetails}) => {
      reporterContexts.push(context)
      reporterRequestDetails.push(requestDetails)
      expect(error.message).toMatch(/No frontend model resource configuration/)

      return {bugReportUrl: "https://tensorbuzz.test/bugs/1"}
    })

    const payload = await runFrontendApi({
      configuration,
      params: requestPayload,
      requestPayload
    })

    const response = expectSingleSharedFrontendModelResponse(payload)

    expectGenericFrontendModelError(response)
    expect(response.bugReportUrl).toEqual("https://tensorbuzz.test/bugs/1")
    expect(reporterContexts.length).toEqual(1)
    expect(reporterContexts[0].action).toEqual("frontendApi")
    expect(reporterContexts[0].commandType).toEqual("index")
    expect(reporterContexts[0].expectedError).toEqual(false)
    expect(reporterContexts[0].frontendModelEndpoint).toEqual(true)
    expect(reporterContexts[0].model).toEqual("UnknownModel")
    expect(reporterContexts[0].requestId).toEqual("request-1")
    expect(reporterRequestDetails[0]?.httpMethod).toEqual("POST")
    expect(reporterRequestDetails[0]?.path).toEqual("/frontend-models")
    expect(reporterRequestDetails[0]?.body?.requests?.[0]?.payload?.authorization).toEqual("[redacted]")
    expect(reporterRequestDetails[0]?.body?.requests?.[0]?.payload?.comments?.[0]).toContain("[truncated ")
    expect(reporterRequestDetails[0]?.body?.requests?.[0]?.payload?.payload?.contentBase64).toEqual("[redacted]")
  })

  it("compacts oversized shared frontend-model request details for client error reporters", async () => {
    const configuration = buildFrontendModelControllerConfiguration("production")
    /** @type {Array<import("../../src/configuration-types.js").ErrorRequestDetails | null>} */
    const reporterRequestDetails = []
    const requestPayload = unknownSharedFrontendModelRequestParams()

    requestPayload.requests[0].payload = {
      attributes: {
        description: "x".repeat(15000),
        title: "Investigate request body"
      }
    }

    configuration.addClientErrorPayloadReporter(async ({requestDetails}) => {
      reporterRequestDetails.push(requestDetails)

      return {bugReportUrl: "https://tensorbuzz.test/bugs/1"}
    })

    const payload = await runFrontendApi({
      configuration,
      params: requestPayload,
      requestPayload
    })

    expectGenericFrontendModelError(expectSingleSharedFrontendModelResponse(payload))
    expect(reporterRequestDetails[0]?.body?.__truncated).toEqual(true)
    expect(reporterRequestDetails[0]?.body?.originalSerializedLength).toBeGreaterThan(12000)
    expect(reporterRequestDetails[0]?.body?.requests).toEqual([{
      commandType: "index",
      model: "UnknownModel",
      payload: {
        attributes: {
          __keys: ["description", "title"]
        }
      },
      requestId: "request-1"
    }])
  })

  it("renders and emits direct frontend-model errors when params parsing fails", async () => {
    const configuration = buildFrontendModelControllerConfiguration("production")
    const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration})
    const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
    /** @type {Array<{context: {frontendModelEndpoint?: boolean}, error: Error}>} */
    const frameworkErrors = []

    configuration.getErrorEvents().on("framework-error", (payload) => {
      frameworkErrors.push(/** @type {{context: {frontendModelEndpoint?: boolean}, error: Error}} */ (payload))
    })
    request.feed(Buffer.from([
      "GET /frontend-models?broken[x=1 HTTP/1.1",
      "Host: example.com",
      "",
      ""
    ].join("\r\n"), "utf8"))

    await donePromise

    const response = new Response({configuration})
    const controller = new FrontendModelController({
      action: "frontendIndex",
      configuration,
      controller: "frontend-models",
      params: {model: "Task"},
      request,
      response,
      viewPath: `${dummyDirectory()}/src/routes/frontend-models`
    })

    await controller.frontendIndex()

    const body = response.getBody()
    const responseText = typeof body === "string" ? body : Buffer.from(body).toString("utf8")
    const responseJson = responseText.length > 0 ? JSON.parse(responseText) : {}
    const payload = /** @type {Record<string, import("../../src/frontend-models/query.js").FrontendModelTransportValue>} */ (deserializeFrontendModelTransportValue(responseJson))

    expectGenericFrontendModelError(payload)
    expect(frameworkErrors.length).toEqual(1)
    expect(frameworkErrors[0].context.frontendModelEndpoint).toEqual(true)
    expect(frameworkErrors[0].error.message).toMatch(/Could not parse nested params key/)
  })

  it("adds safe VelociousError codes to frontend-model client payload metadata", async () => {
    const configuration = buildFrontendModelControllerConfiguration("production")
    const controller = new FrontendModelController({
      action: "frontendApi",
      configuration,
      controller: "frontend-models",
      params: {},
      request: new Request({client: {remoteAddress: "127.0.0.1"}, configuration}),
      response: new Response({configuration}),
      viewPath: `${dummyDirectory()}/src/routes/frontend-models`
    })
    const payload = await controller.frontendModelClientErrorPayloadForError(VelociousError.safe("Ticket scan failed", {code: "ticket-scan-pah-too-long"}))

    expect(payload.status).toEqual("error")
    expect(payload.errorMessage).toEqual("Ticket scan failed")
    expect(payload.velocious).toEqual({code: "ticket-scan-pah-too-long"})
  })

  it("keeps unexpected shared frontend-model failures generic in production when debug details are enabled", async () => {
    const configuration = buildFrontendModelControllerConfiguration("production", {exposeInternalErrorsToClients: true})
    const payload = await runFrontendApi({
      configuration,
      params: unknownSharedFrontendModelRequestParams()
    })

    expectGenericFrontendModelError(expectSingleSharedFrontendModelResponse(payload))
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

  it("initializes relationship target classes before frontendIndex preload", async () => {
    await Dummy.run(async () => {
      const configuration = Configuration.current()
      const modelClasses = configuration.getModelClasses()
      const project = await Project.create({name: "Lazy relationship preload project"})
      const task = await Task.create({name: "Lazy relationship preload task", projectId: project.id()})
      const comment = await Comment.create({body: "Lazy relationship preload comment", taskId: task.id()})
      const previousTaskModelClass = modelClasses.Task
      const previousCommentModelClass = modelClasses.Comment

      delete modelClasses.Task
      delete modelClasses.Comment
      Task._initialized = false
      Task._initializeRecordPromise = null
      Comment._initialized = false
      Comment._initializeRecordPromise = null

      try {
        const response = await postFrontendModel("/frontend-models", {
          requests: [{
            commandType: "index",
            model: "Project",
            payload: {
              preload: {tasks: ["comments"]},
              where: {id: project.id()}
            },
            requestId: "request-1"
          }]
        })
        const payload = response.responses[0].response

        expect(payload.status).toEqual("success")
        expect(Task.isInitialized()).toEqual(true)
        expect(Comment.isInitialized()).toEqual(true)
        expect(payload.models.length).toEqual(1)
        expect(payload.models[0].__preloadedRelationships?.tasks.length).toEqual(1)
        expect(payload.models[0].__preloadedRelationships.tasks[0].id).toEqual(task.id())
        expect(payload.models[0].__preloadedRelationships.tasks[0].__preloadedRelationships.comments[0].id).toEqual(comment.id())
      } finally {
        modelClasses.Task = previousTaskModelClass
        modelClasses.Comment = previousCommentModelClass
        await Task.ensureInitialized({configuration})
        await Comment.ensureInitialized({configuration})
      }
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

  it("lets resources customize frontendIndex queries and count options", async () => {
    await Dummy.run(async () => {
      const previousTaskResource = backendProjects[0].frontendModels.Task

      backendProjects[0].frontendModels.Task = ScopedTaskFrontendResource

      try {
        await createTask("Other Charlie")
        await createTask("Scoped Alpha")
        await createTask("Scoped Bravo")

        const recordsPayload = await postSharedTaskFrontendModelCommand("index", {
          page: 1,
          perPage: 1,
          sort: "name asc"
        })
        const countPayload = await postSharedTaskFrontendModelCommand("index", {
          count: true,
          page: 1,
          perPage: 1,
          sort: "name desc"
        })
        const pluckPayload = await postSharedTaskFrontendModelCommand("index", {
          pluck: ["name"],
          sort: "name asc"
        })

        expect(recordsPayload.status).toEqual("success")
        expect(recordsPayload.models.map((model) => model.name)).toEqual(["Scoped Alpha"])
        expect(countPayload.status).toEqual("success")
        expect(countPayload.count).toEqual(2)
        expect(pluckPayload.status).toEqual("success")
        expect(pluckPayload.values).toEqual(["Scoped Alpha", "Scoped Bravo"])
      } finally {
        backendProjects[0].frontendModels.Task = previousTaskResource
      }
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

      expect(baselineCreatedAt).toEqual(undefined)
      expect(selectedCreatedAt).toEqual(task.createdAt()?.toISOString())
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

  it("allows Ransack filters only on resource-exposed attributes", async () => {
    await Dummy.run(async () => {
      await User.create({
        email: "visible-ransack@example.com",
        encryptedPassword: "visible-secret",
        reference: "visible-ransack"
      })
      await User.create({
        email: "other-ransack@example.com",
        encryptedPassword: "hidden-secret",
        reference: "other-ransack"
      })

      const allowedResponse = await postFrontendModel("/frontend-models", {
        requests: [{
          commandType: "index",
          model: "User",
          payload: {
            ransack: {email_eq: "visible-ransack@example.com"}
          },
          requestId: "users"
        }]
      })
      const hiddenResponse = await postFrontendModel("/frontend-models", {
        requests: [{
          commandType: "index",
          model: "User",
          payload: {
            ransack: {encryptedPassword_eq: "hidden-secret"}
          },
          requestId: "users"
        }]
      })

      const allowedPayload = allowedResponse.responses[0].response
      const hiddenPayload = hiddenResponse.responses[0].response

      expect(allowedPayload.status).toEqual("success")
      expect(allowedPayload.models.map((model) => model.email)).toEqual(["visible-ransack@example.com"])
      expect(hiddenPayload.status).toEqual("error")
      expect(hiddenPayload.errorMessage).toEqual('Unknown ransack attribute "encryptedPassword" for User')
      expect(hiddenPayload.velocious).toEqual({code: "frontend-model-query-error"})
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

  it("rejects pluck params for model columns not exposed by the resource", async () => {
    await Dummy.run(async () => {
      const task = await Task.create({
        description: "Hidden task description",
        name: "Hidden pluck task",
        projectId: (await Project.create({name: "Hidden pluck project"})).id()
      })

      const payload = await postSharedTaskFrontendModelCommand("index", {
        pluck: ["description"],
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Unknown pluck column/)
      expect(payload.values).toEqual(undefined)
    })
  })

  it("allows pluck params for exposed non-default resource attributes", async () => {
    await Dummy.run(async () => {
      const previousTaskResource = backendProjects[0].frontendModels.Task

      backendProjects[0].frontendModels.Task = DescriptionPluckTaskFrontendResource

      try {
        const task = await Task.create({
          description: "Exposed task description",
          name: "Exposed pluck task",
          projectId: (await Project.create({name: "Exposed pluck project"})).id()
        })

        const payload = await postSharedTaskFrontendModelCommand("index", {
          pluck: ["description"],
          where: {id: task.id()}
        })

        expect(payload.status).toEqual("success")
        expect(payload.values).toEqual(["Exposed task description"])
      } finally {
        backendProjects[0].frontendModels.Task = previousTaskResource
      }
    })
  })

  it("allows pluck params for model columns when the resource exposes all default model attributes", async () => {
    await Dummy.run(async () => {
      const previousTaskResource = backendProjects[0].frontendModels.Task

      backendProjects[0].frontendModels.Task = AllColumnsPluckTaskFrontendResource

      try {
        const task = await Task.create({
          description: "Default task description",
          name: "Default pluck task",
          projectId: (await Project.create({name: "Default pluck project"})).id()
        })

        const payload = await postSharedTaskFrontendModelCommand("index", {
          pluck: ["description"],
          where: {id: task.id()}
        })

        expect(payload.status).toEqual("success")
        expect(payload.values).toEqual(["Default task description"])
      } finally {
        backendProjects[0].frontendModels.Task = previousTaskResource
      }
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

  it("rejects relationship-path pluck params for columns not exposed by the related resource", async () => {
    await Dummy.run(async () => {
      const task = await createTaskWithProject({
        creatingUserReference: "hidden-owner-reference",
        projectName: "Hidden relation pluck project",
        taskName: "Hidden relation pluck task"
      })

      const payload = await postSharedTaskFrontendModelCommand("index", {
        pluck: {project: ["creatingUserReference"]},
        where: {id: task.id()}
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorMessage).toMatch(/Unknown pluck column/)
      expect(payload.values).toEqual(undefined)
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

  it("creates belongs-to nested attributes before saving the parent", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedTaskFrontendModelCommand("create", {
        attributes: {
          name: "Nested belongs-to task",
          projectAttributes: {name: "Nested belongs-to project"}
        }
      })

      expect(payload.status).toEqual("success")
      expect(payload.model.id).toBeDefined()

      const persisted = await Task.find(payload.model.id)
      const project = await persisted.projectOrLoad()

      expect(persisted.name()).toEqual("Nested belongs-to task")
      expect(project.name()).toEqual("Nested belongs-to project")
      expect(persisted.projectId()).toEqual(project.id())
    })
  })

  it("creates has-many nested attributes with child attachments and grandchildren", async () => {
    await Dummy.run(async () => {
      const payload = await postSharedProjectFrontendModelCommand("create", {
        attributes: {
          name: "Nested parent project",
          tasksAttributes: [
            {
              commentsAttributes: [{body: "Nested child comment"}],
              descriptionFile: {
                contentBase64: Buffer.from("nested-attachment-content").toString("base64"),
                filename: "nested-task.doc"
              },
              name: "Nested child task"
            }
          ]
        }
      })

      expect(payload.status).toEqual("success")
      expect(payload.model.id).toBeDefined()

      const task = await Task.findBy({name: "Nested child task", projectId: payload.model.id})
      expect(task).toBeDefined()
      if (!task) throw new Error("Expected nested child task to be persisted")

      const comment = await Comment.findBy({body: "Nested child comment", taskId: task.id()})
      const downloadedAttachment = await task.descriptionFile().download()

      expect(comment).toBeDefined()
      expect(downloadedAttachment.filename()).toEqual("nested-task.doc")
      expect(downloadedAttachment.content().toString()).toEqual("nested-attachment-content")
    })
  })

  it("creates and scopes polymorphic has-many nested attributes", async () => {
    await Dummy.run(async () => {
      const createPayload = await postSharedProjectFrontendModelCommand("create", {
        attributes: {
          interactionsAttributes: [{kind: "Nested project interaction"}],
          name: "Nested polymorphic project"
        }
      })

      expect(createPayload.status).toEqual("success")
      expect(createPayload.model.id).toBeDefined()

      const projectInteraction = await Interaction.findBy({
        kind: "Nested project interaction",
        subjectId: createPayload.model.id,
        subjectType: "Project"
      })

      expect(projectInteraction).toBeDefined()
      if (!projectInteraction) throw new Error("Expected nested polymorphic child to be persisted")

      const foreignInteraction = await Interaction.create({
        kind: "Foreign task interaction",
        subjectId: createPayload.model.id,
        subjectType: "Task"
      })
      const updatePayload = await postSharedProjectFrontendModelCommand("update", {
        attributes: {
          interactionsAttributes: [{id: foreignInteraction.id(), kind: "Incorrectly updated"}],
          name: "Nested polymorphic project"
        },
        id: createPayload.model.id
      })
      const reloadedForeignInteraction = await Interaction.find(foreignInteraction.id())

      expect(updatePayload.status).toEqual("error")
      expect(updatePayload.errorMessage).toEqual(FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE)
      expect(reloadedForeignInteraction.kind()).toEqual("Foreign task interaction")
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

  it("loads attachment metadata when the owner resource is in a later backend project", async () => {
    await Dummy.run(async () => {
      const configuration = Configuration.current()
      const configuredBackendProjects = configuration.getBackendProjects()
      const originalBackendProjects = configuredBackendProjects.slice()
      const task = await createTask("Cross project attachment owner")

      await task.descriptionFile().attach({
        content: "cross-project-content",
        filename: "cross-project.txt"
      })

      try {
        configuredBackendProjects.splice(
          0,
          configuredBackendProjects.length,
          {frontendModels: {}, path: "/tmp/empty-backend-project"},
          {
            frontendModels: {
              Task: backendProjects[0].frontendModels.Task
            },
            path: dummyDirectory()
          }
        )

        const payload = await postFrontendModel("/frontend-models", {
          requests: [{
            commandType: "index",
            model: "VelociousAttachment",
            payload: {
              where: {recordType: "Task", recordId: String(task.id()), name: "descriptionFile"}
            },
            requestId: "request-1"
          }]
        })
        const response = payload.responses[0].response

        expect(response.status).toEqual("success")
        expect(response.models.length).toEqual(1)
        expect(response.models[0].filename).toEqual("cross-project.txt")
      } finally {
        configuredBackendProjects.splice(0, configuredBackendProjects.length, ...originalBackendProjects)
      }
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

  it("lists has-many attachment metadata through the frontend-model attachmentList endpoint", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Attachment list endpoint")

      await postSharedTaskFrontendModelCommand("attach", {
        attachment: {contentBase64: Buffer.from("AA").toString("base64"), filename: "a.txt"},
        attachmentName: "files",
        id: task.id()
      })
      await postSharedTaskFrontendModelCommand("attach", {
        attachment: {contentBase64: Buffer.from("BBB").toString("base64"), filename: "b.txt"},
        attachmentName: "files",
        id: task.id()
      })

      const listPayload = await postSharedTaskFrontendModelCommand("attachmentList", {
        attachmentName: "files",
        id: task.id()
      })

      expect(listPayload.status).toEqual("success")
      expect(listPayload.attachments.map((entry) => entry.filename)).toEqual(["a.txt", "b.txt"])
      expect(listPayload.attachments.map((entry) => entry.byteSize)).toEqual([2, 3])
      expect(listPayload.attachments.every((entry) => typeof entry.id === "string" && entry.id.length > 0)).toEqual(true)
      expect("contentBase64" in listPayload.attachments[0]).toEqual(false)
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

  it("resolves raw DB column names in where conditions to attribute names", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Column Name Project"})

      await Task.create({name: "Column Name Task A", projectId: project.id()})
      await Task.create({name: "Column Name Task B", projectId: project.id()})

      // Use the raw DB column name "project_id" instead of the camelCase attribute "projectId".
      const payload = await postSharedTaskFrontendModelCommand("index", {
        where: {project_id: project.id()}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((model) => model.name).sort()).toEqual(["Column Name Task A", "Column Name Task B"])
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
      expect(payload.models[0].__preloadedRelationships).toEqual(undefined)
    })
  })

  it("orders translated attributes through current translation fallbacks", async () => {
    await Dummy.run(async () => {
      const fallbackProject = await Project.create({nameDe: "Zulu fallback"})
      const middleProject = await Project.create({nameDe: "Should not sort first", nameEn: "Beta current"})
      const lastProject = await Project.create({nameEn: "Alpha current"})

      const payload = await postSharedProjectFrontendModelCommand("index", {
        select: {Project: ["id", "name"]},
        sort: "name desc",
        where: {id: [fallbackProject.id(), middleProject.id(), lastProject.id()]}
      })

      expect(payload.status).toEqual("success")
      expect(payload.models.map((project) => project.id)).toEqual([fallbackProject.id(), middleProject.id(), lastProject.id()])
      expect(payload.models.map((project) => project.name)).toEqual(["Zulu fallback", "Beta current", "Alpha current"])
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

  it("returns structured validation errors for frontend-model update with invalid attributes", async () => {
    await Dummy.run(async () => {
      const task = await createTask("Valid task name")

      const payload = await postSharedTaskFrontendModelCommand("update", {
        attributes: {name: ""},
        id: task.id()
      })

      expect(payload.status).toEqual("error")
      expect(payload.errorType).toEqual("validation_error")
      expect(payload.errorMessage).toEqual("Name can't be blank")
      expect(payload.validationErrors).toBeDefined()
      expect(payload.validationErrors.name).toBeDefined()
      expect(payload.validationErrors.name.length).toEqual(1)
      expect(payload.validationErrors.name[0].type).toEqual("presence")
      expect(payload.validationErrors.name[0].message).toEqual("can't be blank")
      expect(payload.validationErrors.name[0].fullMessage).toEqual("Name can't be blank")
    })
  })

  it("masks non-validation internal errors as generic in production frontend-model responses", async () => {
    await Dummy.run(async () => {
      const configuration = buildFrontendModelControllerConfiguration("production")
      const params = {
        modelName: "Task",
        requests: [{
          commandType: "find",
          model: "Task",
          payload: {id: -1},
          requestId: "find-request"
        }]
      }

      const payload = await runFrontendApi({configuration, params})
      const response = /** @type {Record<string, any>} */ (payload.responses?.[0]?.response || payload)

      expect(response.status).toEqual("error")
      expect(response.errorMessage).toEqual(FRONTEND_MODEL_CLIENT_SAFE_ERROR_MESSAGE)
      expect(response.errorType).toBeUndefined()
      expect(response.validationErrors).toBeUndefined()
      expect(response.debugErrorClass).toBeUndefined()
    })
  })

  it("emits framework-error for unexpected frontend-model failures so they are not silently swallowed", async () => {
    await Dummy.run(async () => {
      const configuration = buildFrontendModelControllerConfiguration("production")
      /** @type {any[]} */
      const frameworkErrors = []
      const requestPayload = {
        modelName: "Task",
        requests: [{commandType: "find", model: "Task", payload: {id: -1}, requestId: "find-request"}]
      }

      configuration.getErrorEvents().on("framework-error", (/** @type {any} */ payload) => frameworkErrors.push(payload))

      const payload = await runFrontendApi({
        configuration,
        params: requestPayload,
        requestPayload
      })
      const response = /** @type {Record<string, any>} */ (payload.responses?.[0]?.response || payload)

      expect(response.status).toEqual("error")
      expect(frameworkErrors.length).toBeGreaterThan(0)
      expect(frameworkErrors[0].context.frontendModelEndpoint).toEqual(true)
      expect(frameworkErrors[0].error).toBeInstanceOf(Error)
      expect(frameworkErrors[0].requestDetails).toEqual({
        body: requestPayload,
        httpMethod: "POST",
        path: "/frontend-models"
      })
    })
  })

  it("does not emit framework errors for invalid client query attributes", async () => {
    await Dummy.run(async () => {
      for (const requestCase of [
        {
          expectedMessage: 'Unknown select attribute "missingAttribute" for Task',
          payload: {select: ["id", "missingAttribute"]},
          requestId: "invalid-select"
        },
        {
          expectedMessage: 'Unknown where column "missingAttribute" for Task',
          payload: {where: {missingAttribute: "value"}},
          requestId: "invalid-where"
        },
        {
          expectedMessage: 'Unknown search column "missingAttribute" for Task',
          payload: {searches: [{column: "missingAttribute", operator: "eq", path: [], value: "value"}]},
          requestId: "invalid-search"
        },
        {
          expectedMessage: 'Unknown join relationship "missingRelationship" for Task',
          payload: {joins: {missingRelationship: true}},
          requestId: "invalid-join"
        },
        {
          expectedMessage: 'Unknown preload relationship "missingRelationship" for Task',
          payload: {preload: {missingRelationship: true}},
          requestId: "invalid-preload"
        },
        {
          expectedMessage: 'Unknown preload relationship "select" for Task',
          model: "Project",
          payload: {preload: {tasks: {select: ["id"]}}},
          requestId: "invalid-nested-preload-select"
        },
        {
          expectedMessage: "Invalid preload value for project: number",
          payload: {preload: {project: 1}},
          requestId: "invalid-preload-value"
        },
        {
          expectedMessage: 'Unknown group column "missingAttribute" for Task',
          payload: {group: "missingAttribute"},
          requestId: "invalid-group"
        },
        {
          expectedMessage: 'Unknown pluck column "missingAttribute" for Task',
          payload: {pluck: "missingAttribute"},
          requestId: "invalid-pluck"
        },
        {
          expectedMessage: 'Unknown sort column "missingAttribute" for Task',
          payload: {sort: "missingAttribute asc"},
          requestId: "invalid-sort"
        },
        {
          expectedMessage: 'Unknown ransack attribute "missingAttribute" for Task',
          payload: {ransack: {missingAttribute_eq: "value"}},
          requestId: "invalid-ransack"
        },
        {
          expectedMessage: 'Unknown ransack attribute "encryptedPassword" for User',
          model: "User",
          payload: {ransack: {encryptedPassword_eq: "secret"}},
          requestId: "hidden-ransack"
        }
      ]) {
        const configuration = buildFrontendModelControllerConfiguration("production", {resolveFrontendModelAbility: true})
        /** @type {any[]} */
        const allErrors = []
        /** @type {any[]} */
        const frameworkErrors = []

        configuration.getErrorEvents().on("all-error", (/** @type {any} */ payload) => allErrors.push(payload))
        configuration.getErrorEvents().on("framework-error", (/** @type {any} */ payload) => frameworkErrors.push(payload))

        const payload = await runFrontendApi({
          configuration,
          params: {
            modelName: requestCase.model || "Task",
            requests: [{
              commandType: "index",
              model: requestCase.model || "Task",
              payload: requestCase.payload,
              requestId: requestCase.requestId
            }]
          }
        })
        const response = /** @type {Record<string, any>} */ (payload.responses?.[0]?.response || payload)

        expect(response.status).toEqual("error")
        expect(response.errorMessage).toEqual(requestCase.expectedMessage)
        expect(response.velocious).toEqual({code: "frontend-model-query-error"})
        expect(frameworkErrors).toEqual([])
        expect(allErrors).toEqual([])
      }
    })
  })
})
