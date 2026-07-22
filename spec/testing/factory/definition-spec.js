import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

// A structural model double. `attributesFor` never constructs a model, so these
// definition/precedence specs stay DB-free and use a placeholder class.
class ModelDouble {
  /**
   * @param {Record<string, ?>} attributes - Assigned attributes.
   */
  constructor(attributes = {}) {
    Object.assign(this, attributes)
  }
}

describe("Factory - definitions", () => {
  it("registers a factory and resolves its literal attributes via attributesFor", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("name", "Default project")
        attribute("priority", 3)
      })
    })

    const attributes = await registry.attributesFor("project")

    expect(attributes).toEqual({name: "Default project", priority: 3})
  })

  it("resolves lazy and dependent attributes with a named evaluator context", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("base", () => 2)
        attribute("doubled", async ({get}) => (await get("base")) * 2)
      })
    })

    const attributes = await registry.attributesFor("project")

    expect(attributes).toEqual({base: 2, doubled: 4})
  })

  it("throws a duplicate-definition error for a repeated factory name", () => {
    const registry = createFactoryRegistry()

    expect(() => {
      registry.define(({factory}) => {
        factory("project", ModelDouble, ({attribute}) => attribute("name", "a"))
        factory("project", ModelDouble, ({attribute}) => attribute("name", "b"))
      })
    }).toThrow(/already (defined|registered)/)
  })

  it("throws an actionable error for an unknown factory name", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => attribute("name", "a"))
    })

    await expect(async () => await registry.attributesFor("nope")).toThrow(/No factory.*nope/)
  })

  it("lets a child factory be defined before its parent (lazy compilation)", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("adminUser", {parent: "user"}, ({attribute}) => {
        attribute("admin", true)
      })

      factory("user", ModelDouble, ({attribute}) => {
        attribute("name", "User")
        attribute("admin", false)
      })
    })

    const attributes = await registry.attributesFor("adminUser")

    expect(attributes).toEqual({name: "User", admin: true})
  })

  it("applies factory aliases as references to the same definition", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("user", {model: ModelDouble, aliases: ["author", "commenter"]}, ({attribute}) => {
        attribute("name", "User")
      })
    })

    expect(await registry.attributesFor("author")).toEqual({name: "User"})
    expect(await registry.attributesFor("commenter")).toEqual({name: "User"})
  })

  it("applies trait then invocation override precedence (last applicable wins)", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory, trait}) => {
      trait("important", ({attribute}) => {
        attribute("priority", 9)
      })

      factory("project", ModelDouble, ({attribute}) => {
        attribute("name", "Project")
        attribute("priority", 1)
      })
    })

    expect(await registry.attributesFor("project")).toEqual({name: "Project", priority: 1})
    expect(await registry.attributesFor("project", "important")).toEqual({name: "Project", priority: 9})
    expect(await registry.attributesFor("project", "important", {priority: 42})).toEqual({name: "Project", priority: 42})
  })

  it("omits transient attributes from attributesFor while keeping them available to dependencies", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute, transient}) => {
        transient("multiplier", 3)
        attribute("score", async ({get}) => (await get("multiplier")) * 10)
      })
    })

    const attributes = await registry.attributesFor("project")

    expect(attributes).toEqual({score: 30})
    expect("multiplier" in attributes).toBeFalse()
  })

  it("detects attribute dependency cycles and reports the full path", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("a", async ({get}) => await get("b"))
        attribute("b", async ({get}) => await get("a"))
      })
    })

    await expect(async () => await registry.attributesFor("project")).toThrow(/cycle.*a.*b|a.*b.*a/i)
  })
})
