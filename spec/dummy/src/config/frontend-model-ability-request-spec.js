import backendProjects from "./backend-projects.js"
import {describe, expect, it} from "../../../../src/testing/test.js"
import isFrontendModelAbilityRequest from "./frontend-model-ability-request.js"

/**
 * @param {string} path - Request path.
 * @returns {{path: () => string}} - Request stub.
 */
function requestStub(path) {
  return {
    path() {
      return path
    }
  }
}

describe("Dummy frontend model ability request helper", () => {
  it("matches shared frontend-model API requests with model payloads", () => {
    const result = isFrontendModelAbilityRequest({
      backendProjects,
      params: {
        requests: [{
          commandType: "index",
          model: "Task",
          payload: {}
        }]
      },
      request: requestStub("/frontend-models")
    })

    expect(result).toEqual(true)
  })

  it("matches direct built-in frontend-model command routes", () => {
    const result = isFrontendModelAbilityRequest({
      backendProjects,
      params: {},
      request: requestStub("/tasks/list")
    })

    expect(result).toEqual(true)
  })

  it("matches direct custom frontend-model member command routes", () => {
    const result = isFrontendModelAbilityRequest({
      backendProjects,
      params: {},
      request: requestStub("/users/user-1/refresh-profile")
    })

    expect(result).toEqual(true)
  })

  it("ignores unrelated routes", () => {
    const result = isFrontendModelAbilityRequest({
      backendProjects,
      params: {},
      request: requestStub("/raw-socket")
    })

    expect(result).toEqual(false)
  })
})
