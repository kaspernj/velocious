const SelectParser = require("../../../query-parser/select-parser.cjs")

module.exports = class VelociousDatabaseConnectionDriversMysqlQueryParser {
  constructor({pretty, query}) {
    if (!query) throw new Error("No query given")

    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    sql = ""
    sql += new SelectParser({pretty, query}).toSql()

    return sql
  }
}
