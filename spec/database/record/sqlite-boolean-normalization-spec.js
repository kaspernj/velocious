import {describe, expect, it} from "../../../src/testing/test.js"
import Record from "../../../src/database/record/index.js"

class SqliteBooleanRecord extends Record {}
class MysqlBooleanRecord extends Record {}

SqliteBooleanRecord._initialized = true
SqliteBooleanRecord._attributeNameToColumnName = {flag: "flag"}
SqliteBooleanRecord._columnTypeByName = {flag: "boolean"}
SqliteBooleanRecord._columns = [{getName: () => "flag", getType: () => "boolean"}]
SqliteBooleanRecord._databaseType = "sqlite"
MysqlBooleanRecord._initialized = true
MysqlBooleanRecord._attributeNameToColumnName = {flag: "flag"}
MysqlBooleanRecord._columnTypeByName = {flag: "boolean"}
MysqlBooleanRecord._columns = [{getName: () => "flag", getType: () => "boolean"}]
MysqlBooleanRecord._databaseType = "mysql"

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

  it("reads 1/0 back as booleans for mysql boolean columns", () => {
    const trueRecord = new MysqlBooleanRecord()
    const falseRecord = new MysqlBooleanRecord()

    trueRecord._attributes.flag = 1
    falseRecord._attributes.flag = 0

    expect(trueRecord.readAttribute("flag")).toEqual(true)
    expect(falseRecord.readAttribute("flag")).toEqual(false)
  })
})
