// @ts-check

import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - insertMultiple", {tags: ["dummy"]}, () => {
  it("casts insertMultiple values based on column types", async () => {
    const project = await Project.create({name: "InsertMultiple project"})
    const createdAtIso = "2025-12-26T16:18:50.641Z"

    await Task.insertMultiple(
      ["project_id", "name", "created_at", "updated_at"],
      [[String(project.id()), "InsertMultiple task", createdAtIso, ""]],
      {cast: true}
    )

    const task = await Task.findBy({name: "InsertMultiple task"})

    expect(task?.projectId()).toEqual(project.id())
    expect(typeof task?.projectId()).toEqual("number")
    expect(task?.createdAt()).toBeInstanceOf(Date)
    expect(task?.updatedAt()).toBeNull()
  })
})
