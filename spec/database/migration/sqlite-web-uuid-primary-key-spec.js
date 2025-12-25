// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import NodeEnvironmentHandler from "../../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../../src/database/pool/single-multi-use.js"
import SqliteDriverWeb from "../../../src/database/drivers/sqlite/index.web.js"
import initSqlJs from "sql.js"
import path from "path"
import queryWeb from "../../../src/database/drivers/sqlite/query.web.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import {fileURLToPath} from "url"

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..")

describe("database - migration - sqlite web uuid primary key", () => {
  it("assigns UUIDs client-side when SQLite can't default primary keys in SQL.js", async () => {
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(projectRoot, "node_modules/sql.js/dist", file)
    })
    const database = new SQL.Database()
    const connection = {
      query: async (sql) => await queryWeb(database, sql),
      close: async () => {},
      disconnect: async () => {}
    }
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriverWeb,
            poolType: SingleMultiUsePool,
            type: "sqlite",
            name: "sqljs-uuid-test",
            migrations: false,
            getConnection: () => connection
          }
        }
      },
      directory: path.join(projectRoot, "spec/dummy"),
      environment: "test",
      environmentHandler: new NodeEnvironmentHandler(),
      initializeModels: async () => {},
      locale: () => "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    await configuration.ensureConnections(async (dbs) => {
      const db = dbs.default

      await db.query("DROP TABLE IF EXISTS web_uuid_items")
      await db.query("CREATE TABLE web_uuid_items(id UUID NOT NULL PRIMARY KEY, title TEXT, created_at DATETIME, updated_at DATETIME)")
    })

    class WebUuidItem extends DatabaseRecord {}

    WebUuidItem.setTableName("web_uuid_items")
    await WebUuidItem.initializeRecord({configuration})

    const record = new WebUuidItem({title: "sql.js uuid record"})

    await record.save()

    expect(record.id()).toMatch(uuidRegex)
    const rows = await configuration.getDatabasePool("default").getCurrentConnection().query("SELECT id FROM web_uuid_items LIMIT 1")

    expect(rows[0].id).toEqual(record.id())
  })
})
