import Dummy from "../../../dummy/index.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - instance relationships - belongs to relationship", () => {
  it("loads a relationship", async () => {
    await Dummy.run(async () => {
      const project = await Project.create()
      const task = await Task.create({name: "Test task", project})
      const foundTask = await Task.find(task.id())
      const projectInstanceRelationship = foundTask.getRelationshipByName("project")

      expect(projectInstanceRelationship.isLoaded()).toBeFalse()

      await foundTask.loadProject()

      expect(projectInstanceRelationship.isLoaded()).toBeTrue()
      expect(foundTask.project().id()).toEqual(project.id())
    })
  })
})
