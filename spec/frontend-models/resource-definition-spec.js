// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import {frontendModelResourceConfigurationFromDefinition} from "../../src/frontend-models/resource-definition.js"

describe("frontendModelResourceConfigurationFromDefinition abilities normalization", () => {
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

  it("honors an explicit subset of CRUD abilities", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static abilities = ["read"]
    }

    const config = frontendModelResourceConfigurationFromDefinition(FooResource)

    expect(config?.abilities).toEqual({find: "read", index: "read"})
  })

  it("collapses every CRUD action onto 'manage' when manage is listed", () => {
    class FooResource extends FrontendModelBaseResource {
      static attributes = ["id"]
      static abilities = ["manage"]
    }

    const config = frontendModelResourceConfigurationFromDefinition(FooResource)

    expect(config?.abilities).toEqual({
      create: "manage",
      destroy: "manage",
      find: "manage",
      index: "manage",
      update: "manage"
    })
  })
})
