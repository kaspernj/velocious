import {validateTimeZone} from "../src/time-zone.js"

describe("Time zone helpers", () => {
  it("rejects blank request timezone identifiers", () => {
    expect(() => validateTimeZone("")).toThrow("Expected timeZone to be a timezone string")
  })

  it("rejects bare offsets as request timezone identifiers", () => {
    expect(() => validateTimeZone("-10:00")).toThrow('Expected timeZone to be an IANA timezone string, not offset "-10:00"')
  })
})
