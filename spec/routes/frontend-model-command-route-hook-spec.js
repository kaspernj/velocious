// @ts-check

import frontendModelCommandRouteHook from "../../src/routes/hooks/frontend-model-command-route-hook.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {import("../../src/configuration-types.js").BackendProjectConfiguration[]} backendProjects - Backend project config.
 * @param {string} directory - Project directory path.
 * @returns {Pick<import("../../src/configuration.js").default, "getBackendProjects" | "getDirectory">} - Minimal configuration stub.
 */
function configurationForBackendProjects(backendProjects, directory = dummyDirectory()) {
  return {
    getDirectory() {
      return directory
    },
    getBackendProjects() {
      return backendProjects
    }
  }
}

describe("routes - frontend model command route hook", () => {
  it("returns frontend model controller class for shared API path", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([]),
      currentPath: "/velocious/api"
    })

    expect(routeMatch).toEqual({
      action: "frontend-api",
      controller: "velocious/api",
      controllerClass: FrontendModelController
    })
  })

  it("returns frontend model controller class for backend project frontend-model commands", async () => {
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
      }], dummyDirectory()),
      currentPath: "/partners/frontend-models/users/frontend-index"
    })

    expect(routeMatch).toEqual({
      action: "frontend-index",
      controller: "partners/frontend-models/users",
      controllerClass: FrontendModelController
    })
  })

  it("does not force frontend model controller class when a local route controller exists", async () => {
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
            path: "/frontend-models"
          }
        }
      }], dummyDirectory()),
      currentPath: "/frontend-models/frontend-index"
    })

    expect(routeMatch).toEqual({
      action: "frontend-index",
      controller: "frontend-models"
    })
  })
})
