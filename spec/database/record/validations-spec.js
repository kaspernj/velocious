import Dummy from "../../dummy/index.js"
import Task from "../../dummy/src/models/task.js"
import {ValidationError} from "../../../src/database/record/index.js"
import Project from "../../dummy/src/models/project.js"

describe("Record - validations", () => {
  it("raises validations if trying to create an invalid record because of a presence validation", async () => {
    await Dummy.run(async () => {
      const project = await Project.create()
      const task = new Task({name: " ", project})

      await expect(async () => task.save()).toThrowError(new ValidationError("Name can't be blank"))
    })
  })

  it("raises validations if trying to create an invalid record with a blank value because of a presence validation", async () => {
    await Dummy.run(async () => {
      const project = await Project.create()
      const task = new Task({name: null, project})

      await expect(async () => task.save()).toThrowError(new ValidationError("Name can't be blank"))
    })
  })

  fit("raises validations if trying to create an invalid record because of a uniqueness validation", async () => {
    await Dummy.run(async () => {
      const project = await Project.create()
      await Task.create({name: "Task 1", project})

      const task2 = await Task.create({name: "Task 2", project})

      try {
        await task2.update({name: "Task 1"})

        throw new Error("Task 2 save didn't fail")
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect(error.message).toEqual("Name has already been taken")
      }
    })
  })
})
