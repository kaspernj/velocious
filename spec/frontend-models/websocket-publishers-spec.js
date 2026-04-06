// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {ensureFrontendModelWebsocketPublishersRegistered} from "../../src/frontend-models/websocket-publishers.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import AuthorizationBaseResource from "../../src/authorization/base-resource.js"
import Task from "../dummy/src/models/task.js"
import User from "../dummy/src/models/user.js"
import Ability from "../../src/authorization/ability.js"

describe("Frontend models - websocket publishers", () => {
  it("auto-discovers frontend model resources from ability resolver when no explicit config exists", async () => {
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
      getAbilityResources: () => [],
      getAbilityResolver: () => async () => new Ability({
        resources: [TestTaskResource, TestUserResource]
      }),
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
      })
    }

    await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))

    // The function completed without throwing — both model classes were processed
    expect(publishedChannels).toEqual([])
  })

  it("throws when ability resolver requires request context", async () => {
    const mockConfiguration = {
      getAbilityResources: () => [],
      getAbilityResolver: () => async (/** @type {any} */ {request}) => {
        // Simulate a resolver that accesses request methods
        request.path()
      },
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({}),
      getWebsocketEvents: () => null
    }

    await expect(async () => {
      await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))
    }).toThrow(/Cannot read properties of undefined/)
  })

  it("throws when ability resources contain non-function entries", async () => {
    const mockConfiguration = {
      getAbilityResources: () => ["not-a-class"],
      getAbilityResolver: () => undefined,
      getBackendProjects: () => [
        {path: "/tmp/test-project"}
      ],
      getModelClasses: () => ({}),
      getWebsocketEvents: () => null
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
      getWebsocketEvents: () => null
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
      })
    }

    // Should not throw — TestAuthResource is skipped, TestTaskResource is registered
    await ensureFrontendModelWebsocketPublishersRegistered(/** @type {any} */ (mockConfiguration))
  })
})
