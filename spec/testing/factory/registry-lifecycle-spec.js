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

describe("Factory - registry lifecycle", () => {
  it("modify appends and overrides declarations by recompiling immutably", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("widget", ModelDouble, ({attribute}) => {
        attribute("name", "Widget")
        attribute("color", "blue")
      })
    })

    registry.modify(({factory}) => {
      factory("widget", ({attribute}) => {
        attribute("color", "red")
        attribute("size", "large")
      })
    })

    expect(await registry.attributesFor("widget")).toEqual({name: "Widget", color: "red", size: "large"})
  })

  it("reset clears every definition, trait and sequence", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory, sequence}) => {
      sequence("n")
      factory("widget", ModelDouble, ({attribute}) => attribute("name", "Widget"))
    })

    registry.reset()

    await expect(async () => await registry.attributesFor("widget")).toThrow(/No factory/)
  })

  it("rewindSequences resets counters while leaving definitions intact", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("counter"))

    expect(await registry.generate("counter")).toEqual(1)
    expect(await registry.generate("counter")).toEqual(2)

    registry.rewindSequences()

    expect(await registry.generate("counter")).toEqual(1)
  })

  it("emits start and success events without attribute values", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => factory("widget", ModelDouble, ({attribute}) => attribute("secret", "sensitive")))

    /** @type {Array<{event: string, payload: object}>} */
    const emitted = []

    registry.on("start", (payload) => emitted.push({event: "start", payload}))
    registry.on("success", (payload) => emitted.push({event: "success", payload}))

    await registry.attributesFor("widget")

    expect(emitted.map((entry) => entry.event)).toEqual(["start", "success"])
    expect(emitted[0].payload.factory).toEqual("widget")
    expect(JSON.stringify(emitted)).not.toContain("sensitive")
  })

  it("emits a failure event when a run throws", async () => {
    const registry = createFactoryRegistry()
    let failures = 0

    registry.on("failure", () => { failures += 1 })

    await expect(async () => await registry.attributesFor("missing")).toThrow(/No factory/)
    expect(failures).toEqual(1)
  })

  it("rejects registry mutation while an evaluation is active", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory}) => {
      factory("widget", ModelDouble, ({attribute}) => {
        attribute("name", () => {
          registry.define(() => {})

          return "Widget"
        })
      })
    })

    await expect(async () => await registry.attributesFor("widget")).toThrow(/setup-time only/)
  })
})
