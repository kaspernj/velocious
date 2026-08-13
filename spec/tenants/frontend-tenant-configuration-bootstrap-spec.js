// @ts-check

import Initializer from "../../src/initializer.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { initializeFrontendDatabase } from "../../src/database/use-database.js"

describe("frontend tenant configuration bootstrap", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("completes application configuration initialization after tenant readiness", async () => {
    let initializerRuns = 0

    class TrackFrontendInitialization extends Initializer {
      async run() {
        initializerRuns++
      }
    }

    const initializerContext = (fileName) => ({default: {"track-frontend-initialization.js": TrackFrontendInitialization}[fileName]})
    initializerContext.keys = () => ["track-frontend-initialization.js"]
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-configuration-bootstrap", {
      initializers: async () => ({requireContext: initializerContext})
    })
    const migrations = buildFrontendMigrationContext({})
    const handle = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await initializeFrontendDatabase({
        configuration,
        databaseIdentifier: "projectTenant",
        migrationsRequireContextCallback: async () => migrations,
        schemaGeneration: "generation-1",
        tenantHandle: handle
      })

      expect(handle.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(true)
      expect(initializerRuns).toEqual(1)
      expect(configuration.isInitialized()).toEqual(true)
    } finally {
      await cleanup()
    }
  })
})
