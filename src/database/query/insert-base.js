import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryInsertBase {
  constructor({columns, data, driver, multiple, tableName, rows, ...restArgs}) {
    if (!driver) throw new Error("No driver given to insert base")
    if (!tableName) throw new Error(`Invalid table name given to insert base: ${tableName}`)

    restArgsError(restArgs)

    this.columns = columns
    this.data = data
    this.driver = driver
    this.multiple = multiple
    this.rows = rows
    this.tableName = tableName
  }

  getOptions() {
    return this.driver.options()
  }

  toSql() {
    let sql = `INSERT INTO ${this.getOptions().quoteTableName(this.tableName)}`
    let count = 0
    let columns

    if (this.columns && this.rows) {
      columns = this.columns
    } else if (this.data) {
      columns = Object.keys(this.data)
    } else {
      throw new Error("Neither 'column' and 'rows' or data was given")
    }

    if (columns.length > 0) {
      sql += " ("

      for (const columnName of columns) {
        if (count > 0) sql += ", "

        sql += this.getOptions().quoteColumnName(columnName)
        count++
      }

      sql += ")"
    }

    if (this.columns && this.rows) {
      if (this.rows.length > 0) {
        sql += " VALUES "
      }

      let count = 0

      for (const row of this.rows) {
        if (count >= 1) sql += ", "

        count++
        sql += this._valuesSql(row)
      }
    } else {
      if (Object.keys(this.data).length > 0) {
        sql += " VALUES "
        sql += this._valuesSql(Object.values(this.data))
      } else if (this.driver.getType() == "sqlite") {
        sql += " DEFAULT VALUES"
      } else if (this.driver.getType() == "mysql") {
        sql += " () VALUES ()"
      }
    }

    return sql
  }

  _valuesSql(data) {
    let count = 0
    let sql = "("

    for (const value of data) {
      if (count > 0) sql += ", "

      sql += this.getOptions().quote(value)
      count++
    }

    sql += ")"

    return sql
  }
}
