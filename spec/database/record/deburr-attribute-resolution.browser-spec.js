import {describe, expect, it} from "../../../src/testing/test.js"
import Record from "../../../src/database/record/index.js"

// Columns with German umlauts ("Plätze") and all-caps acronyms ("IP") are deburred to ASCII attribute
// names (plaetze / ip) in the generated/runtime attribute map. These specs guard that every resolution
// path (create/setAttribute, readAttribute, getColumnNameForAttributeName) accepts the raw column name
// AND the deburred attribute name, so the two stay interchangeable.
describe("Record - deburr attribute resolution", {tags: ["dummy"]}, () => {
  it("create() accepts raw column names and exposes deburred ASCII attributes", async () => {
    class UmlautRecord extends Record {}

    UmlautRecord.setTableName("umlaut_records")

    const record = await UmlautRecord.create({Plätze: 5, IP: "198.51.100.10"})

    // Deburred ASCII attribute names.
    expect(record.readAttribute("plaetze")).toEqual(5)
    expect(record.readAttribute("ip")).toEqual("198.51.100.10")

    // The raw column names resolve to the same values.
    expect(record.readAttribute("Plätze")).toEqual(5)
    expect(record.readAttribute("IP")).toEqual("198.51.100.10")
  })

  it("getColumnNameForAttributeName resolves column name and deburred attribute to the same column", async () => {
    class UmlautRecord extends Record {}

    UmlautRecord.setTableName("umlaut_records")

    await UmlautRecord.count() // trigger initialization

    expect(UmlautRecord.getColumnNameForAttributeName("plaetze")).toEqual("Plätze")
    expect(UmlautRecord.getColumnNameForAttributeName("Plätze")).toEqual("Plätze")
    expect(UmlautRecord.getColumnNameForAttributeName("ip")).toEqual("IP")
    expect(UmlautRecord.getColumnNameForAttributeName("IP")).toEqual("IP")
  })

  it("setAttribute accepts both the raw column name and the deburred attribute name", async () => {
    class UmlautRecord extends Record {}

    UmlautRecord.setTableName("umlaut_records")

    await UmlautRecord.count() // trigger initialization

    const record = new UmlautRecord()

    record.setAttribute("Plätze", 7) // raw column name
    record.setAttribute("ip", "203.0.113.5") // deburred attribute name

    expect(record.readAttribute("plaetze")).toEqual(7)
    expect(record.readAttribute("IP")).toEqual("203.0.113.5")
  })
})
