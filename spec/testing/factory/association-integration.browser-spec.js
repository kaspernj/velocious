import {beforeEach, describe, expect, it} from "../../../src/testing/test.js"
import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import defineDummyFactories from "../../dummy/src/support/factories.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import User from "../../dummy/src/models/user.js"

describe("Factory - association integration", {tags: ["dummy"]}, () => {
  /** @type {import("../../../src/testing/factory/factory-registry.js").default} */
  let factory

  beforeEach(() => {
    factory = defineDummyFactories(createFactoryRegistry())
  })

  it("reuses an explicit existing record and suppresses nested creation", async () => {
    const project = await factory.create("project")

    expect(await Project.count()).toEqual(1)

    const task = await factory.create("task", {project})

    expect(task.projectId()).toEqual(project.id())
    expect(await Project.count()).toEqual(1)
  })

  it("follows the create parent strategy by default", async () => {
    const task = await factory.create("task")

    expect(task.project().isPersisted()).toBeTrue()
    expect(await Project.count()).toEqual(1)
  })

  it("follows the build parent strategy for build (no persisted associations)", async () => {
    const task = await factory.build("task")

    expect(task.project().isNewRecord()).toBeTrue()
    expect(await Project.count()).toEqual(0)
  })

  it("assigns a custom-key belongs-to association through reflection", async () => {
    const user = await factory.create("user")
    const project = await factory.create("project", {creatingUser: user})

    expect(project.creatingUserReference()).toEqual(user.reference())
    expect((await Project.find(project.id())).creatingUserReference()).toEqual(user.reference())
  })

  it("applies a transient plus after(create) callback to build a has-many graph", async () => {
    const project = await factory.create("project", {tasksCount: 3})

    await project.reload()

    expect(project.tasksCount()).toEqual(3)
    expect(await Task.count()).toEqual(3)
  })

  it("applies association traits through a child factory", async () => {
    const doneTask = await factory.create("doneTask")

    expect(doneTask.isDone()).toBeTrue()
    expect(doneTask.project().isPersisted()).toBeTrue()
  })

  it("suppresses nested creation for an explicit null association override", async () => {
    const project = await factory.create("project", {creatingUser: null})

    expect(project.creatingUserReference()).toBeNull()
    expect(await User.count()).toEqual(0)
  })
})
