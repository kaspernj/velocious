import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

class ModelDouble {
  /**
   * @param {Record<string, ?>} attributes - Assigned attributes.
   */
  constructor(attributes = {}) {
    Object.assign(this, attributes)
  }
}

describe("Factory - traits", () => {
  it("applies a factory-local trait, shadowing a global trait of the same name", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory, trait}) => {
      trait("special", ({attribute}) => attribute("kind", "global"))

      factory("widget", ModelDouble, ({attribute, trait: localTrait}) => {
        localTrait("special", ({attribute: localAttribute}) => localAttribute("kind", "local"))
        attribute("kind", "base")
      })
    })

    expect((await registry.attributesFor("widget")).kind).toEqual("base")
    expect((await registry.attributesFor("widget", "special")).kind).toEqual("local")
  })

  it("composes traits that include other traits", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory, trait}) => {
      trait("outer", ({trait: include, attribute}) => {
        include("inner")
        attribute("outerFlag", true)
      })
      trait("inner", ({attribute}) => attribute("innerFlag", true))

      factory("widget", ModelDouble, ({attribute}) => attribute("name", "Widget"))
    })

    expect(await registry.attributesFor("widget", "outer")).toEqual({name: "Widget", outerFlag: true, innerFlag: true})
  })

  it("applies base traits declared through the factory options", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory, trait}) => {
      trait("timestamped", ({attribute}) => attribute("stamped", true))

      factory("widget", {model: ModelDouble, traits: ["timestamped"]}, ({attribute}) => attribute("name", "Widget"))
    })

    expect(await registry.attributesFor("widget")).toEqual({name: "Widget", stamped: true})
  })

  it("raises an actionable error for an unknown trait", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => factory("widget", ModelDouble, ({attribute}) => attribute("name", "Widget")))

    await expect(async () => await registry.attributesFor("widget", "missing")).toThrow(/No trait registered called "missing"/)
  })

  it("detects trait inclusion cycles and reports the path", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory, trait}) => {
      trait("ping", ({trait: include}) => include("pong"))
      trait("pong", ({trait: include}) => include("ping"))

      factory("widget", ModelDouble, ({attribute}) => attribute("name", "Widget"))
    })

    await expect(async () => await registry.attributesFor("widget", "ping")).toThrow(/Trait inclusion cycle/)
  })

  it("lets a nested child factory inherit its parent's model and declarations", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("widget", ModelDouble, ({attribute, factory: childFactory}) => {
        attribute("name", "Widget")
        attribute("active", false)

        childFactory("archivedWidget", ({attribute: childAttribute}) => childAttribute("active", true))
      })
    })

    expect(await registry.attributesFor("archivedWidget")).toEqual({name: "Widget", active: true})
  })
})
