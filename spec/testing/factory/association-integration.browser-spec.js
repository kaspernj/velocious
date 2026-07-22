import {beforeEach, describe, expect, it} from "../../../src/testing/test.js"
import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import defineDummyFactories from "../../dummy/src/support/factories.js"
import Project from "../../dummy/src/models/project.js"
import ProjectDetail from "../../dummy/src/models/project-detail.js"
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

  it("lets explicit standard and custom foreign keys suppress declared associations", async () => {
    const project = await factory.create("project")
    const task = await factory.create("task", {projectId: project.id()})

    expect(task.projectId()).toEqual(project.id())
    expect(await Project.count()).toEqual(1)

    const customReference = "factory-custom-reference"
    const userCountBeforeCustomKeyCreate = await User.count()
    const customKeyProject = await factory.create("project", {creatingUserReference: customReference})

    expect(customKeyProject.creatingUserReference()).toEqual(customReference)
    expect(await User.count()).toEqual(userCountBeforeCustomKeyCreate)
  })

  it("gives an explicit association object precedence over its foreign key", async () => {
    const assignedProject = await factory.create("project")
    const conflictingProject = await factory.create("project")
    const task = await factory.create("task", {project: assignedProject, projectId: conflictingProject.id()})

    expect(task.projectId()).toEqual(assignedProject.id())
    expect(task.project()).toBe(assignedProject)
  })

  it("builds hasOne and hasMany associations before persisting only the root", async () => {
    const registry = createFactoryRegistry()

    registry.define(({factory: defineFactory}) => {
      defineFactory("graphTask", Task, ({attribute, toCreate}) => {
        attribute("name", "Graph task")
        toCreate(() => { throw new Error("nested task persistence ran") })
      })

      defineFactory("graphDetail", ProjectDetail, ({attribute, toCreate}) => {
        attribute("note", "Graph detail")
        toCreate(() => { throw new Error("nested detail persistence ran") })
      })

      defineFactory("graphProject", Project, ({association, attribute}) => {
        attribute("name", "Graph project")
        association("projectDetail", {factory: "graphDetail"})
        association("tasks", {factory: "graphTask"})
      })
    })

    const project = await registry.create("graphProject")
    const detail = await ProjectDetail.findBy({projectId: project.id()})
    const tasks = await Task.where({projectId: project.id()}).toArray()

    expect(project.isPersisted()).toBeTrue()
    expect(detail.note()).toEqual("Graph detail")
    expect(tasks.map((task) => task.name())).toEqual(["Graph task"])
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
