// @ts-check

import Configuration from "../../../../src/configuration.js"

describe("database - create sql - create index sql", {tags: ["dummy"]}, () => {
  it("runs migrations", {databaseCleaning: {transaction: false}}, async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const createIndexSQLs = await dbs.default.createIndexSQLs({
        columns: ["id", "created_at"],
        tableName: "projects"
      })

      if (dbs.default.getType() == "sqlite") {
        expect(createIndexSQLs).toEqual("CREATE INDEX `index_on_projects_id_and_created_at` ON `projects` (`id`, `created_at`)")
      } else if (dbs.default.getType() == "mssql") {
        expect(createIndexSQLs).toEqual("CREATE INDEX [index_on_id_and_created_at] ON [projects] ([id], [created_at])")
      } else if (dbs.default.getType() == "pgsql") {
        expect(createIndexSQLs).toEqual(`CREATE INDEX "index_on_id_and_created_at" ON "projects" ("id", "created_at")`)
      } else {
        expect(createIndexSQLs).toEqual("CREATE INDEX `index_on_id_and_created_at` ON `projects` (`id`, `created_at`)")
      }
    })
  })
})
