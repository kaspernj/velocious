import {describe, expect, it} from "../../../src/testing/test.js"
import Record from "../../../src/database/record/index.js"

class SqliteBooleanRecord extends Record {}

SqliteBooleanRecord._initialized = true
SqliteBooleanRecord._attributeNameToColumnName = {flag: "flag"}
SqliteBooleanRecord._columnTypeByName = {flag: "boolean"}
SqliteBooleanRecord._columns = [{getName: () => "flag", getType: () => "boolean"}]
SqliteBooleanRecord._databaseType = "sqlite"

describe("Record - sqlite boolean normalization", () => {
  it("stores booleans as 1/0 for sqlite", () => {
    const record = new SqliteBooleanRecord()

    record._setColumnAttribute("flag", true)
    expect(record._changes.flag).toEqual(1)

    record._setColumnAttribute("flag", false)
    expect(record._changes.flag).toEqual(0)
  })

  it("reads 1/0 back as booleans for sqlite boolean columns", () => {
    const trueRecord = new SqliteBooleanRecord()
    const falseRecord = new SqliteBooleanRecord()

    trueRecord._attributes.flag = 1
    falseRecord._attributes.flag = 0

    expect(trueRecord.readAttribute("flag")).toEqual(true)
    expect(falseRecord.readAttribute("flag")).toEqual(false)
  })
})
