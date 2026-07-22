import {beforeEach, describe, expect, it} from "../../../src/testing/test.js"
import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Factory - callbacks", {tags: ["dummy"]}, () => {
  /** @type {import("../../../src/testing/factory/factory-registry.js").default} */
  let registry

  beforeEach(() => {
    registry = createFactoryRegistry()
  })

  it("runs callbacks in global, factory, then requested-trait order", async () => {
    /** @type {string[]} */
    const order = []

    registry.define(({before, factory, trait}) => {
      before("build", () => order.push("global-before"))

      trait("flagged", ({after: traitAfter, before: traitBefore}) => {
        traitBefore("build", () => order.push("trait-before"))
        traitAfter("build", () => order.push("trait-after"))
      })

      factory("task", Task, ({after, attribute, before: factoryBefore}) => {
        attribute("name", "Callback task")
        factoryBefore("build", () => order.push("factory-before"))
        after("build", () => order.push("factory-after"))
      })
    })

    await registry.build("task", "flagged")

    expect(order).toEqual(["global-before", "factory-before", "trait-before", "factory-after", "trait-after"])
  })

  it("runs create-phase callbacks in build/create order", async () => {
    /** @type {string[]} */
    const order = []

    registry.define(({factory}) => {
      factory("project", Project, ({attribute}) => attribute("name", "Order project"))

      factory("task", Task, ({after, association, attribute, before}) => {
        attribute("name", "Ordered task")
        association("project")
        after("build", () => order.push("afterBuild"))
        before("create", () => order.push("beforeCreate"))
        after("create", () => order.push("afterCreate"))
      })
    })

    await registry.create("task")

    expect(order).toEqual(["afterBuild", "beforeCreate", "afterCreate"])
  })

  it("runs a callback reached through multiple composed traits exactly once", async () => {
    let count = 0

    registry.define(({factory, trait}) => {
      trait("shared", ({after}) => after("build", () => { count += 1 }))
      trait("left", ({trait: include}) => include("shared"))
      trait("right", ({trait: include}) => include("shared"))

      factory("task", Task, ({attribute}) => attribute("name", "Deduped task"))
    })

    await registry.build("task", "left", "right")

    expect(count).toEqual(1)
  })

  it("guarantees afterAll cleanup runs even when the build fails", async () => {
    /** @type {string[]} */
    const events = []

    registry.define(({factory}) => {
      factory("task", Task, ({after, attribute, before}) => {
        attribute("name", "Failing task")
        before("build", () => { throw new Error("build boom") })
        after("all", () => events.push("afterAll"))
      })
    })

    await expect(async () => await registry.build("task")).toThrow("build boom")
    expect(events).toEqual(["afterAll"])
  })

  it("preserves the primary error and attaches the afterAll cleanup failure", async () => {
    registry.define(({factory}) => {
      factory("task", Task, ({after, attribute, before}) => {
        attribute("name", "Doomed task")
        before("build", () => { throw new Error("primary failure") })
        after("all", () => { throw new Error("cleanup failure") })
      })
    })

    let caught

    try {
      await registry.build("task")
    } catch (error) {
      caught = error
    }

    expect(caught.message).toEqual("primary failure")
    expect(caught.factoryCleanupErrors).toHaveLength(1)
    expect(caught.factoryCleanupErrors[0].message).toEqual("cleanup failure")
  })

  it("runs afterAll after a successful build", async () => {
    /** @type {string[]} */
    const events = []

    registry.define(({factory}) => {
      factory("task", Task, ({after, attribute}) => {
        attribute("name", "Happy task")
        after("build", () => events.push("afterBuild"))
        after("all", () => events.push("afterAll"))
      })
    })

    await registry.build("task")

    expect(events).toEqual(["afterBuild", "afterAll"])
  })
})
