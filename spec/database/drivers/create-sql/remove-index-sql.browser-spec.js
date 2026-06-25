// @ts-check

import Configuration from "../../../../src/configuration.js"

describe("database - create sql - remove index sql", {tags: ["dummy"]}, () => {
  it("builds driver-specific drop-index SQL", {databaseCleaning: {transaction: false}}, async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const removeIndexSQLs = await dbs.default.removeIndexSQLs({
        name: "index_task_boards_on_task_id",
        tableName: "task_boards"
      })

      if (dbs.default.getType() == "sqlite") {
        expect(removeIndexSQLs).toEqual(["DROP INDEX `index_task_boards_on_task_id`"])
      } else if (dbs.default.getType() == "mssql") {
        expect(removeIndexSQLs).toEqual(["DROP INDEX [index_task_boards_on_task_id] ON [task_boards]"])
      } else if (dbs.default.getType() == "pgsql") {
        expect(removeIndexSQLs).toEqual([`DROP INDEX "index_task_boards_on_task_id"`])
      } else {
        expect(removeIndexSQLs).toEqual(["DROP INDEX `index_task_boards_on_task_id` ON `task_boards`"])
      }
    })
  })
})
