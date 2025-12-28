import Dummy from "../../dummy/index.js"
import Project from "../../dummy/src/models/project.js"
import ProjectDetail from "../../dummy/src/models/project-detail.js"
import Task from "../../dummy/src/models/task.js"

describe("Database - query - model class query", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("counts distinct records", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({nameEn: "Project name", nameDe: "Projektname"})
      await Task.create({name: "Task 1", project})

      const rawCount = await Task.joins({project: {translations: true}}).count()
      const distinctCount = await Task.joins({project: {translations: true}}).distinct().count()

      expect(rawCount).toEqual(2)
      expect(distinctCount).toEqual(1)
    })
  })

  it("counts distinct records across groups without collapsing counts", async () => {
    await Dummy.run(async () => {
      const project1 = await Project.create({nameEn: "Alpha", nameDe: "Alfa"})
      const project2 = await Project.create({nameEn: "Beta", nameDe: "Beta"})

      await Task.create({name: "Task 1", project: project1})
      await Task.create({name: "Task 2", project: project1})
      await Task.create({name: "Task 3", project: project2})
      await Task.create({name: "Task 4", project: project2})

      const count = await Task.group("tasks.project_id").distinct().count()

      expect(count).toEqual(4)
    })
  })

  it("findOrInitializeBy marks new records as new and changed", async () => {
    await Dummy.run(async () => {
      const record = await Task.where({name: "New Task"}).findOrInitializeBy({name: "New Task"})

      expect(record.isNewRecord()).toEqual(true)
      expect(record.isChanged()).toEqual(true)
    })
  })

  it("filters on boolean values using camelized attribute names", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({nameEn: "Boolean Tasks", nameDe: "Boolesche Aufgaben"})

      await Task.create({name: "Task True 1", project, isDone: true})
      await Task.create({name: "Task True 2", project, isDone: true})
      await Task.create({name: "Task False 1", project, isDone: false})
      await Task.create({name: "Task False 2", project, isDone: false})

      const trueNames = (await Task.where({isDone: true}).toArray()).map((task) => task.name()).sort()
      const falseNames = (await Task.where({isDone: false}).toArray()).map((task) => task.name()).sort()

      expect(trueNames).toEqual(["Task True 1", "Task True 2"])
      expect(falseNames).toEqual(["Task False 1", "Task False 2"])
    })
  })

  it("filters on nested relationship attributes", async () => {
    await Dummy.run(async () => {
      const projectMatch = await Project.create({
        creatingUserReference: "creator-1",
        nameEn: "Match Project",
        nameDe: "Trefferprojekt"
      })
      const projectMiss = await Project.create({
        creatingUserReference: "creator-2",
        nameEn: "Miss Project",
        nameDe: "Fehlprojekt"
      })

      await Task.create({name: "Match Task", project: projectMatch})
      await Task.create({name: "Miss Task", project: projectMiss})

      const names = (await Task.where({project: {creatingUserReference: "creator-1"}}).toArray())
        .map((task) => task.name())
        .sort()

      expect(names).toEqual(["Match Task"])
    })
  })

  it("filters on deep nested relationship attributes", async () => {
    await Dummy.run(async () => {
      const projectMatch = await Project.create({
        creatingUserReference: "creator-3",
        nameEn: "Deep Match Project",
        nameDe: "Tiefes Trefferprojekt"
      })
      const projectMiss = await Project.create({
        creatingUserReference: "creator-4",
        nameEn: "Deep Miss Project",
        nameDe: "Tiefes Fehlprojekt"
      })

      await ProjectDetail.create({project: projectMatch, note: "Needs attention"})
      await ProjectDetail.create({project: projectMiss, note: "Other note"})

      await Task.create({name: "Deep Match Task", project: projectMatch})
      await Task.create({name: "Deep Miss Task", project: projectMiss})

      const names = (await Task.where({project: {projectDetail: {note: "Needs attention"}}}).toArray())
        .map((task) => task.name())
        .sort()

      expect(names).toEqual(["Deep Match Task"])
    })
  })

  it("filters on deep nested boolean attributes", async () => {
    await Dummy.run(async () => {
      const projectMatch = await Project.create({
        creatingUserReference: "creator-5",
        nameEn: "Deep Bool Match Project",
        nameDe: "Tiefes Boolesches Trefferprojekt"
      })
      const projectMiss = await Project.create({
        creatingUserReference: "creator-6",
        nameEn: "Deep Bool Miss Project",
        nameDe: "Tiefes Boolesches Fehlprojekt"
      })

      await ProjectDetail.create({project: projectMatch, isActive: true, note: "Active"})
      await ProjectDetail.create({project: projectMiss, isActive: false, note: "Inactive"})

      await Task.create({name: "Deep Bool Match Task", project: projectMatch})
      await Task.create({name: "Deep Bool Miss Task", project: projectMiss})

      const names = (await Task.where({project: {projectDetail: {isActive: true}}}).toArray())
        .map((task) => task.name())
        .sort()

      expect(names).toEqual(["Deep Bool Match Task"])
    })
  })

  it("forwards unknown keys to the base where hash", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({nameEn: "Fallback Project", nameDe: "Fallback Projekt"})
      await Task.create({name: "Fallback Task", project})

      const names = (await Task.where({project_id: project.id()}).toArray())
        .map((task) => task.name())
        .sort()

      expect(names).toEqual(["Fallback Task"])
    })
  })

  it("returns no results when where is given an empty array", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({nameEn: "Empty Where", nameDe: "Leere Abfrage"})
      await Task.create({name: "Task 1", project})

      const results = await Task.where({id: []}).toArray()

      expect(results).toEqual([])
    })
  })
})
