// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {createTenantDatabaseGenerationTestApp} from "../helpers/tenant-database-generation-test-helper.js"
import DatabaseGenerationContext from "../../src/database/generation-context.js"

describe("DatabaseGenerationContext", () => {
  it("pins immutable logical, descriptor, and physical database identity for the whole callback", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-generation-context")

    try {
      const context = await DatabaseGenerationContext.resolve({
        configuration: app.configuration,
        databaseIdentifier: "projectTenant"
      })

      app.setTenantCandidates([{slug: "replacement"}])

      expect(Object.isFrozen(context)).toEqual(true)
      expect(Object.isFrozen(context.tenant())).toEqual(true)
      expect(context.databaseIdentifier()).toEqual("projectTenant")
      expect(context.databaseConfiguration().name).toEqual("velocious-generation-context-project-selected")
      expect(app.getTenantListCalls()).toEqual(0)

      await app.configuration.runWithTenant({slug: "ambient-other"}, async () => {
        await context.run({name: "Verify pinned generation context", callback: async (db) => {
          expect(db.getArgs().name).toEqual("velocious-generation-context-project-selected")
          expect(await db.tableExists("tenant_only_widgets")).toEqual(true)
        }})
      })
    } finally {
      await app.cleanup()
    }
  })
})
