import Dummy from "../../../dummy/index.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - instance relationships - has many relationship", () => {
  it("loads a relationship", async () => {
    await Dummy.run(async () => {
      const project = await Project.create()
      const task = await Task.create({name: "Test task", project})
      const foundProject = await Project.find(project.id())
      const tasksInstanceRelationship = foundProject.getRelationshipByName("tasks")

      expect(tasksInstanceRelationship.isLoaded()).toBeFalse()

      await foundProject.loadTasks()

      expect(tasksInstanceRelationship.isLoaded()).toBeTrue()

      const taskIDs = foundProject.tasks().loaded().map((task) => task.id())

      expect(taskIDs).toEqual([task.id()])
    })
  })
})
