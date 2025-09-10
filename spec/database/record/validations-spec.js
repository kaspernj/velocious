import Dummy from "../../dummy/index.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - validations", () => {
  it("raises validations if trying to create an invalid record because of a presence validation", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: " "})

      await expectAsync(task.save()).toBeRejectedWith(new Error("Validation failed: Name can't be blank"))
    })
  })

  it("raises validations if trying to create an invalid record because of a uniqueness validation", async () => {
    await Dummy.run(async () => {
      await Task.create({name: "Task 1"})

      const task2 = await Task.create({name: "Task 2"})

      try {
        await task2.update({name: "Task 1"})

        throw new Error("Task 2 save didn't fail")
      } catch (error) {
        expect(error.message).toEqual("Validation failed: Name has already been taken")
      }
    })
  })
})
