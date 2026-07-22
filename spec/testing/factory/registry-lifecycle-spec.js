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

  it("reset drops event handlers and restarts invocation correlation ids", async () => {
    const registry = createFactoryRegistry()
    /** @type {string[]} */
    const invocationIds = []

    registry.define(({factory}) => factory("widget", ModelDouble, ({attribute}) => attribute("name", "Widget")))
    registry.on("start", ({invocationId}) => invocationIds.push(invocationId))

    await registry.attributesFor("widget")
    registry.reset()
    registry.define(({factory}) => factory("widget", ModelDouble, ({attribute}) => attribute("name", "Reset widget")))
    await registry.attributesFor("widget")

    expect(invocationIds).toEqual(["factory-invocation-1"])

    /** @type {string[]} */
    const resetInvocationIds = []

    registry.on("start", ({invocationId}) => resetInvocationIds.push(invocationId))
    await registry.attributesFor("widget")

    expect(resetInvocationIds).toEqual(["factory-invocation-2"])
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

  it("unwinds the active evaluation count when a start listener throws", async () => {
    const registry = createFactoryRegistry()
    const throwingListener = () => { throw new Error("listener boom") }

    registry.on("start", throwingListener)

    await expect(async () => await registry.attributesFor("missing")).toThrow("listener boom")
    registry.off("start", throwingListener)

    registry.define(({factory}) => factory("widget", ModelDouble, ({attribute}) => attribute("name", "Widget")))

    expect((await registry.attributesFor("widget")).name).toEqual("Widget")
  })
})
