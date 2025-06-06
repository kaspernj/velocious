import {digs} from "diggerize"
import FromParser from "./from-parser.mjs"
import GroupParser from "./group-parser.mjs"
import JoinsParser from "./joins-parser.mjs"
import LimitParser from "./limit-parser.mjs"
import OrderParser from "./order-parser.mjs"
import SelectParser from "./select-parser.mjs"
import WhereParser from "./where-parser.mjs"

export default class VelociousDatabaseBaseQueryParser {
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
    sql += new WhereParser({pretty, query}).toSql()
    sql += new GroupParser({pretty, query}).toSql()
    sql += new OrderParser({pretty, query}).toSql()
    sql += new LimitParser({pretty, query}).toSql()

    return sql
  }
}
