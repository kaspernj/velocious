import Dummy from "../../dummy/index.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - update", () => {
  it("updates a record", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})

      await task.save()
      await task.update({name: "Updated name"})

      expect(task.readAttribute("name")).toEqual("Updated name")
    })
  })
})
