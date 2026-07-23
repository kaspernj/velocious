import Record from "../../../src/database/record/index.js"

class EventSeries extends Record {
}

describe("Record - translations", {databaseCleaning: {transaction: true}}, () => {
  it("handles difficult table names", async () => {
    expect(EventSeries.getTranslationsTableName()).toEqual("event_series_translations")
  })

  it("routes a generated translation class through its translated model tenant resolver", async () => {
    class TenantEventSeries extends Record {}

    TenantEventSeries.setTableName("tenant_event_series")
    TenantEventSeries.switchesTenantDatabase("projectTenant")
    TenantEventSeries.translates("name")

    const TranslationClass = TenantEventSeries.getTranslationClass()

    expect(TranslationClass.hasTenantDatabaseIdentifierResolver()).toEqual(true)
    expect(TranslationClass.getTenantDatabaseIdentifier()).toEqual("projectTenant")
  })
})
