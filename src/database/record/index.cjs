const DatabasePool = require("../pool/index.cjs")
const Handler = require("../handler.cjs")
const inflection = require("inflection")
const Query = require("../query/index.cjs")

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

  static _newQuery() {
    const handler = new Handler()
    const query = new Query({
      driver: this.connection(),
      handler,
      modelClass: this
    })

    return query.from(this.tableName())
  }

  static orderableColumn() {
    // Allow to change to 'created_at' if using UUID?

    return this.primaryKey()
  }

  static where(object) {
    const query = this._newQuery().where(object)

    return query
  }

  constructor(attributes = {}) {
    this._attributes = attributes
    this._changes = {}
  }

  attributes() {
    return Object.assign({}, this._attributes, this._changes)
  }

  _connection() {
    if (this.__connection) return this.__connection

    return this.constructor.connection()
  }

  _tableName() {
    if (this.__tableName) return this.__tableName

    return this.constructor.tableName()
  }

  readAttribute(attributeName) {
    if (attributeName in this._changes) return this._changes[attributeName]

    return this._attributes[attributeName]
  }

  async _createNewRecord() {
    if (!this.constructor.connection()["insertSql"]) {
      throw new Error(`No insertSql on ${this.constructor.connection().constructor.name}`)
    }

    const sql = this._connection().insertSql({
      tableName: this._tableName(),
      data: this.attributes()
    })

    const result = await this._connection().query(sql)
    const id = result.insertId

    await this._reloadWithId(id)
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

  async _reloadWithId(id) {
    const primaryKey = this.constructor.primaryKey()
    const whereObject = {}

    whereObject[primaryKey] = id

    const query = this.constructor.where(whereObject)
    const result = await query.first()

    console.log({result})

    throw new Error("stub")
  }

  async reload() {
    this._reloadWithId(this.readAttribute("id"))
  }
}
