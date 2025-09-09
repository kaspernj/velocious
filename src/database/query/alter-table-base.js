import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryAlterTableBase extends QueryBase {
  constructor({columns, driver, tableName, ...restArgs}) {
    restArgsError(restArgs)

    super({driver})
    this.columns = columns
    this.tableName = tableName
  }

  toSqls() {
    const sqls = []

    for (const column of this.columns) {
      let sql = `ALTER TABLE ${this.getOptions().quoteTableName(this.tableName)} ADD `

      sql += this.getOptions().quoteColumnName(column.getName())

      sqls.push(sql)
    }

    return sqls
  }
}
