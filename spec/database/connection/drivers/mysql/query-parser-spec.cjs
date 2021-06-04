const Query = require("../../../../../src/database/query/index.cjs")
const MysqlQueryParser = require("../../../../../src/database/connection/drivers/mysql/query-parser.cjs")

describe("database - connection - drivers - mysql - query parser", () => {
  it("generates sql with selects, joins and orders", () => {
    const handler = new Handler()
    const query = new Query({handler})
      .select(["tasks.id", "tasks.name"])
      .joins("LEFT JOIN projects ON projects.id = tasks.project_id")

    const sql = new MysqlQueryParser({query}).toSql()

    expect(sql).toEqual("asd")
  })
})
