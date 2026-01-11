import Task from "../../dummy/src/models/task.js"

describe("Record - find or create", {tags: ["dummy"]}, () => {
  it("doesnt find but then creates a record", async () => {
    const task = /** @type {Task} */ (await Task.findOrCreateBy({name: "Test task"}, (newTask) => {
      const project = newTask.buildProject({nameEn: "Test project", nameDe: "Test projekt"})

      project.buildProjectDetail({note: "Test note"})
    }))

    const project = task.project()

    expect(task.isPersisted()).toBeTrue()
    expect(task.isNewRecord()).toBeFalse()
    expect(task.id()).not.toBeUndefined()
    expect(task.name()).toEqual("Test task")
    expect(task.project().id()).toEqual(project.id())
    expect(task.project()).toEqual(project)

    expect(project.id()).not.toBeUndefined()
    expect(project.name()).toEqual("Test project")
    expect(project.nameDe()).toEqual("Test projekt")
    expect(project.nameEn()).toEqual("Test project")
    expect(project.createdAt()).toBeInstanceOf(Date)
    expect(project.updatedAt()).toBeInstanceOf(Date)

    // 'name' is not a column but rather a column on the translation data model.
    expect(() => project.readColumn("name")).toThrowError("No such attribute or not selected Project#name")


    // It saves a project note through a has one relationship
    const projectDetail = project.projectDetail()

    expect(projectDetail.isNewRecord()).toBeFalse()
    expect(projectDetail.isPersisted()).toBeTrue()
    expect(projectDetail.note()).toEqual("Test note")
    expect(projectDetail.projectId()).toEqual(project.id())


    // It automatically sets the relationship that saved it on a has-one-relationship
    const projectInstanceRelationship = projectDetail.getRelationshipByName("project")

    expect(projectInstanceRelationship.getPreloaded()).toBeTrue()
    expect(projectDetail.project().id()).toEqual(project.id())


    // It automatically sets the relationship that saved it on a has-many-relationship
    const tasksRelationship = project.getRelationshipByName("tasks")

    expect(tasksRelationship.getPreloaded()).toBeTrue()

    const projectTasksIDs = project.tasksLoaded().map((task) => task.id())

    expect(projectTasksIDs).toEqual([task.id()])
  })
})
