import Record from "../../../src/database/record/index.js"

class EventSeries extends Record {
}

describe("Record - translations", () => {
  it("handles difficult table names", async () => {
    expect(EventSeries.getTranslationsTableName()).toEqual("event_series_translations")
  })
})
