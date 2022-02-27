const DatabasePool = require("../pool/index.cjs")
const inflection = require("inflection")

module.exports = class VelociousDatabaseRecord {
  static connection() {
    const connection = DatabasePool.current().singleConnection()

    if (!connection) throw new Error("No connection?")

    return connection
  }

  static find(recordId) {
    throw new Error("stub")
  }

  static primaryKey() {
    return "id"
  }

  async save() {
    if (this.isPersisted()) {
      return await this._updateRecordWithChanges()
    } else {
      return await this._createNewRecord()
    }
  }

  static tableName() {
    return inflection.underscore(inflection.pluralize(this.name))
  }

  constructor(attributes = {}) {
    this._attributes = attributes
    this._changes = {}
  }

  attributes() {
    return Object.assign({}, this._attributes, this._changes)
  }

  readAttribute(attributeName) {
    if (attributeName in this._changes) return this._changes[attributeName]

    return this._attributes[attributeName]
  }

  async _createNewRecord() {
    if (!this.constructor.connection()["insertSql"]) {
      throw new Error(`No insertSql on ${this.constructor.connection().constructor.name}`)
    }

    const sql = this.constructor.connection().insertSql({
      tableName: this.constructor.tableName(),
      data: this.attributes()
    })

    await this.constructor.connection().query(sql)
    await this.reload()
  }

  async _updateRecordWithChanges() {
    throw new Error("Update record not implemented")
  }

  id() {
    return this.readAttribute(this.constructor.primaryKey())
  }

  isPersisted() {
    if (this.id()) return true

    return false
  }

  isNewRecord() {
    return !this.isPersisted()
  }
}
