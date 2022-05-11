import Dummy from "../../dummy/index.mjs"
import Task from "../../dummy/src/models/task.mjs"

describe("Record - create", () => {
  it("creates a new simple record", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})

      await task.save()

      expect(task.id()).not.toBeUndefined()
    })
  })
})
