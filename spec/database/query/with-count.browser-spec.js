import Interaction from "../../dummy/src/models/interaction.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Database - query - withCount", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("attaches counts for a basic hasMany", async () => {
    const project = await Project.create({nameEn: "P", nameDe: "P"})

    await Task.create({name: "T1", project})
    await Task.create({name: "T2", project})

    const [loaded] = await Project.where({id: project.id()}).withCount("tasks").toArray()

    expect(loaded.readAttribute("tasksCount")).toEqual(2)
  })

  it("attaches zero for parents with no children", async () => {
    const empty = await Project.create({nameEn: "Empty", nameDe: "Leer"})

    const [loaded] = await Project.where({id: empty.id()}).withCount("tasks").toArray()

    expect(loaded.readAttribute("tasksCount")).toEqual(0)
  })

  it("filters the counted association via where", async () => {
    const project = await Project.create({nameEn: "Filtered", nameDe: "Gefiltert"})

    await Task.create({name: "Done task", project, isDone: true})
    await Task.create({name: "Open task", project, isDone: false})

    const [loaded] = await Project.where({id: project.id()}).withCount({
      doneTasksCount: {relationship: "tasks", where: {isDone: true}}
    }).toArray()

    expect(loaded.readAttribute("doneTasksCount")).toEqual(1)
  })

  it("accepts an array of names as shorthand", async () => {
    const project = await Project.create({nameEn: "Array", nameDe: "Array"})
    const task = await Task.create({name: "T", project})

    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind:"A"})
    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind:"B"})

    const [loadedTask] = await Task.where({id: task.id()}).withCount(["interactions"]).toArray()

    expect(loadedTask.readAttribute("interactionsCount")).toEqual(2)

    const [loadedProject] = await Project.where({id: project.id()}).withCount(["tasks"]).toArray()

    expect(loadedProject.readAttribute("tasksCount")).toEqual(1)
  })

  it("scopes polymorphic hasMany counts by the type column", async () => {
    const project = await Project.create({nameEn: "Poly project", nameDe: "Poly Projekt"})
    const task = await Task.create({name: "Poly task", project})

    await Interaction.create({subjectType: "Project", subjectId: project.id(), kind:"Project interaction"})
    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind:"Task interaction 1"})
    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind:"Task interaction 2"})

    const [loadedProject] = await Project.where({id: project.id()}).withCount("interactions").toArray()
    const [loadedTask] = await Task.where({id: task.id()}).withCount("interactions").toArray()

    expect(loadedProject.readAttribute("interactionsCount")).toEqual(1)
    expect(loadedTask.readAttribute("interactionsCount")).toEqual(2)
  })

  it(".count() on the parent query ignores withCount", async () => {
    const project = await Project.create({nameEn: "One", nameDe: "Eins"})

    await Task.create({name: "T1", project})
    await Task.create({name: "T2", project})

    const parentCount = await Project.where({id: project.id()}).withCount("tasks").count()

    expect(parentCount).toEqual(1)
  })

  it("works alongside pagination", async () => {
    const projectA = await Project.create({nameEn: "A", nameDe: "A"})
    const projectB = await Project.create({nameEn: "B", nameDe: "B"})

    await Task.create({name: "A-T0", project: projectA})
    await Task.create({name: "B-T0", project: projectB})
    await Task.create({name: "B-T1", project: projectB})

    const firstPage = await Project.where({id: [projectA.id(), projectB.id()]})
      .order("projects.id ASC")
      .page(1)
      .perPage(1)
      .withCount("tasks")
      .toArray()
    const secondPage = await Project.where({id: [projectA.id(), projectB.id()]})
      .order("projects.id ASC")
      .page(2)
      .perPage(1)
      .withCount("tasks")
      .toArray()

    expect(firstPage.length).toEqual(1)
    expect(secondPage.length).toEqual(1)
    expect(firstPage[0].id()).toEqual(projectA.id())
    expect(firstPage[0].readAttribute("tasksCount")).toEqual(1)
    expect(secondPage[0].id()).toEqual(projectB.id())
    expect(secondPage[0].readAttribute("tasksCount")).toEqual(2)
  })
})
