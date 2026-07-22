import {beforeEach, describe, expect, it} from "../../../src/testing/test.js"
import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Factory - custom construction", {tags: ["dummy"]}, () => {
  /** @type {import("../../../src/testing/factory/factory-registry.js").default} */
  let registry

  beforeEach(() => {
    registry = createFactoryRegistry()
  })

  it("does not re-assign a constructor-consumed attribute but assigns the rest", async () => {
    registry.define(({factory}) => {
      factory("task", Task, ({attribute, initializeWith}) => {
        attribute("name", "Original")
        attribute("description", "A description")
        initializeWith(async ({get}) => new Task({name: `${await get("name")}!`}))
      })
    })

    const task = await registry.build("task")

    expect(task.name()).toEqual("Original!")
    expect(task.description()).toEqual("A description")
  })

  it("keeps an undeclared call-site override key assignable when the model accepts it", async () => {
    registry.define(({factory}) => {
      factory("task", Task, ({attribute}) => attribute("name", "Task"))
    })

    const task = await registry.build("task", {description: "Extra detail"})

    expect(task.description()).toEqual("Extra detail")
  })

  it("persists through a custom toCreate instead of the default save", async () => {
    let toCreateCalled = false

    registry.define(({factory}) => {
      factory("project", Project, ({attribute}) => attribute("name", "Custom project"))

      factory("task", Task, ({association, attribute, toCreate}) => {
        attribute("name", "Custom persisted task")
        association("project")
        toCreate(async ({record}) => {
          toCreateCalled = true
          await record.save()
        })
      })
    })

    const task = await registry.create("task")

    expect(toCreateCalled).toBeTrue()
    expect(task.isPersisted()).toBeTrue()
  })

  it("skips persistence entirely with skipCreate", async () => {
    registry.define(({factory}) => {
      factory("task", Task, ({attribute, skipCreate}) => {
        attribute("name", "Unsaved task")
        skipCreate()
      })
    })

    const task = await registry.create("task")

    expect(task.isNewRecord()).toBeTrue()
    expect(await Task.count()).toEqual(0)
  })
})
