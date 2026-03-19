// @ts-check

import frontendModelCommandRouteHook from "../../src/routes/hooks/frontend-model-command-route-hook.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import {frontendModelActionForCommand, frontendModelResourceConfigurationFromDefinition} from "../../src/frontend-models/resource-definition.js"
import {describe, expect, it} from "../../src/testing/test.js"

class UserFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      collectionCommands: {
        index: "frontend-index"
      },
      memberCommands: {
        find: "frontend-find",
        update: "update"
      },
      path: "/partners/frontend-models/users"
    }
  }
}

class ProjectFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read"],
      attributes: ["id"],
      collectionCommands: ["index"],
      memberCommands: ["find"]
    }
  }
}

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
  const expectedControllerPath = new URL("../../src/frontend-model-controller.js", import.meta.url).href

  it("returns frontend model controller path for shared API path", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([]),
      currentPath: "/frontend-models"
    })

    expect(routeMatch).toEqual({
      action: "frontend-api",
      controller: "velocious/api",
      controllerPath: expectedControllerPath
    })
  })

  it("returns frontend model controller path for shared request path alias", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([]),
      currentPath: "/frontend-models/request"
    })

    expect(routeMatch).toEqual({
      action: "frontend-api",
      controller: "velocious/api",
      controllerPath: expectedControllerPath
    })
  })

  it("returns frontend model controller path for legacy shared API path alias", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([]),
      currentPath: "/velocious/api"
    })

    expect(routeMatch).toEqual({
      action: "frontend-api",
      controller: "velocious/api",
      controllerPath: expectedControllerPath
    })
  })

  it("returns frontend model command action and controller for backend project routes", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        resources: {
          User: UserFrontendResource
        }
      }]),
      currentPath: "/partners/frontend-models/users/frontend-index"
    })

    expect(routeMatch).toEqual({
      action: "frontend-index",
      controller: "partners/frontend-models/users"
    })
  })

  it("infers default path and array command config for backend project routes", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        resources: {
          Project: ProjectFrontendResource
        }
      }]),
      currentPath: "/projects/index"
    })

    expect(routeMatch).toEqual({
      action: "frontend-index",
      controller: "projects"
    })
  })

  it("keeps explicit object ability subsets read-only", () => {
    const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(UserFrontendResource)

    expect(resourceConfiguration?.abilities).toEqual({
      find: "read",
      index: "read"
    })
  })

  it("treats explicit array command subsets as restrictive", () => {
    expect(frontendModelActionForCommand({
      commandName: "index",
      modelName: "Project",
      resourceDefinition: ProjectFrontendResource
    })).toEqual("index")
    expect(frontendModelActionForCommand({
      commandName: "find",
      modelName: "Project",
      resourceDefinition: ProjectFrontendResource
    })).toEqual("find")
    expect(frontendModelActionForCommand({
      commandName: "create",
      modelName: "Project",
      resourceDefinition: ProjectFrontendResource
    })).toEqual(null)
    expect(frontendModelActionForCommand({
      commandName: "destroy",
      modelName: "Project",
      resourceDefinition: ProjectFrontendResource
    })).toEqual(null)
    expect(frontendModelActionForCommand({
      commandName: "update",
      modelName: "Project",
      resourceDefinition: ProjectFrontendResource
    })).toEqual(null)
  })

})
