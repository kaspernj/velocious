import {describe, expect, it} from "../../../src/testing/test.js"
import Record from "../../../src/database/record/index.js"

class CastBitRecord extends Record {}

CastBitRecord._initialized = true
CastBitRecord._attributeNameToColumnName = {flag: "Flag", count: "Count"}
CastBitRecord._columnNameToAttributeName = {Flag: "flag", Count: "count"}
CastBitRecord._columnTypeByName = {Flag: "bit", Count: "int"}
CastBitRecord._columns = [
  {getName: () => "Flag", getType: () => "bit"},
  {getName: () => "Count", getType: () => "int"}
]
CastBitRecord._databaseType = "mssql"
CastBitRecord.attribute("flag", "boolean")

describe("Record - attribute cast", {databaseCleaning: {transaction: true}}, () => {
  it("exposes the declared cast as the effective column type", () => {
    expect(CastBitRecord.getAttributeCast("flag")).toEqual("boolean")
    expect(CastBitRecord.getColumnTypeByName("Flag")).toEqual("boolean")
    expect(CastBitRecord.getColumnTypeByName("Count")).toEqual("int")
  })

  it("keeps each subclass's cast map on its own class (not inherited)", () => {
    class ChildRecord extends CastBitRecord {}

    expect(ChildRecord.getAttributeCast("flag")).toEqual(undefined)
    expect(Object.prototype.hasOwnProperty.call(ChildRecord, "_attributeCasts")).toEqual(true)
    expect(Object.prototype.hasOwnProperty.call(CastBitRecord, "_attributeCasts")).toEqual(true)
    expect(ChildRecord._attributeCasts).not.toEqual(CastBitRecord._attributeCasts)
  })

  it("stores declared booleans as 1/0 for non-sqlite drivers on write", () => {
    const record = new CastBitRecord()

    record._setColumnAttribute("flag", true)
    expect(record._changes.Flag).toEqual(1)

    record._setColumnAttribute("flag", false)
    expect(record._changes.Flag).toEqual(0)
  })

  it("reads a declared boolean column back as a real boolean", () => {
    const trueRecord = new CastBitRecord()
    const falseRecord = new CastBitRecord()

    trueRecord._attributes.Flag = 1
    falseRecord._attributes.Flag = 0

    expect(trueRecord.readAttribute("flag")).toEqual(true)
    expect(falseRecord.readAttribute("flag")).toEqual(false)
    expect(typeof trueRecord.readAttribute("flag")).toEqual("boolean")
  })

  it("leaves null/undefined untouched for a declared boolean column", () => {
    const nullRecord = new CastBitRecord()

    nullRecord._attributes.Flag = null
    expect(nullRecord.readAttribute("flag")).toEqual(null)
  })

  it("does not convert a non-declared bit/int column (no behaviour change)", () => {
    const record = new CastBitRecord()

    record._attributes.Count = 5
    expect(record.readAttribute("count")).toEqual(5)
    expect(typeof record.readAttribute("count")).toEqual("number")

    record._setColumnAttribute("count", 7)
    expect(record._changes.Count).toEqual(7)
  })
})
