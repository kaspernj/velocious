import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - instance relationships - has many relationship", {tags: ["dummy"]}, () => {
  it("loads a relationship", async () => {
    const project = /** @type {Project} */ (await Project.create())
    const task = await Task.create({name: "Test task", project})
    const foundProject = /** @type {Project} */ (await Project.find(project.id()))
    const tasksInstanceRelationship = foundProject.getRelationshipByName("tasks")

    expect(tasksInstanceRelationship.isLoaded()).toBeFalse()

    await foundProject.loadTasks()

    expect(tasksInstanceRelationship.isLoaded()).toBeTrue()

    const taskIDs = foundProject.tasksLoaded().map((task) => task.id())

    expect(taskIDs).toEqual([task.id()])
  })
})
