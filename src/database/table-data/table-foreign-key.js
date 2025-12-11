// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class TableForeignKey {
  /**
   * @param {object} args
   * @param {string} args.columnName
   * @param {boolean} [args.isNewForeignKey]
   * @param {string} args.name
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
   * @returns {string}
   */
  getColumnName() { return this._columnName }

  /**
   * @returns {boolean}
   */
  getIsNewForeignKey() { return this._isNewForeignKey || false }

  /**
   * @returns {string}
   */
  getTableName() { return this._tableName }

  /**
   * @returns {string}
   */
  getReferencedColumnName() { return this._referencedColumnName }

  /**
   * @returns {string}
   */
  getReferencedTableName() { return this._referencedTableName }

  /**
   * @returns {string}
   */
  getName() { return this._name }

  /**
   * @param {string} newName
   * @returns {void}
   */
  setName(newName) { this._name = newName }
}
