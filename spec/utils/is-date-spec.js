import {describe, expect, it} from "../../src/testing/test.js"
import isDate from "../../src/utils/is-date.js"
import vm from "node:vm"

describe("isDate", () => {
  it("recognizes same-realm dates", () => {
    expect(isDate(new Date())).toEqual(true)
  })

  it("recognizes dates created in another realm", () => {
    const crossRealmDate = vm.runInNewContext("new Date('2026-01-02T03:04:05.000Z')")

    expect(crossRealmDate instanceof Date).toEqual(false)
    expect(isDate(crossRealmDate)).toEqual(true)
  })

  it("rejects non-dates", () => {
    expect(isDate("2026-01-02T03:04:05.000Z")).toEqual(false)
    expect(isDate(1234567890)).toEqual(false)
    expect(isDate({})).toEqual(false)
    expect(isDate(null)).toEqual(false)
    expect(isDate(undefined)).toEqual(false)
  })
})
