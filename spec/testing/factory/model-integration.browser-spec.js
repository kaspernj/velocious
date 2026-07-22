import DatabaseRecord, {ValidationError} from "../../../src/database/record/index.js"
import {beforeEach, describe, expect, it} from "../../../src/testing/test.js"
import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import defineDummyFactories from "../../dummy/src/support/factories.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Factory - model integration", {tags: ["dummy"]}, () => {
  /** @type {import("../../../src/testing/factory/factory-registry.js").default} */
  let factory

  beforeEach(() => {
    factory = defineDummyFactories(createFactoryRegistry())
  })

  it("build returns an unsaved record graph and persists nothing", async () => {
    const task = await factory.build("task")

    expect(task).toBeInstanceOf(Task)
    expect(task.isNewRecord()).toBeTrue()
    expect(task.name()).toMatch(/^Task /)
    expect(task.project()).toBeInstanceOf(Project)
    expect(task.project().isNewRecord()).toBeTrue()
    expect(await Task.count()).toEqual(0)
    expect(await Project.count()).toEqual(0)
  })

  it("create persists the record and its belongs-to association", async () => {
    const task = await factory.create("task")

    expect(task.isPersisted()).toBeTrue()
    expect(task.id()).not.toBeUndefined()
    expect(task.project().isPersisted()).toBeTrue()
    expect(task.projectId()).toEqual(task.project().id())

    const reloaded = await Task.find(task.id())

    expect(reloaded.name()).toEqual(task.name())
  })

  it("attributesFor resolves scalars but omits associations and creates nothing", async () => {
    const attributes = await factory.attributesFor("task")

    expect(attributes.name).toMatch(/^Task /)
    expect("project" in attributes).toBeFalse()
    expect("projectId" in attributes).toBeFalse()
    expect(await Task.count()).toEqual(0)
    expect(await Project.count()).toEqual(0)
  })

  it("createList persists deterministic sequential records", async () => {
    const tasks = await factory.createList("task", 3)

    expect(tasks).toHaveLength(3)
    expect(tasks.map((task) => task.name())).toEqual(["Task 1", "Task 2", "Task 3"])
    expect(await Task.count()).toEqual(3)
  })

  it("buildList builds without persisting", async () => {
    const tasks = await factory.buildList("task", 2)

    expect(tasks).toHaveLength(2)
    expect(await Task.count()).toEqual(0)
  })

  it("propagates a native ValidationError unchanged", async () => {
    let caught

    try {
      await factory.create("task", {name: null})
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ValidationError)
    expect(caught.getValidationErrors().name).not.toBeUndefined()
  })

  it("rejects a factory whose model is not a backend record with a model-contract error", async () => {
    const registry = createFactoryRegistry()

    class NotAModel {}

    registry.define(({factory: defineFactory}) => {
      defineFactory("bad", NotAModel, ({attribute}) => attribute("x", 1))
    })

    await expect(async () => await registry.build("bad")).toThrow(/not a supported Velocious backend record/)
  })

  it("rejects an uninitialized backend model class with a model-contract error", async () => {
    const registry = createFactoryRegistry()

    class Uninitialized extends DatabaseRecord {}

    registry.define(({factory: defineFactory}) => {
      defineFactory("uninitialized", Uninitialized, ({attribute}) => attribute("x", 1))
    })

    await expect(async () => await registry.build("uninitialized")).toThrow(/has not been initialized/)
  })
})
