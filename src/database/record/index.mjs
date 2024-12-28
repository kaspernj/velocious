import Configuration from "../../configuration.mjs"
import Handler from "../handler.mjs"
import inflection from "inflection"
import Query from "../query/index.mjs"
import RecordNotFoundError from "./record-not-found-error.mjs"

export default class VelociousDatabaseRecord {
  static connection() {
    const connection = Configuration.current().getDatabasePoolType().current().getCurrentConnection()

    if (!connection) throw new Error("No connection?")

    return connection
  }

  static async find(recordId) {
    const conditions = {}

    conditions[this.primaryKey()] = recordId

    const record = await this.where(conditions).first()

    if (!record) {
      throw new RecordNotFoundError(`Couldn't find ${this.name} with '${this.primaryKey()}'=${recordId}`)
    }

    return record
  }

  static async last() {
    const query = this._newQuery().order(this.primaryKey()).limit(1)
    const record = await query.last()

    return record
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

  assign(attributesToAssign) {
    for (const attributeToAssign in attributesToAssign) {
      this._changes[attributeToAssign] = attributesToAssign[attributeToAssign]
    }
  }

  attributes() {
    return Object.assign({}, this._attributes, this._changes)
  }

  _connection() {
    if (this.__connection) return this.__connection

    return this.constructor.connection()
  }

  async destroy() {
    const conditions = {}

    conditions[this.constructor.primaryKey()] = this.id()

    const sql = this._connection().deleteSql({
      conditions,
      tableName: this._tableName()
    })

    await this._connection().query(sql)
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
    const conditions = {}

    conditions[this.constructor.primaryKey()] = this.id()

    const sql = this._connection().updateSql({
      tableName: this._tableName(),
      data: this._changes,
      conditions
    })
    await this._connection().query(sql)
    await this._reloadWithId(this.id())
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
    const reloadedModel = await query.first()

    this._attributes = reloadedModel.attributes()
    this._changes = {}
  }

  async reload() {
    this._reloadWithId(this.readAttribute("id"))
  }

  async update(attributesToAssign) {
    if (attributesToAssign) this.assign(attributesToAssign)

    await this.save()
  }
}
