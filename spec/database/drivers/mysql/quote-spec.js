// @ts-check

import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

const configuration = /** @type {any} */ ({
  debug: false,
  getCurrentRequestTiming: () => undefined
})

describe("Database - drivers - mysql - quote", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("quotes plain objects as JSON instead of SQL assignment pairs", () => {
    const driver = new MysqlDriver({}, configuration)

    // Without JSON-encoding, mysql.escape turns an object into `key` = value
    // pairs (its `SET ?` form), which is invalid SQL in a value position and
    // breaks inserts into JSON columns such as syncs.data.
    expect(driver.quote({new: 984123})).toEqual("'{\\\"new\\\":984123}'")
    expect(driver.quote([1, 2])).toEqual("'[1,2]'")
  })

  it("does not JSON-encode class instances such as circular model records", () => {
    const driver = new MysqlDriver({}, configuration)

    // Model records are class instances with circular references (e.g. _changes
    // pointing back at the record). JSON-encoding them would throw "Converting
    // circular structure to JSON"; only plain objects/arrays get encoded.
    class FakeRecord {}
    const record = new FakeRecord()

    record._changes = {value: record}

    expect(() => driver._convertValue(record)).not.toThrow()
    expect(driver._convertValue(record)).toBe(record)
  })
})
