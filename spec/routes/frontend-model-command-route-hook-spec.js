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
      builtInCollectionCommands: {
        index: "frontend-index"
      },
      builtInMemberCommands: {
        find: "frontend-find",
        update: "update"
      },
      collectionCommands: {
        reindexAll: "reindex-all"
      },
      memberCommands: {
        resetPassword: "reset-password"
      }
    }
  }
}

class ProjectFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read"],
      attributes: ["id"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"]
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

  it("returns frontend model command action and controller for backend project routes", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        frontendModels: {
          User: UserFrontendResource
        }
      }]),
      currentPath: "/users/frontend-index"
    })

    expect(routeMatch).toEqual({
      action: "frontend-index",
      controller: "users"
    })
  })

  it("routes custom collection commands through the frontend model controller", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        frontendModels: {
          User: UserFrontendResource
        }
      }]),
      currentPath: "/users/reindex-all"
    })

    expect(routeMatch).toEqual({
      action: "frontend-custom-command",
      controller: "users",
      controllerPath: expectedControllerPath,
      params: {
        frontendModelCustomCommandMethodName: "reindexAll",
        frontendModelCustomCommandScope: "collection",
        model: "User"
      }
    })
  })

  it("routes custom member commands through the frontend model controller", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        frontendModels: {
          User: UserFrontendResource
        }
      }]),
      currentPath: "/users/user-1/reset-password"
    })

    expect(routeMatch).toEqual({
      action: "frontend-custom-command",
      controller: "users",
      controllerPath: expectedControllerPath,
      params: {
        frontendModelCustomCommandMethodName: "resetPassword",
        frontendModelCustomCommandScope: "member",
        id: "user-1",
        model: "User"
      }
    })
  })

  it("decodes encoded member ids for custom member commands", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        frontendModels: {
          User: UserFrontendResource
        }
      }]),
      currentPath: "/users/test%40example.com/reset-password"
    })

    expect(routeMatch).toEqual({
      action: "frontend-custom-command",
      controller: "users",
      controllerPath: expectedControllerPath,
      params: {
        frontendModelCustomCommandMethodName: "resetPassword",
        frontendModelCustomCommandScope: "member",
        id: "test@example.com",
        model: "User"
      }
    })
  })

  it("infers default path and array command config for backend project routes", async () => {
    const routeMatch = await frontendModelCommandRouteHook({
      configuration: configurationForBackendProjects([{
        path: "/tmp/backend",
        frontendModels: {
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

  it("separates built-in and custom command normalization for opted-in resources", () => {
    const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(UserFrontendResource)

    expect(resourceConfiguration?.builtInCollectionCommands).toEqual({
      index: "frontend-index"
    })
    expect(resourceConfiguration?.builtInMemberCommands).toEqual({
      find: "frontend-find",
      update: "update"
    })
    expect(resourceConfiguration?.collectionCommands).toEqual({
      reindexAll: "reindex-all"
    })
    expect(resourceConfiguration?.memberCommands).toEqual({
      resetPassword: "reset-password"
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

  it("does not map custom command names onto built-in frontend actions", () => {
    expect(frontendModelActionForCommand({
      commandName: "reindex-all",
      modelName: "User",
      resourceDefinition: UserFrontendResource
    })).toEqual(null)
  })

})
