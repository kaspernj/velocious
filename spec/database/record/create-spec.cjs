const Task = require("../../dummy/src/models/task.cjs")

describe("Record - create", () => {
  it("creates a new simple record", async () => {
    const task = new Task({name: "Test task"})

    await task.save()

    expect(task.id()).notToEq(nil)
  })
})
