// @ts-check

import frontendModelCommandRouteHook from "../../src/routes/hooks/frontend-model-command-route-hook.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {import("../../src/configuration-types.js").BackendProjectConfiguration[]} backendProjects - Backend project config.
 * @returns {Pick<import("../../src/configuration.js").default, "getBackendProjects">} - Minimal configuration stub.
 */
function configurationForBackendProjects(backendProjects) {
  return {
    getBackendProjects() {
      return backendProjects
    }
  }
}

describe("routes - frontend model command route hook", () => {
  const expectedFallbackControllerPath = new URL("../../src/frontend-model-controller.js", import.meta.url).href

  it("returns frontend model fallback controller path for shared API path", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([]),
      currentPath: "/velocious/api"
    })

    expect(routeMatch).toEqual({
      action: "frontend-api",
      controller: "velocious/api",
      fallbackControllerPath: expectedFallbackControllerPath
    })
  })

  it("returns frontend model fallback controller path for backend project frontend-model commands", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        resources: {
          User: {
            abilities: {
              find: "read",
              index: "read"
            },
            commands: {
              find: "frontend-find",
              index: "frontend-index"
            },
            path: "/partners/frontend-models/users"
          }
        }
      }]),
      currentPath: "/partners/frontend-models/users/frontend-index"
    })

    expect(routeMatch).toEqual({
      action: "frontend-index",
      controller: "partners/frontend-models/users",
      fallbackControllerPath: expectedFallbackControllerPath
    })
  })

})
