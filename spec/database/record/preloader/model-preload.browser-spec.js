// @ts-check

import Preloader from "../../../../src/database/query/preloader.js"
import Comment from "../../../dummy/src/models/comment.js"
import Interaction from "../../../dummy/src/models/interaction.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - preloader - model preload", {tags: ["dummy"]}, () => {
  it("preloads a relationship onto an already-loaded record", async () => {
    const project = await Project.create({})
    const task = await Task.create({projectId: project.id(), name: "Model preload task"})
    const found = /** @type {Task} */ (await Task.find(task.id()))

    await found.preload(Task.preload("project"))

    expect(found.project().id()).toEqual(project.id())
  })

  it("preloads nested relationships onto an already-loaded record", async () => {
    const project = await Project.create({})

    await Task.create({projectId: project.id(), name: "Nested preload task"})

    const found = /** @type {Task} */ (await Task.find((await Task.last()).id()))

    await found.preload(Task.preload({project: "tasks"}))

    const loadedProject = found.project()
    const tasks = /** @type {Task[]} */ (loadedProject.tasks().loaded())

    expect(tasks.length).toBeGreaterThan(0)
  })

  it("preloads across an array of records via Preloader.preload", async () => {
    const project = await Project.create({})
    const task1 = await Task.create({projectId: project.id(), name: "Array preload 1"})
    const task2 = await Task.create({projectId: project.id(), name: "Array preload 2"})
    const found1 = /** @type {Task} */ (await Task.find(task1.id()))
    const found2 = /** @type {Task} */ (await Task.find(task2.id()))

    await Preloader.preload([found1, found2, found1], Task.preload("project"))

    expect(found1.project().id()).toEqual(project.id())
    expect(found2.project().id()).toEqual(project.id())
  })

  it("deduplicates repeated parent IDs for has many preloads", async () => {
    const project = await Project.create({})
    const firstTask = await Task.create({projectId: project.id(), name: "Ordered preload 1"})
    const secondTask = await Task.create({projectId: project.id(), name: "Ordered preload 2"})
    const found = /** @type {Project} */ (await Project.find(project.id()))

    await Preloader.preload([found, found], Project.preload("tasks"))

    const loadedTasks = /** @type {Task[]} */ (found.getRelationshipByName("tasks").loaded())

    expect(loadedTasks.map((task) => task.id())).toEqual(expect.arrayContaining([firstTask.id(), secondTask.id()]))
    expect(loadedTasks.length).toEqual(2)
  })

  it("deduplicates repeated parents for polymorphic belongs to preloads", async () => {
    const project = await Project.create({})
    const task = await Task.create({projectId: project.id(), name: "Polymorphic parent task"})
    const projectInteraction = await Interaction.create({kind: "Project subject", subjectId: project.id(), subjectType: "Project"})
    const taskInteraction = await Interaction.create({kind: "Task subject", subjectId: task.id(), subjectType: "Task"})
    const foundProjectInteraction = /** @type {Interaction} */ (await Interaction.find(projectInteraction.id()))
    const foundTaskInteraction = /** @type {Interaction} */ (await Interaction.find(taskInteraction.id()))

    await Preloader.preload([foundProjectInteraction, foundTaskInteraction, foundProjectInteraction], Interaction.preload("subject"))

    expect(foundProjectInteraction.subject()?.id()).toEqual(project.id())
    expect(foundTaskInteraction.subject()?.id()).toEqual(task.id())
  })

  it("deduplicates repeated parents for has one preloads", async () => {
    const project = await Project.create({})
    const task = await Task.create({projectId: project.id(), name: "Repeated has one parent"})
    const foundProject = /** @type {Project} */ (await Project.find(project.id()))

    await Preloader.preload([foundProject, foundProject], Project.preload("reviewTask"))

    const loadedTask = /** @type {Task | undefined} */ (foundProject.getRelationshipByName("reviewTask").loaded())

    expect(loadedTask?.id()).toEqual(task.id())
  })

  it("deduplicates repeated parents for has many through preloads", async () => {
    const project = await Project.create({})
    const task = await Task.create({projectId: project.id(), name: "Repeated has many through parent"})
    const comment = await Comment.create({taskId: task.id(), body: "Through preload comment"})
    const foundProject = /** @type {Project} */ (await Project.find(project.id()))

    await Preloader.preload([foundProject, foundProject], Project.preload("comments"))

    const loadedComments = /** @type {Comment[]} */ (foundProject.getRelationshipByName("comments").loaded())

    expect(loadedComments.map((loadedComment) => loadedComment.id())).toEqual([comment.id()])
  })

  it("accepts a raw preload spec instead of a query", async () => {
    const project = await Project.create({})
    const task = await Task.create({projectId: project.id(), name: "Raw spec preload"})
    const found = /** @type {Task} */ (await Task.find(task.id()))

    await found.preload("project")

    expect(found.project().id()).toEqual(project.id())
  })

  it("limits the loaded columns with select keyed by model name", async () => {
    const project = await Project.create({creatingUserReference: "ref-select"})
    const task = await Task.create({projectId: project.id(), name: "Select preload"})
    const found = /** @type {Task} */ (await Task.find(task.id()))

    await found.preload(Task.preload("project").select({Project: ["id"]}))

    const loadedProject = found.project()

    expect(loadedProject.id()).toEqual(project.id())
    expect(() => loadedProject.readColumn("creating_user_reference")).toThrow()
  })

  it("loads the default columns plus extras with selectsExtra", async () => {
    const project = await Project.create({creatingUserReference: "ref-extra"})
    const task = await Task.create({projectId: project.id(), name: "Extra preload"})
    const found = /** @type {Task} */ (await Task.find(task.id()))

    await found.preload(Task.preload("project").selectsExtra({Project: ["1 AS extra_flag"]}))

    const loadedProject = found.project()

    expect(loadedProject.readColumn("creating_user_reference")).toEqual("ref-extra")
    expect(loadedProject.readColumn("extra_flag")).toEqual(1)
  })

  it("skips re-loading an already-preloaded relationship unless forced", async () => {
    const project = await Project.create({creatingUserReference: "ref-before"})
    const task = await Task.create({projectId: project.id(), name: "Idempotent preload"})
    const found = /** @type {Task} */ (await Task.find(task.id()))

    await found.preload(Task.preload("project"))

    expect(found.project().readColumn("creating_user_reference")).toEqual("ref-before")

    // Mutate the project in the database through a separate instance.
    const projectAgain = /** @type {Project} */ (await Project.find(project.id()))

    projectAgain.assign({creatingUserReference: "ref-after"})
    await projectAgain.save()

    // Without force the cached value is reused (no re-query).
    await found.preload(Task.preload("project"))

    expect(found.project().readColumn("creating_user_reference")).toEqual("ref-before")

    // With force the relationship is re-loaded and picks up the change.
    await found.preload(Task.preload("project"), {force: true})

    expect(found.project().readColumn("creating_user_reference")).toEqual("ref-after")
  })

  it("keeps preload selects independent across cloned queries", async () => {
    const base = Task.preload("project").select({Project: ["id"]})
    const branch = base.clone().select({Project: ["name"]})

    expect(base._preloadSelects.Project).toEqual(["id"])
    expect(branch._preloadSelects.Project).toEqual(["id", "name"])
  })

  it("re-loads when a wider column set is requested than was previously preloaded", async () => {
    const project = await Project.create({creatingUserReference: "ref-widen"})
    const task = await Task.create({projectId: project.id(), name: "Widen preload"})
    const found = /** @type {Task} */ (await Task.find(task.id()))

    await found.preload(Task.preload("project").select({Project: ["id"]}))

    expect(() => found.project().readColumn("creating_user_reference")).toThrow()

    // Re-preloading without a narrowing select requires all columns, so it loads again.
    await found.preload(Task.preload("project"))

    expect(found.project().readColumn("creating_user_reference")).toEqual("ref-widen")
  })
})
