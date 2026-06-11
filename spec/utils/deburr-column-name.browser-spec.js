import {describe, expect, it} from "../../src/testing/test.js"
import deburrColumnName from "../../src/utils/deburr-column-name.js"

describe("deburrColumnName", () => {
  it("transliterates German umlauts (and ß) to ASCII", () => {
    expect(deburrColumnName("PlätzeVerkauft")).toEqual("PlaetzeVerkauft")
    expect(deburrColumnName("VA_ÜbAttributID")).toEqual("VA_UebAttributID")
    expect(deburrColumnName("Größe")).toEqual("Groesse")
    expect(deburrColumnName("Straße")).toEqual("Strasse")
  })

  it("down-cases all-caps acronym columns so they don't camelize to iP/eA", () => {
    expect(deburrColumnName("IP")).toEqual("ip")
    expect(deburrColumnName("EA")).toEqual("ea")
  })

  it("leaves names that already contain a lowercase letter untouched", () => {
    expect(deburrColumnName("VA_BlockID")).toEqual("VA_BlockID")
    expect(deburrColumnName("plaetze")).toEqual("plaetze")
    expect(deburrColumnName("name")).toEqual("name")
  })
})
