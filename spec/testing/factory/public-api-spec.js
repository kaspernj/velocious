import Factory, {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import {beforeEach, describe, expect, it} from "../../../src/testing/test.js"

class ModelDouble {
  /**
   * @param {Record<string, ?>} attributes - Assigned attributes.
   */
  constructor(attributes = {}) {
    Object.assign(this, attributes)
  }
}

describe("Factory - public API", () => {
  beforeEach(() => {
    Factory.reset()
  })

  it("exposes a default singleton with define/attributesFor", async () => {
    Factory.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => attribute("name", "Project"))
    })

    expect(await Factory.attributesFor("project")).toEqual({name: "Project"})
  })

  it("normalizes invocation args as name, ordered traits, then final overrides", async () => {
    Factory.define(({factory, trait}) => {
      trait("archived", ({attribute}) => attribute("state", "archived"))
      trait("flagged", ({attribute}) => attribute("flag", true))

      factory("project", ModelDouble, ({attribute}) => {
        attribute("name", "Project")
        attribute("state", "active")
        attribute("flag", false)
      })
    })

    const attributes = await Factory.attributesFor("project", "archived", "flagged", {name: "Explicit"})

    expect(attributes).toEqual({name: "Explicit", state: "archived", flag: true})
  })

  it("produces attributesForList and attributesForPair", async () => {
    Factory.define(({factory, sequence}) => {
      sequence("n")

      factory("project", ModelDouble, ({attribute}) => {
        attribute("index", ({generate}) => generate("n"))
      })
    })

    const list = await Factory.attributesForList("project", 3)
    const pair = await Factory.attributesForPair("project")

    expect(list.map((entry) => entry.index)).toEqual([1, 2, 3])
    expect(pair).toHaveLength(2)
  })

  it("reset clears definitions on the default singleton", async () => {
    Factory.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => attribute("name", "Project"))
    })

    Factory.reset()

    await expect(async () => await Factory.attributesFor("project")).toThrow(/No factory/)
  })

  it("exposes createFactoryRegistry for isolated registries independent of the singleton", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => attribute("name", "Isolated"))
    })

    Factory.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => attribute("name", "Singleton"))
    })

    expect((await registry.attributesFor("project")).name).toEqual("Isolated")
    expect((await Factory.attributesFor("project")).name).toEqual("Singleton")
  })
})
