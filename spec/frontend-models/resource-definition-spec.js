// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import {frontendModelResourceConfigurationFromDefinition} from "../../src/frontend-models/resource-definition.js"

describe("frontendModelResourceConfigurationFromDefinition abilities normalization", {databaseCleaning: {transaction: true}}, () => {
  it("rejects resourceConfig overrides on resource classes", () => {
    class FooResource extends FrontendModelBaseResource {
      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {attributes: ["id"]}
      }
    }

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(FooResource)
    }).toThrow("FooResource overrides static resourceConfig(), which is not supported. Use static resource properties instead.")
  })

  it("defaults to full CRUD when abilities are not declared", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
    }

    const config = frontendModelResourceConfigurationFromDefinition(FooResource)

    expect(config?.abilities).toEqual({
      create: "create",
      destroy: "destroy",
      find: "read",
      index: "read",
      update: "update"
    })
  })

  it("rejects base CRUD abilities in explicit resource abilities", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static abilities = ["read"]
    }

    expect(() => {
      frontendModelResourceConfigurationFromDefinition(FooResource)
    }).toThrow("Resource abilities must not include base actions: read")
  })

  it("adds custom explicit abilities on top of default CRUD abilities", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static abilities = ["approve", "archive"]
    }

    const config = frontendModelResourceConfigurationFromDefinition(FooResource)

    expect(config?.abilities).toEqual({
      archive: "archive",
      approve: "approve",
      create: "create",
      destroy: "destroy",
      find: "read",
      index: "read",
      update: "update"
    })
  })
})
