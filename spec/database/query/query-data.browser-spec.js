import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

// Registrations are module-level side effects, the way dummy models
// declare their relationships. They persist across describe blocks but
// each attribute name lives under a distinct registration so suites
// don't collide.
Project.queryData("manualTasksCount", ({driver, query}) => {
  query.joins({tasks: true})
  const tasksTable = driver.quoteTable(query.tableNameFor("tasks"))
  query.select(`COUNT(${tasksTable}.${driver.quoteColumn("id")}) AS manualTasksCount`)
})

Project.queryData("projectStats", ({driver, query}) => {
  query.joins({tasks: true})
  const tasksTable = driver.quoteTable(query.tableNameFor("tasks"))
  const idCol = driver.quoteColumn("id")
  query.select(`COUNT(${tasksTable}.${idCol}) AS statTaskCount`)
  query.select(`MIN(${tasksTable}.${idCol}) AS statMinTaskId`)
})

// Registered on Task so nested-chain specs target it via
// `.queryData({tasks: ["taskAggregates"]})` on a Project query. The
// runner joins Project → tasks automatically; the fn aggregates on
// the tasks table itself using the provided `tableName`.
Task.queryData("taskAggregates", ({driver, query, tableName}) => {
  const tasksTable = driver.quoteTable(tableName)
  const idCol = driver.quoteColumn("id")
  query.select(`COUNT(${tasksTable}.${idCol}) AS taskAggregateCount`)
  query.select(`MAX(${tasksTable}.${idCol}) AS taskAggregateMaxId`)
})

Project.queryData("nullableSum", ({driver, query}) => {
  query.joins({tasks: true})
  const tasksTable = driver.quoteTable(query.tableNameFor("tasks"))
  query.select(`SUM(${tasksTable}.${driver.quoteColumn("id")}) AS nullableSum`)
})

describe("Database - query - queryData", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("attaches a single-column aggregate registered at the root", async () => {
    const project = await Project.create({nameEn: "P", nameDe: "P"})

    await Task.create({name: "T1", project})
    await Task.create({name: "T2", project})
    await Task.create({name: "T3", project})

    const [loaded] = await Project.where({id: project.id()})
      .queryData("manualTasksCount")
      .toArray()

    expect(Number(loaded.queryData("manualTasksCount"))).toEqual(3)
  })

  it("attaches multiple aliases from a single registered fn", async () => {
    const project = await Project.create({nameEn: "Stats", nameDe: "Stats"})
    const task1 = await Task.create({name: "T1", project})
    const task2 = await Task.create({name: "T2", project})

    const [loaded] = await Project.where({id: project.id()})
      .queryData(["projectStats"])
      .toArray()

    expect(Number(loaded.queryData("statTaskCount"))).toEqual(2)
    expect(Number(loaded.queryData("statMinTaskId"))).toEqual(Math.min(task1.id(), task2.id()))
  })

  it("runs nested-chain entries and attaches results to the root record", async () => {
    const project = await Project.create({nameEn: "Chain", nameDe: "Kette"})
    const task1 = await Task.create({name: "Nested task 1", project})
    const task2 = await Task.create({name: "Nested task 2", project})

    const [loaded] = await Project.where({id: project.id()})
      .queryData({tasks: ["taskAggregates"]})
      .toArray()

    expect(Number(loaded.queryData("taskAggregateCount"))).toEqual(2)
    expect(Number(loaded.queryData("taskAggregateMaxId"))).toEqual(Math.max(task1.id(), task2.id()))
  })

  it("yields null when an aggregate matches no rows", async () => {
    const empty = await Project.create({nameEn: "Empty", nameDe: "Leer"})

    const [loaded] = await Project.where({id: empty.id()})
      .queryData("nullableSum")
      .toArray()

    expect(loaded.queryData("nullableSum")).toEqual(null)
  })

  it("throws when a spec names an unregistered fn", async () => {
    const project = await Project.create({nameEn: "Missing", nameDe: "Missing"})

    let error = null

    try {
      await Project.where({id: project.id()}).queryData("nopeDoesNotExist").toArray()
    } catch (caught) {
      error = caught
    }

    expect(error).not.toEqual(null)
    expect(error.message).toMatch(/nopeDoesNotExist/)
  })

  it("throws for inherited Object.prototype names even though bracket lookup would return a member", async () => {
    // Guards against a plain-object registry where `map["toString"]`
    // would surface `Object.prototype.toString` and try to invoke it
    // as a queryData fn.
    const project = await Project.create({nameEn: "Proto", nameDe: "Proto"})

    let error = null

    try {
      await Project.where({id: project.id()}).queryData("toString").toArray()
    } catch (caught) {
      error = caught
    }

    expect(error).not.toEqual(null)
    expect(error.message).toMatch(/toString/)
  })

  it(".count() on the parent query ignores queryData", async () => {
    const project = await Project.create({nameEn: "Counted", nameDe: "Counted"})

    await Task.create({name: "T", project})

    const parentCount = await Project.where({id: project.id()})
      .queryData("manualTasksCount")
      .count()

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
      .queryData("manualTasksCount")
      .toArray()
    const secondPage = await Project.where({id: [projectA.id(), projectB.id()]})
      .order("projects.id ASC")
      .page(2)
      .perPage(1)
      .queryData("manualTasksCount")
      .toArray()

    expect(firstPage.length).toEqual(1)
    expect(secondPage.length).toEqual(1)
    expect(firstPage[0].id()).toEqual(projectA.id())
    expect(Number(firstPage[0].queryData("manualTasksCount"))).toEqual(1)
    expect(secondPage[0].id()).toEqual(projectB.id())
    expect(Number(secondPage[0].queryData("manualTasksCount"))).toEqual(2)
  })
})
