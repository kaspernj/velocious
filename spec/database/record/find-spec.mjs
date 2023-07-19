import Dummy from "../../dummy/index.mjs"
import Task from "../../dummy/src/models/task.mjs"

describe("Record - find", () => {
  it("finds an existing record", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})

      await task.save()

      const foundTask = await Task.find(task.id())

      expect(foundTask.readAttribute("name")).toEqual("Test task")
    })
  })
})
