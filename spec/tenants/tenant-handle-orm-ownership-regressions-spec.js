// @ts-check

import Current from "../../src/current.js"
import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import TenantHandle from "../../src/tenants/tenant-handle.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"

describe("Tenant handle ORM producer ownership regressions", () => {
  /**
   * Runs setup and assertions with an isolated tenant configuration.
   * @param {string} prefix - Database prefix.
   * @param {(args: {configuration: import("../../src/configuration.js").default, handle: TenantHandle}) => Promise<void>} callback - Test callback.
   * @returns {Promise<void>}
   */
  async function withTenantConfiguration(prefix, callback) {
    const {cleanup, configuration} = await createTenantTestConfiguration(prefix)
    const handle = new TenantHandle({configuration, tenant: {slug: "alpha"}})

    try {
      await callback({configuration, handle})
    } finally {
      await cleanup()
    }
  }

  it("initializes generated translation classes through the captured connection", async () => {
    await withTenantConfiguration("velocious-tenant-translation-owner", async ({configuration, handle}) => {
      class TenantArticle extends DatabaseRecord {}

      TenantArticle.setTableName("tenant_articles")
      TenantArticle.switchesTenantDatabase("projectTenant")
      TenantArticle.translates("title")

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE tenant_articles(id integer PRIMARY KEY AUTOINCREMENT)")
          await dbs.projectTenant.query("CREATE TABLE tenant_article_translations(id integer PRIMARY KEY AUTOINCREMENT, tenant_article_id integer NOT NULL, locale varchar(255) NOT NULL, title varchar(255))")
        })
      })

      expect(Current.tenant()).toBeUndefined()

      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await TenantArticle.ensureInitialized({configuration, connection: operation.connection()})

        expect(TenantArticle.getTranslationClass().isInitialized()).toEqual(true)
        expect(operation.connection().getArgs().name).toEqual("velocious-tenant-translation-owner-projectTenant-alpha")
      })
    })
  })

  it("initializes first-use preload targets through the source operation", async () => {
    await withTenantConfiguration("velocious-tenant-preload-owner", async ({configuration, handle}) => {
      class TenantParent extends DatabaseRecord {}
      class TenantChild extends DatabaseRecord {}

      TenantParent.setTableName("tenant_preload_parents")
      TenantChild.setTableName("tenant_preload_children")
      TenantParent.switchesTenantDatabase("projectTenant")
      TenantChild.switchesTenantDatabase("projectTenant")
      TenantParent.hasMany("tenantChildren", {foreignKey: "parent_id", klass: TenantChild})

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE tenant_preload_parents(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
          await dbs.projectTenant.query("CREATE TABLE tenant_preload_children(id integer PRIMARY KEY AUTOINCREMENT, parent_id integer NOT NULL, name varchar(255))")
        })
      })

      expect(Current.tenant()).toBeUndefined()

      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await TenantParent.ensureInitialized({configuration, connection: operation.connection()})
        const parent = await operation.forModel(TenantParent).create({name: "parent"})

        await operation.connection().query(`INSERT INTO tenant_preload_children(parent_id, name) VALUES (${operation.connection().quote(parent.id())}, 'child')`, {processListComment: false})

        const loaded = await operation
          .forModel(TenantParent)
          .preload({tenantChildren: true})
          .findByOrFail({id: parent.id()})

        expect(TenantChild.isInitialized()).toEqual(true)
        expect(loaded.getRelationshipByName("tenantChildren").loaded().map((child) => child.readAttribute("name"))).toEqual(["child"])
      })
    })
  })

  it("keys auditing metadata by captured physical database identity", async () => {
    await withTenantConfiguration("velocious-tenant-audit-owner", async ({configuration}) => {
      class Widget extends DatabaseRecord {}

      Widget.setTableName("widgets")
      Widget.switchesTenantDatabase("projectTenant")
      Widget.audited()

      for (const slug of ["alpha", "beta"]) {
        await configuration.runWithTenant({slug}, async () => {
          await configuration.ensureConnections(async (dbs) => {
            const migration = new Migration({configuration, databaseIdentifier: "projectTenant", db: dbs.projectTenant})

            await migration.createSharedAuditTables()
            await migration.createTable("widgets", (table) => {
              table.string("name")
              table.timestamps()
            })
            if (slug === "alpha") await migration.createDedicatedAuditTable("widgets")
          })
        })
      }

      for (const slug of ["alpha", "beta"]) {
        const handle = new TenantHandle({configuration, tenant: {slug}})

        await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
          await Widget.ensureInitialized({configuration, connection: operation.connection()})
          await operation.forModel(Widget).create({name: slug})

          if (slug === "alpha") {
            expect(await operation.connection().query("SELECT COUNT(*) AS count FROM widget_audits", {processListComment: false})).toEqual([{count: 1}])
          } else {
            expect(await operation.connection().query("SELECT COUNT(*) AS count FROM audits", {processListComment: false})).toEqual([{count: 1}])
          }
        })
      }
    })
  })

  it("selects attachment stores from the record-owned physical tenant", async () => {
    await withTenantConfiguration("velocious-tenant-attachment-owner", async ({configuration, handle}) => {
      class TenantDocument extends DatabaseRecord {}

      TenantDocument.setTableName("tenant_documents")
      TenantDocument.switchesTenantDatabase("projectTenant")
      TenantDocument.hasOneAttachment("file")

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE tenant_documents(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
        })
      })

      expect(Current.tenant()).toBeUndefined()

      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await TenantDocument.ensureInitialized({configuration, connection: operation.connection()})
        const document = await operation.forModel(TenantDocument).create({name: "document"})

        expect(await document.getAttachmentByName("file").download()).toEqual(null)
        expect(await operation.connection().tableExists("velocious_attachments")).toEqual(true)
      })
    })
  })
})
