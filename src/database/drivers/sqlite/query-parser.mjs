import {digs} from "diggerize"
import FromParser from "../../query-parser/from-parser.mjs"
import JoinsParser from "../../query-parser/joins-parser.mjs"
import SelectParser from "../../query-parser/select-parser.mjs"

export default class VelociousDatabaseConnectionDriversMysqlQueryParser {
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
