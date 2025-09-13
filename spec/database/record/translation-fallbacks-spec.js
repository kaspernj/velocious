import Dummy from "../../dummy/index.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - translation fallbacks", () => {
  it("creates a new simple record with relationships and translations with fallbacks", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})
      const project = task.buildProject({nameDe: "Test projekt"})

      expect(project.name()).toEqual("Test projekt")
      expect(project.nameEn()).toEqual(undefined)
      expect(project.nameDe()).toEqual("Test projekt")

      await task.save()

      const sameTask = await Task.preload({project: {translations: true}}).find(task.id())
      const sameProject = sameTask.project()

      expect(sameProject.name()).toEqual("Test projekt")
      expect(sameProject.nameEn()).toEqual(undefined)
      expect(sameProject.nameDe()).toEqual("Test projekt")
    })
  })
})
