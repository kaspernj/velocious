// @ts-check

import Current from "../../../src/current.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"

class TenantAnalyticsRecord extends DatabaseRecord {}

TenantAnalyticsRecord.switchesTenantDatabase(({tenant}) => {
  if (tenant && typeof tenant === "object" && tenant.slug) {
    return "analytics"
  }
})

describe("DatabaseRecord tenant database switching", () => {
  it("declares tenant-aware database identifiers on model classes", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      expect(TenantAnalyticsRecord.getDatabaseIdentifier()).toEqual("default")

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        expect(Current.tenant()).toEqual({slug: "alpha"})
        expect(TenantAnalyticsRecord.getTenantDatabaseIdentifier()).toEqual("analytics")
        expect(TenantAnalyticsRecord.getDatabaseIdentifier()).toEqual("analytics")
      })

      expect(TenantAnalyticsRecord.getDatabaseIdentifier()).toEqual("default")
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })
})
