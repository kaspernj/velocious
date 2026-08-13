// @ts-check

import Configuration from "../../src/configuration.js"
import DatabaseRecord from "../../src/database/record/index.js"
import BrowserEnvironmentHandler from "../../src/environment-handlers/browser.js"
import Migration from "../../src/database/migration/index.js"
import MigrationsLedger from "../../src/database/migrations-ledger.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteWebDriver from "../../src/database/drivers/sqlite/index.web.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import initSqlJs from "sql.js"
import queryWeb from "../../src/database/drivers/sqlite/query.web.js"

describe("frontend tenant database initialization - browser contract", {databaseCleaning: {transaction: false, truncate: false}, tags: ["dummy"]}, () => {
  it("migrates and initializes a tenant-bound model through the browser-compatible SQLite lifecycle", async () => {
    const SQL = await initSqlJs({locateFile: (file) => new URL(`../../node_modules/sql.js/dist/${file}`, import.meta.url).pathname})
    const database = new SQL.Database()
    const sqlJsConnection = {
      close: async () => database.close(),
      query: async (/** @type {string} */ sql) => await queryWeb(database, sql)
    }
    const environmentHandler = new BrowserEnvironmentHandler()
    const configuration = new Configuration({
      database: {
        test: {
          projectTenant: {
            driver: SqliteWebDriver,
            getConnection: () => sqlJsConnection,
            migrations: true,
            name: "frontend-tenant-browser-template",
            poolType: SingleMultiUsePool,
            tenantOnly: true,
            type: "sqlite"
          }
        }
      },
      directory: "/frontend-tenant-browser-spec",
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      tenantDatabaseResolver: ({identifier, tenant}) => {
        if (identifier !== "projectTenant") return
        if (!tenant || typeof tenant !== "object") return
        if (/** @type {{slug?: string}} */ (tenant).slug !== "browser") return

        return {getConnection: () => sqlJsConnection, name: "frontend-tenant-browser"}
      }
    })
    const previousConfiguration = Configuration.current()

    configuration.setCurrent()

    class BrowserTenantWidget extends DatabaseRecord {}
    class CreateBrowserTenantWidgets extends Migration {
      async up() {
        await this.execute("CREATE TABLE frontend_tenant_browser_widgets(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
      }
    }

    BrowserTenantWidget.setTableName("frontend_tenant_browser_widgets")
    BrowserTenantWidget.switchesTenantDatabase("projectTenant")
    CreateBrowserTenantWidgets.onDatabases(["projectTenant"])
    BrowserTenantWidget.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000500-create-browser-tenant-widgets.js": CreateBrowserTenantWidgets})
    const handle = Tenant.handle({slug: "browser"}, configuration)

    try {
      await handle.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "browser-generation-1"})
      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(BrowserTenantWidget).create({name: "browser ready"})
        expect(await operation.forModel(BrowserTenantWidget).pluck("name")).toEqual(["browser ready"])
      })
    } finally {
      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.connection().dropTable("frontend_tenant_browser_widgets", {ifExists: true})
        await MigrationsLedger.removeVersion(operation.connection(), "20260813000500")
      })
      await handle.close({databaseIdentifier: "projectTenant", flush: true})
      previousConfiguration.setCurrent()
      await configuration.closeDatabaseConnections()
    }
  })
})
