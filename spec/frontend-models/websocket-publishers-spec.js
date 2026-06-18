// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {ensureFrontendModelWebsocketPublishersRegistered} from "../../src/frontend-models/websocket-publishers.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import AuthorizationBaseResource from "../../src/authorization/base-resource.js"
import Task from "../dummy/src/models/task.js"
import User from "../dummy/src/models/user.js"

describe("Frontend models - websocket publishers", {databaseCleaning: {transaction: true}}, () => {
  it("auto-discovers frontend model resources from explicit ability resources when no frontend model config exists", async () => {
    class TestTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          builtInCollectionCommands: ["index"],
          builtInMemberCommands: ["find"]
        }
      }
    }

    class TestUserResource extends FrontendModelBaseResource {
      static ModelClass = User

      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {
          attributes: ["id", "email"],
          builtInCollectionCommands: ["index"],
          builtInMemberCommands: ["find"]
        }
      }
    }

    /** @type {string[]} */
    const publishedChannels = []

    const mockConfiguration = {
      getAbilityResources: () => [TestTaskResource, TestUserResource],
      getAbilityResolver: () => undefined,
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({
        Task,
        User
      }),
      getWebsocketEvents: () => ({
        publish: (/** @type {string} */ channel) => {
          publishedChannels.push(channel)
        }
      }),
      registerWebsocketChannel: () => {}
    }

    await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))

    // The function completed without throwing — both model classes were processed
    expect(publishedChannels).toEqual([])
  })

  it("does not call the request-scoped ability resolver during startup-time resource discovery", async () => {
    let abilityResolverCalled = false
    const mockConfiguration = {
      getAbilityResources: () => [],
      getAbilityResolver: () => async () => {
        abilityResolverCalled = true

        throw new Error("Request-scoped ability resolver should not run during startup-time resource discovery")
      },
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({}),
      getWebsocketEvents: () => null,
      registerWebsocketChannel: () => {}
    }

    await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))

    expect(abilityResolverCalled).toBeFalse()
  })

  it("throws when ability resources contain non-function entries", async () => {
    const mockConfiguration = {
      getAbilityResources: () => ["not-a-class"],
      getAbilityResolver: () => undefined,
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({}),
      getWebsocketEvents: () => null,
      registerWebsocketChannel: () => {}
    }

    await expect(async () => {
      await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))
    }).toThrow("Expected ability resource to be a class but got: string")
  })

  it("throws when ability resources contain unexpected class types", async () => {
    class RandomClass {}

    const mockConfiguration = {
      getAbilityResources: () => [RandomClass],
      getAbilityResolver: () => undefined,
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({}),
      getWebsocketEvents: () => null,
      registerWebsocketChannel: () => {}
    }

    await expect(async () => {
      await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))
    }).toThrow("Unexpected ability resource class: RandomClass. Expected AuthorizationBaseResource or FrontendModelBaseResource subclass.")
  })

  it("skips AuthorizationBaseResource subclasses that are not FrontendModelBaseResource", async () => {
    class TestAuthResource extends AuthorizationBaseResource {}

    class TestTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          builtInCollectionCommands: ["index"],
          builtInMemberCommands: ["find"]
        }
      }
    }

    const mockConfiguration = {
      getAbilityResources: () => [TestAuthResource, TestTaskResource],
      getAbilityResolver: () => undefined,
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({
        Task
      }),
      getWebsocketEvents: () => ({
        publish: () => {}
      }),
      registerWebsocketChannel: () => {}
    }

    // Should not throw — TestAuthResource is skipped, TestTaskResource is registered
    await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))
  })

  it("skips abstract FrontendModelBaseResource subclasses without a ModelClass during ability-resource discovery", async () => {
    // An app's shared abstract base resource that real resources extend.
    class AbstractBaseResource extends FrontendModelBaseResource {}

    class TestTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          builtInCollectionCommands: ["index"],
          builtInMemberCommands: ["find"]
        }
      }
    }

    const mockConfiguration = {
      getAbilityResources: () => [AbstractBaseResource, TestTaskResource],
      getAbilityResolver: () => undefined,
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({
        Task
      }),
      getWebsocketEvents: () => ({
        publish: () => {}
      }),
      registerWebsocketChannel: () => {}
    }

    // Must not throw "AbstractBaseResource requires a static ModelClass" — the
    // abstract base is skipped and the real resource is still registered.
    await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))
  })

  it("auto-discovers each backend project's resources before registering publishers", async () => {
    // Regression: `initializeFrontendModelWebsocketPublishers` must run resource
    // discovery first. Publishers are derived from `backendProject.frontendModels`,
    // which `autoDiscoverResources` populates. If registration ran before discovery,
    // apps that resolve resources through an `abilityResolver` (rather than a static
    // ability-resource list) registered no publishers and their realtime
    // frontend-model updates silently stopped.
    class TestTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          builtInCollectionCommands: ["index"],
          builtInMemberCommands: ["find"]
        }
      }
    }

    /** @type {{path: string, frontendModels?: Record<string, unknown>}} */
    const backendProject = {path: "/tmp/velocious-publisher-discovery-regression"}
    /** @type {string[]} */
    const callOrder = []

    const mockConfiguration = {
      getBackendProjects: () => [backendProject],
      // Always read (and merged with discovered resources) so resources supplied only
      // through the ability resolver still register publishers.
      getAbilityResources: () => {
        callOrder.push("read-ability-resources-fallback")

        return []
      },
      registerWebsocketChannel: () => {}
    }

    class TestEnvironmentHandlerNode extends EnvironmentHandlerNode {
      /**
       * @param {any} _configuration
       * @returns {Promise<void>}
       */
      async autoDiscoverResources(_configuration) {
        callOrder.push("auto-discover")
        // Emulate file-system discovery populating the backend project.
        backendProject.frontendModels = {Task: TestTaskResource}
      }
    }

    const environmentHandler = new TestEnvironmentHandlerNode()

    await environmentHandler.initializeFrontendModelWebsocketPublishers(/** @type {any} */ (mockConfiguration))

    // Discovery ran first and populated `frontendModels`, and the ability-resource
    // list is then also read and merged — a project can expose some resources as
    // discoverable files and others only through `getAbilityResources()`, so discovery
    // must not suppress the ability-resource list.
    expect(callOrder).toEqual(["auto-discover", "read-ability-resources-fallback"])
    expect(backendProject.frontendModels).toEqual({Task: TestTaskResource})
  })
})
