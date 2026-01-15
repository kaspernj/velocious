// @ts-check

import Project from "../../dummy/src/models/project.js"
import Record from "../../../src/database/record/index.js"
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

    expect(String(task?.projectId())).toEqual(String(project.id()))
    expect(task?.createdAt()).toBeInstanceOf(Date)
    expect(task?.updatedAt()).toBeNull()
  })

  it("raises when row lengths don't match columns", async () => {
    const project = await Project.create({name: "InsertMultiple mismatch"})

    await expect(async () => {
      await Task.insertMultiple(
        ["project_id", "name"],
        [[project.id(), "InsertMultiple mismatch", "extra"]]
      )
    }).toThrow(/insertMultiple row length mismatch\. Expected 2 values but got 3\. Row: \[\d+,"InsertMultiple mismatch","extra"\]/)
  })

  it("preserves numeric strings for precision-sensitive types", () => {
    class NumericInsertRecord extends Record {}

    NumericInsertRecord._initialized = true
    NumericInsertRecord._databaseType = "mysql"
    NumericInsertRecord._columnsAsHash = {
      amount: {getType: () => "decimal", getNull: () => true},
      bigCount: {getType: () => "bigint", getNull: () => true}
    }

    const normalized = NumericInsertRecord._normalizeInsertMultipleRows({
      columns: ["amount", "bigCount"],
      rows: [["1234567890.123456789", "9007199254740993"]]
    })

    expect(normalized[0][0]).toEqual("1234567890.123456789")
    expect(normalized[0][1]).toEqual("9007199254740993")
  })
})
