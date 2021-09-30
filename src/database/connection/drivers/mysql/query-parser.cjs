const {digs} = require("diggerize")
const FromParser = require("../../../query-parser/from-parser.cjs")
const JoinsParser = require("../../../query-parser/joins-parser.cjs")
const SelectParser = require("../../../query-parser/select-parser.cjs")

module.exports = class VelociousDatabaseConnectionDriversMysqlQueryParser {
  constructor({pretty, query}) {
    if (!query) throw new Error("No query given")

    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    let sql = ""

    sql += new SelectParser({pretty, query}).toSql()
    sql += new FromParser({pretty, query}).toSql()
    sql += new JoinsParser({pretty, query}).toSql()

    return sql
  }
}
