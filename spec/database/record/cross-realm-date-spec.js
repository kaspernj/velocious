import {describe, expect, it} from "../../../src/testing/test.js"
import Task from "../../dummy/src/models/task.js"
import vm from "node:vm"

describe("Record - cross-realm dates", {tags: ["dummy"]}, () => {
  it("serializes a date created in another realm into SQL values", async () => {
    // A Date from another realm (e.g. the velocious console REPL) fails `instanceof Date` and used
    // to bypass date conversion, serializing as an empty SQL value.
    const crossRealmDate = vm.runInNewContext("new Date('2026-01-02T03:04:05.000Z')")

    expect(crossRealmDate instanceof Date).toEqual(false)

    await Task.count() // trigger initialization

    const sql = Task.where({createdAt: crossRealmDate}).toSql()

    expect(sql).toContain("2026-01-02")
  })
})
