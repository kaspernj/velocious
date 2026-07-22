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

describe("Factory - sequences", () => {
  it("generates increasing numeric values by default starting at 1", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("counter"))

    expect(await registry.generate("counter")).toEqual(1)
    expect(await registry.generate("counter")).toEqual(2)
    expect(await registry.generate("counter")).toEqual(3)
  })

  it("supports a formatter that receives the allocated value", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("email", ({value}) => `user${value}@example.com`))

    expect(await registry.generate("email")).toEqual("user1@example.com")
    expect(await registry.generate("email")).toEqual("user2@example.com")
  })

  it("supports a custom initial value", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("code", {initial: 1000}, ({value}) => value))

    expect(await registry.generate("code")).toEqual(1000)
    expect(await registry.generate("code")).toEqual(1001)
  })

  it("shares state between aliased sequences", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("primary", {aliases: ["secondary"]}, ({value}) => value))

    expect(await registry.generate("primary")).toEqual(1)
    expect(await registry.generate("secondary")).toEqual(2)
    expect(await registry.generate("primary")).toEqual(3)
  })

  it("generates a list of successive values", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("counter"))

    expect(await registry.generateList("counter", 3)).toEqual([1, 2, 3])
  })

  it("peeks the next value without consuming it, and set/rewind adjust the counter", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("counter", {initial: 5}, ({value}) => value))

    expect(registry.peekSequence("counter")).toEqual(5)
    expect(await registry.generate("counter")).toEqual(5)

    registry.setSequence("counter", 20)
    expect(await registry.generate("counter")).toEqual(20)

    registry.rewindSequence("counter")
    expect(await registry.generate("counter")).toEqual(5)
  })

  it("consumes the allocated value even when the formatter throws", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("flaky", ({value}) => {
      if (value === 1) throw new Error("format boom")

      return value
    }))

    await expect(async () => await registry.generate("flaky")).toThrow(/format boom/)
    expect(await registry.generate("flaky")).toEqual(2)
  })

  it("never yields duplicate values under concurrent allocation", async () => {
    const registry = createFactoryRegistry()

    registry.define(({sequence}) => sequence("counter"))

    const values = await Promise.all(Array.from({length: 100}, () => registry.generate("counter")))
    const unique = new Set(values)

    expect(unique.size).toEqual(100)
  })

  it("resolves factory-scoped sequences before global ones", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory, sequence}) => {
      sequence("token", ({value}) => `global-${value}`)

      factory("user", ModelDouble, ({attribute, sequence: factorySequence}) => {
        factorySequence("token", ({value}) => `local-${value}`)
        attribute("token", ({generate}) => generate("token"))
      })
    })

    expect((await registry.attributesFor("user")).token).toEqual("local-1")
  })
})
