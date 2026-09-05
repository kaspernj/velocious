// @ts-check

import SelectPlain from "../../../src/database/query/select-plain.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("Database - query - plain select", () => {
  it("resolves terminal aliases to the driver's returned result key", () => {
    const casePreservingDriver = {getType: () => "sqlite"}
    const pgsqlDriver = {getType: () => "pgsql"}
    const unquotedSelect = new SelectPlain("1 AS selectedCalculation")
    const quotedSelect = new SelectPlain('1 AS "selectedCalculation"')

    expect(unquotedSelect.getAlias(casePreservingDriver)).toEqual("selectedCalculation")
    expect(unquotedSelect.getAlias(pgsqlDriver)).toEqual("selectedcalculation")
    expect(quotedSelect.getAlias(pgsqlDriver)).toEqual("selectedCalculation")
  })
})
