const {Database: {Handler, Query}} = require("../../../../../index.cjs")
const MysqlQueryParser = require("../../../../../src/database/connection/drivers/mysql/query-parser.cjs")

describe("database - connection - drivers - mysql - query parser", () => {
  it("generates sql with selects, joins and orders", () => {
    const handler = new Handler()
    const query = new Query({handler})
      .select(["tasks.id", "tasks.name"])
      .from("tasks")
      .joins("LEFT JOIN projects ON projects.id = tasks.project_id")

    const sql = new MysqlQueryParser({query}).toSql()

    expect(sql).toEqual("SELECT tasks.id,tasks.name FROM tasks LEFT JOIN projects ON projects.id = tasks.project_id")
  })
})
