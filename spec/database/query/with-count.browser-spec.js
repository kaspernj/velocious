import Configuration from "../../../src/configuration.js"
import Interaction from "../../dummy/src/models/interaction.js"
import Project from "../../dummy/src/models/project.js"
import ProjectDetail from "../../dummy/src/models/project-detail.js"
import RequestTiming from "../../../src/http-server/client/request-timing.js"
import Task from "../../dummy/src/models/task.js"

describe("Database - query - withCount", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("attaches counts for a basic hasMany", async () => {
    const project = await Project.create({nameEn: "P", nameDe: "P"})

    await Task.create({name: "T1", project})
    await Task.create({name: "T2", project})

    const [loaded] = await Project.where({id: project.id()}).withCount("tasks").toArray()

    expect(loaded.readCount("tasksCount")).toEqual(2)
  })

  it("attaches zero for parents with no children", async () => {
    const empty = await Project.create({nameEn: "Empty", nameDe: "Leer"})

    const [loaded] = await Project.where({id: empty.id()}).withCount("tasks").toArray()

    expect(loaded.readCount("tasksCount")).toEqual(0)
  })

  it("does not shadow a real column that shares the count's name", async () => {
    const project = await Project.create({nameEn: "Shadow", nameDe: "Schatten"})

    await Task.create({name: "T", project})

    const [loaded] = await Project.where({id: project.id()}).withCount("tasks").toArray()

    // Project declares a real `tasksCount` counter_cache column. The
    // counter cache must still be visible via `readAttribute`; the
    // `.withCount(...)` result is kept separately under `readCount`.
    expect(loaded.readAttribute("tasksCount")).toEqual(1)
    expect(loaded.readCount("tasksCount")).toEqual(1)
  })

  it("filters the counted association via where", async () => {
    const project = await Project.create({nameEn: "Filtered", nameDe: "Gefiltert"})

    await Task.create({name: "Done task", project, isDone: true})
    await Task.create({name: "Open task", project, isDone: false})

    const [loaded] = await Project.where({id: project.id()}).withCount({
      doneTasksCount: {relationship: "tasks", where: {isDone: true}}
    }).toArray()

    expect(loaded.readCount("doneTasksCount")).toEqual(1)
  })

  it("uses one aggregate roundtrip for compatible aliases", async () => {
    const project = await Project.create({nameEn: "Compatible", nameDe: "Kompatibel"})

    await Task.create({name: "Done", project, isDone: true})
    await Task.create({name: "Open", project, isDone: false})

    const requestTiming = new RequestTiming()
    const [loaded] = await Configuration.current().getEnvironmentHandler().runWithRequestTiming(requestTiming, async () => {
      return await Project.where({id: project.id()}).withCount({
        completedTasksCount: {relationship: "tasks", where: {isDone: true}},
        doneTasksCount: {relationship: "tasks", where: {isDone: true}}
      }).toArray()
    })

    expect(loaded.readCount("completedTasksCount")).toEqual(1)
    expect(loaded.readCount("doneTasksCount")).toEqual(1)
    expect(requestTiming.dbQueryCount).toEqual(2)
  })

  it("keeps incompatible predicates separate", async () => {
    const project = await Project.create({nameEn: "Predicates", nameDe: "Prädikate"})
    const requestTiming = new RequestTiming()

    await Task.create({name: "Done", project, isDone: true})
    await Task.create({name: "Open", project, isDone: false})

    const [loaded] = await Configuration.current().getEnvironmentHandler().runWithRequestTiming(requestTiming, async () => {
      return await Project.where({id: project.id()}).withCount({
        doneTasksCount: {relationship: "tasks", where: {isDone: true}},
        openTasksCount: {relationship: "tasks", where: {isDone: false}}
      }).toArray()
    })

    expect(loaded.readCount("doneTasksCount")).toEqual(1)
    expect(loaded.readCount("openTasksCount")).toEqual(1)
    expect(requestTiming.dbQueryCount).toEqual(3)
  })

  it("applies relationship scopes before batching aliases", async () => {
    const project = await Project.create({nameEn: "Scopes", nameDe: "Bereiche"})
    const requestTiming = new RequestTiming()

    await Task.create({name: "Done", project, isDone: true})
    await Task.create({name: "Open", project, isDone: false})

    const [loaded] = await Configuration.current().getEnvironmentHandler().runWithRequestTiming(requestTiming, async () => {
      return await Project.where({id: project.id()}).withCount({
        completedTasksCount: {relationship: "doneTasks"},
        doneTasksCount: {relationship: "doneTasks"}
      }).toArray()
    })

    expect(loaded.readCount("completedTasksCount")).toEqual(1)
    expect(loaded.readCount("doneTasksCount")).toEqual(1)
    expect(requestTiming.dbQueryCount).toEqual(2)
  })

  it("qualifies the foreign key when a relationship scope joins a table with the same column", async () => {
    const project = await Project.create({nameEn: "Joined scope", nameDe: "Verknüpfter Bereich"})

    await ProjectDetail.create({project, note: "Scope join"})
    await Task.create({name: "Scoped task", project})

    const [loaded] = await Project.where({id: project.id()}).withCount("tasksWithProjectDetails").toArray()

    expect(loaded.readCount("tasksWithProjectDetailsCount")).toEqual(1)
  })

  it("batches on the transaction's existing connection", async () => {
    const project = await Project.create({nameEn: "Transaction", nameDe: "Transaktion"})
    const requestTiming = new RequestTiming()

    await Task.create({name: "Task", project})

    await Project.connection().transaction(async () => {
      const [loaded] = await Configuration.current().getEnvironmentHandler().runWithRequestTiming(requestTiming, async () => {
        return await Project.where({id: project.id()}).withCount({
          firstTasksCount: {relationship: "tasks"},
          secondTasksCount: {relationship: "tasks"}
        }).toArray()
      })

      expect(Project.connection().insideTransaction()).toEqual(true)
      expect(loaded.readCount("firstTasksCount")).toEqual(1)
      expect(loaded.readCount("secondTasksCount")).toEqual(1)
    })

    expect(requestTiming.dbQueryCount).toEqual(2)
  })

  it("accepts an array of names as shorthand", async () => {
    const project = await Project.create({nameEn: "Array", nameDe: "Array"})
    const task = await Task.create({name: "T", project})

    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind: "A"})
    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind: "B"})

    const [loadedTask] = await Task.where({id: task.id()}).withCount(["interactions"]).toArray()

    expect(loadedTask.readCount("interactionsCount")).toEqual(2)

    const [loadedProject] = await Project.where({id: project.id()}).withCount(["tasks"]).toArray()

    expect(loadedProject.readCount("tasksCount")).toEqual(1)
  })

  it("scopes polymorphic hasMany counts by the type column", async () => {
    const project = await Project.create({nameEn: "Poly project", nameDe: "Poly Projekt"})
    const task = await Task.create({name: "Poly task", project})

    await Interaction.create({subjectType: "Project", subjectId: project.id(), kind: "Project interaction"})
    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind: "Task interaction 1"})
    await Interaction.create({subjectType: "Task", subjectId: task.id(), kind: "Task interaction 2"})

    const [loadedProject] = await Project.where({id: project.id()}).withCount("interactions").toArray()
    const [loadedTask] = await Task.where({id: task.id()}).withCount("interactions").toArray()

    expect(loadedProject.readCount("interactionsCount")).toEqual(1)
    expect(loadedTask.readCount("interactionsCount")).toEqual(2)
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
    expect(firstPage[0].readCount("tasksCount")).toEqual(1)
    expect(secondPage[0].id()).toEqual(projectB.id())
    expect(secondPage[0].readCount("tasksCount")).toEqual(2)
  })
})
