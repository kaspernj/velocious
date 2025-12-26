// @ts-check

import FromParser from "./from-parser.js"
import GroupParser from "./group-parser.js"
import JoinsParser from "./joins-parser.js"
import LimitParser from "./limit-parser.js"
import OrderParser from "./order-parser.js"
import SelectParser from "./select-parser.js"
import WhereParser from "./where-parser.js"

export default class VelociousDatabaseBaseQueryParser {
  /**
   * @param {object} args - Options object.
   * @param {boolean} [args.pretty] - Whether pretty.
   * @param {import("../query/index.js").default} args.query - Query instance.
   */
  constructor({pretty = false, query}) {
    if (!query) throw new Error("No query given")

    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = this

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
