// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryInsertBase {
  /**
   * @param {object} args - Options object.
   * @param {Record<string, any>} [args.data] - Data payload.
   * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
   * @param {string} args.tableName - Table name.
   * @param {Array<string>} [args.columns] - Column names.
   * @param {boolean} [args.multiple] - Whether multiple.
   * @param {string[]} [args.returnLastInsertedColumnNames] - Return last inserted column names.
   * @param {Array<Array<unknown>>} [args.rows] - Rows to insert.
   */
  constructor({columns, data, driver, multiple, tableName, returnLastInsertedColumnNames, rows, ...restArgs}) {
    if (!driver) throw new Error("No driver given to insert base")
    if (!tableName) throw new Error(`Invalid table name given to insert base: ${tableName}`)

    restArgsError(restArgs)

    this.columns = columns
    this.data = data
    this.driver = driver
    this.multiple = multiple
    this.returnLastInsertedColumnNames = returnLastInsertedColumnNames
    this.rows = rows
    this.tableName = tableName
  }

  /**
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.driver.options()
  }

  /**
   * @param {any} value - Value to format.
   * @returns {string | number} - SQL literal.
   */
  formatValue(value) {
    if (value === null) return "NULL"

    return this.getOptions().quote(value)
  }

  /**
   * @returns {string} SQL statement
   */
  toSql() {
    const {driver} = this

    let sql = `INSERT INTO ${driver.quoteTable(this.tableName)}`
    let count = 0
    let columns, lastInsertedSQL

    if (this.returnLastInsertedColumnNames) {
      if (driver.getType() == "mssql") {
        lastInsertedSQL = ` OUTPUT `

        for (let i = 0; i < this.returnLastInsertedColumnNames.length; i++) {
          const columnName = this.returnLastInsertedColumnNames[i]

          if (i > 0) {
            lastInsertedSQL += ", "
          }

          lastInsertedSQL += ` INSERTED.${driver.quoteColumn(columnName)}`
        }

        if (this.data && Object.keys(this.data).length <= 0) {
          sql += lastInsertedSQL
        }
      } else if (driver.getType() == "mysql" || driver.getType() == "pgsql" || (driver.getType() == "sqlite" && driver.supportsInsertIntoReturning())) {
        lastInsertedSQL = " RETURNING "

        for (let i = 0; i < this.returnLastInsertedColumnNames.length; i++) {
          const columnName = this.returnLastInsertedColumnNames[i]

          if (i > 0) {
            lastInsertedSQL += ", "
          }

          lastInsertedSQL += ` ${driver.quoteColumn(columnName)}`
        }
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

    if (this.returnLastInsertedColumnNames && driver.getType() == "mssql" && this.data && Object.keys(this.data).length > 0) {
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
      if (this.data && Object.keys(this.data).length > 0) {
        sql += " VALUES "
        sql += this._valuesSql(Object.values(this.data))
      } else if (driver.getType() == "sqlite" || driver.getType() == "mssql") {
        sql += " DEFAULT VALUES"
      } else if (driver.getType() == "mysql") {
        sql += " () VALUES ()"
      }
    }

    if (this.returnLastInsertedColumnNames) {
      if (driver.getType() == "pgsql" || driver.getType() == "mysql" || (driver.getType() == "sqlite" && driver.supportsInsertIntoReturning())) {
        sql += lastInsertedSQL
      }
    }

    return sql
  }

  /**
   * @param {any[]} data - Data payload.
   * @returns {string} - SQL string.
   */
  _valuesSql(data) {
    let count = 0
    let sql = "("

    for (const value of data) {
      if (count > 0) sql += ", "

      sql += this.formatValue(value)
      count++
    }

    sql += ")"

    return sql
  }
}
