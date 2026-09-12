// @ts-check

import Ability from "../../src/authorization/ability.js"
import AuthorizationBaseResource from "../../src/authorization/base-resource.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"
import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"

/** Task ability resource scoped by the request authentication token. */
class AuthenticationTokenScopedTaskAbilityResource extends AuthorizationBaseResource {
  static ModelClass = Task

  /** @returns {void} */
  abilities() {
    const params = this.params()

    if (!params) return

    if (params.authenticationToken === "legacy-token") {
      this.can("read", {name: "Legacy token task"})
    } else if (params.authenticationToken === "modern-token") {
      this.can("read", {name: "Modern token task"})
    }
  }
}

/**
 * Posts one shared frontend-model API payload to the dummy application.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} payload - Shared API payload.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Parsed response payload.
 */
async function postFrontendModel(payload) {
  const response = await fetch("http://127.0.0.1:3006/frontend-models", {
    body: JSON.stringify(serializeFrontendModelTransportValue(payload)),
    headers: {"Content-Type": "application/json"},
    method: "POST"
  })

  return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(await response.json()))
}

/**
 * Creates a task with an isolated project.
 * @param {string} name - Task name.
 * @returns {Promise<Task>} Created task.
 */
async function createTask(name) {
  const project = await Project.create({name: `Project for ${name}`})

  return /** @type {Task} */ (await Task.create({name, projectId: project.id()}))
}

/**
 * Runs a callback with token-sensitive Task read authorization.
 * @param {() => Promise<void>} callback - Test callback.
 * @returns {Promise<void>} Resolves after restoring the configured resolver.
 */
async function withAuthenticationTokenScopedTaskAbility(callback) {
  const previousResolver = dummyConfiguration.getAbilityResolver()

  dummyConfiguration.setAbilityResolver(({configuration, params, request, response}) => {
    return new Ability({
      context: {configuration, params, request, response},
      resources: [AuthenticationTokenScopedTaskAbilityResource]
    })
  })

  try {
    await callback()
  } finally {
    dummyConfiguration.setAbilityResolver(previousResolver)
  }
}

describe("Controller frontend model index authentication token", {tags: ["dummy"]}, () => {
  it("uses the legacy token as request context without weakening index payload validation", async () => {
    await Dummy.run(async () => {
      await createTask("Legacy token task")
      await createTask("Modern token task")

      await withAuthenticationTokenScopedTaskAbility(async () => {
        const legacyRequest = {
          requests: [{
            commandType: "index",
            model: "Task",
            payload: {authenticationToken: "legacy-token"},
            requestId: "legacy-token"
          }]
        }
        const legacyResponse = await postFrontendModel(legacyRequest)
        const legacyCommandResponse = legacyResponse.responses[0].response

        expect(legacyCommandResponse.status).toEqual("success")
        expect(legacyCommandResponse.models.map((model) => model.name)).toEqual(["Legacy token task"])
        expect(legacyRequest).toEqual({
          requests: [{
            commandType: "index",
            model: "Task",
            payload: {authenticationToken: "legacy-token"},
            requestId: "legacy-token"
          }]
        })

        const modernResponse = await postFrontendModel({
          requests: [{
            commandType: "index",
            model: "Task",
            payload: {authenticationToken: "legacy-token"},
            requestContext: {authenticationToken: "modern-token"},
            requestId: "modern-token"
          }]
        })

        expect(modernResponse.responses[0].response.models.map((model) => model.name)).toEqual(["Modern token task"])

        const invalidResponse = await postFrontendModel({
          requests: [{
            commandType: "index",
            model: "Task",
            payload: {authenticationToken: "legacy-token", unexpected: true},
            requestId: "unexpected-key"
          }]
        })

        expect(invalidResponse.responses[0].response.errorMessage).toEqual('Unknown frontend-model index payload key "unexpected"')
        expect(invalidResponse.responses[0].response.velocious).toEqual({code: "frontend-model-query-error"})
      })
    })
  })
})
