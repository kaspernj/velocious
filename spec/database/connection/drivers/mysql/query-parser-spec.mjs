import DatabaseHandler from "../../../../../src/database/handler.mjs"
import DatabaseQuery from "../../../../../src/database/query/index.mjs"
import MysqlQueryParser from "../../../../../src/database/drivers/mysql/query-parser.mjs"

import FromTable from "../../../../../src/database/query/from-table.mjs"
import SelectTableAndColumn from "../../../../../src/database/query/select-table-and-column.mjs"

import MysqlDriverClass from "../../../../../src/database/drivers/mysql/index.mjs"

const mysqlDriver = new MysqlDriverClass()

describe("database - connection - drivers - mysql - query parser", () => {
  it("generates sql with selects, joins and orders", () => {
    const handler = new DatabaseHandler()
    const query = new DatabaseQuery({driver: mysqlDriver, handler})
      .select(["tasks.id", "tasks.name"])
      .from("tasks")
      .joins("LEFT JOIN projects ON projects.id = tasks.project_id")

    const sql = new MysqlQueryParser({query}).toSql()

    expect(sql).toEqual("SELECT tasks.id, tasks.name FROM tasks LEFT JOIN projects ON projects.id = tasks.project_id")
  })

  it("generates sql with selects, joins and orders", () => {
    const handler = new DatabaseHandler()
    const query = new DatabaseQuery({driver: mysqlDriver, handler})
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
