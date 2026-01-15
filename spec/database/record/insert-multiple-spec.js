// @ts-check

import Project from "../../dummy/src/models/project.js"
import Record from "../../../src/database/record/index.js"
import Task from "../../dummy/src/models/task.js"
import User from "../../dummy/src/models/user.js"

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
    }).toThrow(/insertMultiple row length mismatch\. Expected 2 values but got 3\. Row: \["?\d+"?,"InsertMultiple mismatch","extra"\]/)
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

  it("retries inserts individually and returns results when requested", async () => {
    const createdAtIso = "2025-12-26T16:18:50.641Z"
    const rows = [
      ["retry-user@example.com", "secret", createdAtIso, createdAtIso],
      ["retry-user@example.com", "secret", createdAtIso, createdAtIso]
    ]

    const results = await User.insertMultiple(
      ["email", "encrypted_password", "created_at", "updated_at"],
      rows,
      {retryIndividuallyOnFailure: true, returnResults: true}
    )

    expect(results.succeededRows.length).toBe(1)
    expect(results.failedRows.length).toBe(1)
    expect(results.errors.length).toBe(1)
    expect(results.errors[0].error).toBeInstanceOf(Error)

    const user = await User.findBy({email: "retry-user@example.com"})
    expect(user).toBeTruthy()
  })

  it("retries inserts individually and throws combined errors by default", async () => {
    const createdAtIso = "2025-12-26T16:18:50.641Z"
    const rows = [
      ["retry-user-2@example.com", "secret", createdAtIso, createdAtIso],
      ["retry-user-2@example.com", "secret", createdAtIso, createdAtIso]
    ]

    let error

    try {
      await User.insertMultiple(
        ["email", "encrypted_password", "created_at", "updated_at"],
        rows,
        {retryIndividuallyOnFailure: true}
      )
    } catch (caughtError) {
      error = caughtError
    }

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/insertMultiple failed for 1 rows\./)
    expect(error.message).toMatch(/retry-user-2@example.com/)

    const user = await User.findBy({email: "retry-user-2@example.com"})
    expect(user).toBeTruthy()
  })
})
