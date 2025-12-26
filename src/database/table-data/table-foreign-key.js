// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class TableForeignKey {
  /**
   * @param {object} args
   * @param {string} args.columnName
   * @param {boolean} [args.isNewForeignKey]
   * @param {string} [args.name]
   * @param {string} args.tableName
   * @param {string} args.referencedColumnName
   * @param {string} args.referencedTableName
   */
  constructor({columnName, isNewForeignKey, name, tableName, referencedColumnName, referencedTableName, ...restArgs}) {
    restArgsError(restArgs)

    this._columnName = columnName
    this._isNewForeignKey = isNewForeignKey
    this._name = name
    this._tableName = tableName
    this._referencedColumnName = referencedColumnName
    this._referencedTableName = referencedTableName
  }

  /**
   * @returns {string} - The column name.
   */
  getColumnName() { return this._columnName }

  /**
   * @returns {boolean} - Whether is new foreign key.
   */
  getIsNewForeignKey() { return this._isNewForeignKey || false }

  /**
   * @returns {string} - The table name.
   */
  getTableName() { return this._tableName }

  /**
   * @returns {string} - The referenced column name.
   */
  getReferencedColumnName() { return this._referencedColumnName }

  /**
   * @returns {string} - The referenced table name.
   */
  getReferencedTableName() { return this._referencedTableName }

  /**
   * @returns {string} - The name.
   */
  getName() { return this._name }

  /**
   * @param {string} newName
   * @returns {void} - No return value.
   */
  setName(newName) { this._name = newName }
}
