// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class TableForeignKey {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {string} args.columnName - Column name.
   * @param {boolean} [args.isNewForeignKey] - Whether is new foreign key.
   * @param {string} [args.name] - Name.
   * @param {string} args.tableName - Table name.
   * @param {string} args.referencedColumnName - Referenced column name.
   * @param {string} args.referencedTableName - Referenced table name.
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
   * Runs get column name.
   * @returns {string} - The column name.
   */
  getColumnName() { return this._columnName }

  /**
   * Runs get is new foreign key.
   * @returns {boolean} - Whether is new foreign key.
   */
  getIsNewForeignKey() { return this._isNewForeignKey || false }

  /**
   * Runs get table name.
   * @returns {string} - The table name.
   */
  getTableName() { return this._tableName }

  /**
   * Runs get referenced column name.
   * @returns {string} - The referenced column name.
   */
  getReferencedColumnName() { return this._referencedColumnName }

  /**
   * Runs get referenced table name.
   * @returns {string} - The referenced table name.
   */
  getReferencedTableName() { return this._referencedTableName }

  /**
   * Runs get name.
   * @returns {string} - The name.
   */
  getName() { return this._name || "" }

  /**
   * Runs set name.
   * @param {string} newName - New name.
   * @returns {void} - No return value.
   */
  setName(newName) { this._name = newName }
}
