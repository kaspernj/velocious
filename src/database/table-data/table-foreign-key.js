import restArgsError from "../../utils/rest-args-error.js"

export default class TableForeignKey {
  constructor({columnName, isNewForeignKey, name, tableName, referencedColumnName, referencedTableName, ...restArgs}) {
    restArgsError(restArgs)

    this._columnName = columnName
    this._isNewForeignKey = isNewForeignKey
    this._name = name
    this._tableName = tableName
    this._referencedColumnName = referencedColumnName
    this._referencedTableName = referencedTableName
  }

  getColumnName() { return this._columnName }
  getIsNewForeignKey() { return this._isNewForeignKey }
  getTableName() { return this._tableName }
  getReferencedColumnName() { return this._referencedColumnName }
  getReferencedTableName() { return this._referencedTableName }

  getName() { return this._name }
  setName(newName) { this._name = newName }
}
