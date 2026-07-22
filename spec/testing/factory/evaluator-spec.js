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

describe("Factory - evaluator", () => {
  it("memoizes a lazy value exactly once per evaluation, including a falsy value", async () => {
    const registry = createFactoryRegistry()
    let calls = 0

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("flag", () => {
          calls += 1

          return false
        })
        attribute("a", async ({get}) => await get("flag"))
        attribute("b", async ({get}) => await get("flag"))
      })
    })

    const attributes = await registry.attributesFor("project")

    expect(attributes.flag).toBeFalse()
    expect(attributes.a).toBeFalse()
    expect(attributes.b).toBeFalse()
    expect(calls).toEqual(1)
  })

  it("memoizes an in-flight promise so concurrent dependents share one evaluation", async () => {
    const registry = createFactoryRegistry()
    let calls = 0

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("slow", async () => {
          calls += 1
          await Promise.resolve()

          return 7
        })
        attribute("pair", async ({get}) => {
          const [first, second] = await Promise.all([get("slow"), get("slow")])

          return first + second
        })
      })
    })

    const attributes = await registry.attributesFor("project")

    expect(attributes.pair).toEqual(14)
    expect(calls).toEqual(1)
  })

  it("suppresses the original thunk entirely when an override is supplied", async () => {
    const registry = createFactoryRegistry()
    let called = false

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("name", () => {
          called = true

          return "Generated"
        })
      })
    })

    const attributes = await registry.attributesFor("project", {name: "Override"})

    expect(attributes.name).toEqual("Override")
    expect(called).toBeFalse()
  })

  it("keeps extra call-site override keys in the resolved attributes", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("name", "Project")
      })
    })

    const attributes = await registry.attributesFor("project", {extra: "value"})

    expect(attributes).toEqual({name: "Project", extra: "value"})
  })

  it("isolates state between independent registries", async () => {
    const registryA = createFactoryRegistry()
    const registryB = createFactoryRegistry()

    registryA.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => attribute("name", "A"))
    })
    registryB.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => attribute("name", "B"))
    })

    expect((await registryA.attributesFor("project")).name).toEqual("A")
    expect((await registryB.attributesFor("project")).name).toEqual("B")
  })

  it("makes transients available to lazy attributes but never returns them", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("user", ModelDouble, ({attribute, transient}) => {
        transient("upcase", true)
        attribute("name", async ({get}) => (await get("upcase")) ? "ADMIN" : "admin")
      })
    })

    expect(await registry.attributesFor("user")).toEqual({name: "ADMIN"})
    expect(await registry.attributesFor("user", {upcase: false})).toEqual({name: "admin"})
  })

  it("resolves async attributes deterministically", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("project", ModelDouble, ({attribute}) => {
        attribute("first", async () => {
          await Promise.resolve()

          return 1
        })
        attribute("second", async ({get}) => (await get("first")) + 1)
      })
    })

    expect(await registry.attributesFor("project")).toEqual({first: 1, second: 2})
  })
})
