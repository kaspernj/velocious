// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Record from "../../../src/database/record/index.js"

describe("Record - hasPrimaryKey", () => {
  it("returns true for the default primary key", () => {
    class DefaultPkRecord extends Record {}

    expect(DefaultPkRecord.hasPrimaryKey()).toEqual(true)
    expect(DefaultPkRecord.primaryKey()).toEqual("id")
  })

  it("returns true for an explicit single primary key column", () => {
    class CustomPkRecord extends Record {}

    CustomPkRecord.setPrimaryKey("uuid")

    expect(CustomPkRecord.hasPrimaryKey()).toEqual(true)
    expect(CustomPkRecord.primaryKey()).toEqual("uuid")
  })

  it("returns false when the primary key is explicitly null (composite-key tables)", () => {
    class NoPkRecord extends Record {}

    NoPkRecord.setPrimaryKey(null)

    expect(NoPkRecord.hasPrimaryKey()).toEqual(false)
    // primaryKey() still falls back to "id" for the default case, which is why count() must use
    // hasPrimaryKey() to decide between COUNT(<table>.id) and COUNT(*) for a no-primary-key model.
    expect(NoPkRecord.primaryKey()).toEqual("id")
  })
})
