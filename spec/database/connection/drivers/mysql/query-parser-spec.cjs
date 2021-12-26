const {Database: {Handler, Query}} = require("../../../../../index.cjs")
const MysqlQueryParser = require("../../../../../src/database/connection/drivers/mysql/query-parser.cjs")

const FromTable = require("../../../../../src/database/query/from-table.cjs")
const SelectTableAndColumn = require("../../../../../src/database/query/select-table-and-column.cjs")

describe("database - connection - drivers - mysql - query parser", () => {
  it("generates sql with selects, joins and orders", () => {
    const handler = new Handler()
    const query = new Query({handler})
      .select(["tasks.id", "tasks.name"])
      .from("tasks")
      .joins("LEFT JOIN projects ON projects.id = tasks.project_id")

    const sql = new MysqlQueryParser({query}).toSql()

    expect(sql).toEqual("SELECT tasks.id, tasks.name FROM tasks LEFT JOIN projects ON projects.id = tasks.project_id")
  })

  it("generates sql with selects, joins and orders", () => {
    const handler = new Handler()
    const query = new Query({handler})
      .select([
        new SelectTableAndColumn({tableName: "tasks", columnName: "id"}),
        new SelectTableAndColumn({tableName: "tasks", columnName: "name"})
      ])
      .from(new FromTable({tableName: "tasks"}))
      .joins("LEFT JOIN projects ON projects.id = tasks.project_id")

    const sql = new MysqlQueryParser({query}).toSql()

    expect(sql).toEqual("SELECT `tasks`.`id`, `tasks`.`name` FROM `tasks` LEFT JOIN projects ON projects.id = tasks.project_id")
  })
})
