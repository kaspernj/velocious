import DatabaseRecord from "../../../src/database/record/index.js"
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

  it("rejects traits after overrides and multiple override objects", async () => {
    Factory.define(({factory, trait}) => {
      trait("archived", ({attribute}) => attribute("state", "archived"))
      factory("project", ModelDouble, ({attribute}) => attribute("name", "Project"))
    })

    await expect(async () => await Factory.attributesFor("project", {name: "Explicit"}, "archived")).toThrow(/Expected trait names then a single final overrides object/)
    await expect(async () => await Factory.attributesFor("project", {name: "First"}, {name: "Second"})).toThrow(/Expected trait names then a single final overrides object/)
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

  it("compiles a list plan once while keeping evaluation and events per entry", async () => {
    const registry = createFactoryRegistry()
    const startedInvocationIds = []
    const overrides = {name: "Initial"}
    let compileCount = 0
    let evaluationCount = 0

    registry.define(({factory, sequence}) => {
      sequence("n")

      factory("project", ModelDouble, ({attribute}) => {
        attribute("index", ({generate}) => generate("n"))
        attribute("evaluation", () => {
          evaluationCount += 1
          overrides.name = `Changed ${evaluationCount}`

          return evaluationCount
        })
      })
    })

    const originalCompileTemplate = registry._runner.compileTemplate.bind(registry._runner)
    registry._runner.compileTemplate = (...args) => {
      compileCount += 1

      return originalCompileTemplate(...args)
    }
    registry.on("start", ({invocationId}) => startedInvocationIds.push(invocationId))

    const list = await registry.attributesForList("project", 3, overrides)

    expect(compileCount).toEqual(1)
    expect(list.map((entry) => entry.index)).toEqual([1, 2, 3])
    expect(list.map((entry) => entry.evaluation)).toEqual([1, 2, 3])
    expect(list.map((entry) => entry.name)).toEqual(["Initial", "Changed 1", "Changed 2"])
    expect(new Set(startedInvocationIds).size).toEqual(3)
  })

  it("skips backend relationship metadata when no overrides were passed", async () => {
    const registry = createFactoryRegistry()
    let metadataReadCount = 0

    class BackendModelDouble extends DatabaseRecord {
      static getColumnNameToAttributeNameMap() {
        metadataReadCount += 1

        return {}
      }
    }

    registry.define(({factory}) => {
      factory("backendProject", BackendModelDouble, ({attribute}) => attribute("name", "Project"))
    })

    expect(await registry.attributesFor("backendProject")).toEqual({name: "Project"})
    expect(metadataReadCount).toEqual(0)
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
