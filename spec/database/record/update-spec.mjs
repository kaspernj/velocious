import Dummy from "../../dummy/index.mjs"
import Task from "../../dummy/src/models/task.mjs"

describe("Record - create", () => {
  it("updates a record", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})

      await task.save()
      await task.update({name: "Updated name"})

      expect(task.readAttribute("name")).toEqual("Updated name")
    })
  })
})
