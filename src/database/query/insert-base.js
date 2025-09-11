import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryInsertBase {
  constructor({columns, data, driver, multiple, tableName, returnLastInsertedColumnName, rows, ...restArgs}) {
    if (!driver) throw new Error("No driver given to insert base")
    if (!tableName) throw new Error(`Invalid table name given to insert base: ${tableName}`)

    restArgsError(restArgs)

    this.columns = columns
    this.data = data
    this.driver = driver
    this.multiple = multiple
    this.returnLastInsertedColumnName = returnLastInsertedColumnName
    this.rows = rows
    this.tableName = tableName
  }

  getOptions() {
    return this.driver.options()
  }

  toSql() {
    const {driver} = this

    let sql = `INSERT INTO ${driver.quoteTable(this.tableName)}`
    let count = 0
    let columns, lastInsertedSQL

    if (this.returnLastInsertedColumnName) {
      if (driver.getType() == "mssql") {
        lastInsertedSQL = ` OUTPUT INSERTED.${driver.quoteColumn(this.returnLastInsertedColumnName)} AS lastInsertID`

        if (Object.keys(this.data).length <= 0) {
          sql += lastInsertedSQL
        }
      } else if (driver.getType() == "mysql" || driver.getType() == "pgsql") {
        lastInsertedSQL = ` RETURNING ${driver.quoteColumn(this.returnLastInsertedColumnName)} AS lastInsertID`
      }
    }

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

        sql += driver.quoteColumn(columnName)
        count++
      }

      sql += ")"
    }

    if (this.returnLastInsertedColumnName && driver.getType() == "mssql" && Object.keys(this.data).length > 0) {
      sql += lastInsertedSQL
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
      } else if (driver.getType() == "sqlite" || driver.getType() == "mssql") {
        sql += " DEFAULT VALUES"
      } else if (driver.getType() == "mysql") {
        sql += " () VALUES ()"
      }
    }

    if (this.returnLastInsertedColumnName) {
      if (driver.getType() == "mysql") {
        sql += lastInsertedSQL
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
