import Dummy from "../../dummy/index.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - destroy", () => {
  it("destroys a record", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})

      await task.save()
      await task.destroy()

      const foundTask = await Task.where({id: task.id()}).first()

      expect(foundTask).toEqual(undefined)
    })
  })
})
