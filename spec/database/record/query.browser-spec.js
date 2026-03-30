import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - query", {tags: ["dummy"]}, () => {
  it("queries for records", async () => {
    const task = new Task({name: "Test task"})
    const project = task.buildProject({nameEn: "Test project", nameDe: "Test projekt"})

    project.buildProjectDetail({note: "Test note"})

    await task.save()

    expect(task.id()).not.toBeUndefined()
    expect(task.name()).toEqual("Test task")
    expect(task.project().id()).toEqual(project.id())
    expect(task.project()).toEqual(project)

    expect(project.id()).not.toBeUndefined()
    expect(project.name()).toEqual("Test project")
    expect(project.nameDe()).toEqual("Test projekt")
    expect(project.nameEn()).toEqual("Test project")

    const tasks = await Task.preload({project: {projectDetail: true, translations: true}}).toArray()
    const newTask = tasks[0]
    const newProject = newTask.project()
    const newProjectDetail = newProject.projectDetail()

    expect(newTask.id()).not.toBeUndefined()
    expect(newTask.name()).toEqual("Test task")
    expect(task.project().id()).toEqual(newProject.id())
    expect(newTask.project()).toEqual(newProject)

    expect(newProject.id()).not.toBeUndefined()
    expect(newProject.name()).toEqual("Test project")
    expect(newProject.nameDe()).toEqual("Test projekt")
    expect(newProject.nameEn()).toEqual("Test project")

    expect(newProjectDetail.note()).toEqual("Test note")
  })

  it("preloads nested relationships with shorthand syntax", async () => {
    const task = new Task({name: "Shorthand task"})
    const project = task.buildProject({nameEn: "Shorthand project", nameDe: "Kurzprojekt"})

    project.buildProjectDetail({note: "Shorthand note"})

    await task.save()

    const withString = await Task.preload({project: "translations"}).find(task.id())
    const stringProject = withString.project()

    expect(stringProject.getRelationshipByName("translations").getPreloaded()).toBeTrue()

    const withArray = await Task.preload({project: ["translations", "projectDetail"]}).find(task.id())
    const arrayProject = withArray.project()

    expect(arrayProject.getRelationshipByName("translations").getPreloaded()).toBeTrue()
    expect(arrayProject.getRelationshipByName("projectDetail").getPreloaded()).toBeTrue()
    expect(arrayProject.projectDetail().note()).toEqual("Shorthand note")
  })

  it("reuses preloaded relationships from relationship helpers before loading again", async () => {
    const project = await Project.create({name: "Helper project"})
    const task = await Task.create({name: "Helper task", project})
    const preloadedTask = /** @type {Task} */ (await Task.preload({project: true}).find(task.id()))

    const loadedProject = await preloadedTask.projectOrLoad()
    const loadedTasks = await loadedProject.tasks().toArray()
    const cachedTasks = await loadedProject.tasks().toArray()
    const reloadedTasks = await loadedProject.tasks().load()

    expect(loadedProject.id()).toEqual(project.id())
    expect(loadedTasks.map((loadedTask) => loadedTask.id())).toEqual([task.id()])
    expect(cachedTasks.map((loadedTask) => loadedTask.id())).toEqual([task.id()])
    expect(reloadedTasks.map((loadedTask) => loadedTask.id())).toEqual([task.id()])
  })

  it("reuses in-memory belongs-to relationships before loading again", async () => {
    const task = new Task({name: "Unsaved task"})
    const project = task.buildProject({name: "Unsaved project"})

    const loadedProject = await task.projectOrLoad()

    expect(loadedProject).toEqual(project)
    expect(loadedProject.name()).toEqual("Unsaved project")
  })

  it("reuses in-memory has-many relationships before querying again", async () => {
    const project = new Project({name: "Unsaved project"})
    const builtTask = project.tasks().build({name: "Built task"})
    const loadedTasks = await project.tasks().toArray()

    expect(loadedTasks).toEqual([builtTask])
    expect(loadedTasks[0].name()).toEqual("Built task")
  })

  it("finds the first record", async () => {
    const taskIDs = []
    const project = await Project.create()

    for (let i = 0; i < 5; i++) {
      const task = await Task.create({name: `Task ${i}`, project})

      taskIDs.push(task.id())
    }

    const lastTask = await Task.first()

    expect(lastTask.id()).toEqual(taskIDs[0])
  })

  it("finds the last record", async () => {
    const taskIDs = []
    const project = await Project.create()

    for (let i = 0; i < 5; i++) {
      const task = await Task.create({name: `Task ${i}`, project})

      taskIDs.push(task.id())
    }

    const lastTask = await Task.last()

    expect(lastTask.id()).toEqual(taskIDs[4])
  })

  it("finds the record with joins and where hashes", async () => {
    const project1 = await Project.create({name: "Test project 1"})
    const project2 = await Project.create({name: "Test project 2"})

    for (let i = 0; i < 5; i++) {
      await Task.create({name: `Task 1-${i}`, project: project1})
      await Task.create({name: `Task 2-${i}`, project: project2})
    }

    const tasks = await Task
      .joins({project: {translations: true}})
      .where({tasks: {name: "Task 2-2"}, project_translations: {name: "Test project 2"}})
      .preload({project: {translations: true}})
      .toArray()

    const task = tasks[0]

    expect(tasks.length).toEqual(1)
    expect(task.name()).toEqual("Task 2-2")
    expect(task.project().name()).toEqual("Test project 2")
  })

  it("joins with shorthand syntax", async () => {
    const project1 = await Project.create({name: "Join Project 1"})
    const project2 = await Project.create({name: "Join Project 2"})

    for (let i = 0; i < 3; i++) {
      await Task.create({name: `Join Task 1-${i}`, project: project1})
      await Task.create({name: `Join Task 2-${i}`, project: project2})
    }

    const tasks = await Task
      .joins({project: "translations"})
      .where({tasks: {name: "Join Task 2-1"}, project_translations: {name: "Join Project 2"}})
      .preload({project: ["translations"]})
      .toArray()

    expect(tasks.length).toEqual(1)
    expect(tasks[0].project().name()).toEqual("Join Project 2")
  })

  it("treats select arrays as root-model attributes with joins", async () => {
    const project1 = await Project.create({name: "Select Project 1"})
    const project2 = await Project.create({name: "Select Project 2"})
    const task1 = await Task.create({name: "Select Task 1", project: project1})

    await Task.create({name: "Select Task 2", project: project2})

    const tasks = await Task
      .joins({project: true})
      .where({tasks: {id: task1.id()}})
      .select(["id", "createdAt"])
      .toArray()

    expect(tasks.length).toEqual(1)
    expect(tasks[0].id()).toEqual(task1.id())
    expect(tasks[0].createdAt()).not.toBeUndefined()
  })

  it("qualifies shorthand select columns with the latest root from reference", () => {
    const query = Task
      .all()
      .from("tasks AS tasks_alias")
      .select("id")
    const sql = query.toSql()

    expect(sql).toContain(`${query.driver.quoteTable("tasks_alias")}.${query.driver.quoteColumn("id")}`)
  })

  it("counts the records", async () => {
    const taskIDs = []
    const project = await Project.create()

    for (let i = 0; i < 5; i++) {
      const task = await Task.create({name: `Task ${i}`, project})

      taskIDs.push(task.id())
    }

    const tasksCount = await Task.count()

    expect(tasksCount).toEqual(5)
  })

  it("supports explicit load() on record model classes", async () => {
    const project = await Project.create()

    await Task.create({name: "Loaded task", project})

    const tasks = await Task.load()

    expect(tasks.map((task) => task.name())).toContain("Loaded task")
  })
})
