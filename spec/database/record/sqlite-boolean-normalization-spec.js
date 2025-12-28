import {describe, expect, it} from "../../../src/testing/test.js"
import Record from "../../../src/database/record/index.js"

class SqliteBooleanRecord extends Record {}

SqliteBooleanRecord._initialized = true
SqliteBooleanRecord._attributeNameToColumnName = {flag: "flag"}
SqliteBooleanRecord._columnTypeByName = {flag: "boolean"}
SqliteBooleanRecord._databaseType = "sqlite"

describe("Record - sqlite boolean normalization", () => {
  it("stores booleans as 1/0 for sqlite", () => {
    const record = new SqliteBooleanRecord()

    record._setColumnAttribute("flag", true)
    expect(record._changes.flag).toEqual(1)

    record._setColumnAttribute("flag", false)
    expect(record._changes.flag).toEqual(0)
  })
})
