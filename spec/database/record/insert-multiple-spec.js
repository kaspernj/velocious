// @ts-check

import Project from "../../dummy/src/models/project.js"
import Record from "../../../src/database/record/index.js"
import Task from "../../dummy/src/models/task.js"
import User from "../../dummy/src/models/user.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("Record - insertMultiple", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  it("inserts large batches in bounded chunks while preserving order and transaction semantics", async () => {
    const project = await Project.create({name: "InsertMultiple chunk project"})
    const createdAtIso = "2025-12-26T16:18:50.641Z"
    const rows = []

    for (let index = 0; index < 2000; index++) {
      rows.push([String(project.id()), `chunk-task-${String(index).padStart(4, "0")}`, createdAtIso, createdAtIso])
    }

    await Task.insertMultiple(
      ["project_id", "name", "created_at", "updated_at"],
      rows,
      {cast: true}
    )

    const tasks = await Task.where({projectId: project.id()}).order("name").toArray()

    expect(tasks.length).toEqual(2000)
    expect(tasks[0].name()).toEqual("chunk-task-0000")
    expect(tasks[1999].name()).toEqual("chunk-task-1999")
  })

  it("rolls back every chunk when the caller is inside a transaction and one chunk fails", async () => {
    const project = await Project.create({name: "InsertMultiple rollback project"})
    const createdAtIso = "2025-12-26T16:18:50.641Z"
    const rows = []

    for (let index = 0; index < 2000; index++) {
      rows.push([String(project.id()), `rollback-task-${String(index).padStart(4, "0")}`, createdAtIso, createdAtIso])
    }

    // Force a failure on the second chunk by making a value violate the
    // project_id NOT NULL constraint. SQLite checks this on every row insert,
    // so the second chunk fails; before the fix only the failing chunk would
    // roll back and leave part of the batch committed.
    rows[1500][0] = null

    let error

    try {
      await Task.transaction(async () => {
        await Task.insertMultiple(
          ["project_id", "name", "created_at", "updated_at"],
          rows,
          {cast: true}
        )
      })
    } catch (caughtError) {
      error = caughtError
    }

    expect(error).toBeInstanceOf(Error)

    const tasks = await Task.where({projectId: project.id()}).toArray()

    expect(tasks.length).toEqual(0)
  })

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
    NumericInsertRecord._columnsAsHash = /** @type {any} */ ({
      amount: {getType: () => "decimal", getNull: () => true},
      bigCount: {getType: () => "bigint", getNull: () => true}
    })

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

    if (!results) throw new Error("Expected insertMultiple to return results when returnResults is set")

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

    /** @type {any} */
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

  it("serializes failed rows safely for errors", () => {
    class SafeSerializeRecord extends Record {}

    const rowWithBigInt = [1n, "value"]
    const serializedBigInt = SafeSerializeRecord._safeSerializeInsertRow(rowWithBigInt)

    expect(serializedBigInt).toMatch(/1/)

    /** @type {any[]} */
    const circularRow = []
    circularRow.push(circularRow)

    const serializedCircular = SafeSerializeRecord._safeSerializeInsertRow(circularRow)

    expect(serializedCircular).toMatch(/\[Circular\]/)
  })
})
