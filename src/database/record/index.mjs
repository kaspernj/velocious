import Configuration from "../../configuration.mjs"
import {digg} from "diggerize"
import Handler from "../handler.mjs"
import HasManyRelationship from "./has-many-relationship.mjs"
import * as inflection from "inflection"
import Query from "../query/index.mjs"
import RecordNotFoundError from "./record-not-found-error.mjs"

export default class VelociousDatabaseRecord {
  static _defineRelationship(relationshipName, data) {
    if (!this._relationships) this._relationships = {}
    if (relationshipName in this._relationships) throw new Error(`Relationship ${relationshipName} already exists`)

    this._relationships[relationshipName] = data

    this.prototype[relationshipName] = function () {
      if (!this._instanceRelationships) this._instanceRelationships = {}
      if (!(relationshipName in this._instanceRelationships)) {
        let relationship

        if (data.type == "hasMany") {
          relationship = new HasManyRelationship({klass: data.klass, model: this, relationshipName})
        } else {
          throw new Error(`Unknown relationship type: ${data.type}`)
        }

        this._instanceRelationships[relationshipName] = relationship
      }

      return this._instanceRelationships[relationshipName]
    }
  }

  static belongsTo(relationshipName) {
    this._defineRelationship(relationshipName, {type: "belongsTo"})
  }

  static connection() {
    const connection = Configuration.current().getDatabasePoolType().current().getCurrentConnection()

    if (!connection) throw new Error("No connection?")

    return connection
  }

  static async find(recordId) {
    const conditions = {}

    conditions[this.primaryKey()] = recordId

    const query = this.where(conditions)
    const record = await query.first()

    if (!record) {
      throw new RecordNotFoundError(`Couldn't find ${this.name} with '${this.primaryKey()}'=${recordId}`)
    }

    return record
  }

  static async findBy(conditions) {
    return await this.where(conditions).first()
  }

  static async findOrInitializeBy(conditions) {
    const record = await this.findBy(conditions)

    if (record) return record

    const newRecord = new this(conditions)

    return newRecord
  }

  static hasMany(relationshipName) {
    this._defineRelationship(relationshipName, {type: "hasMany"})
  }

  static async initializeRecord() {
    this._table = await this.connection().getTableByName(this.tableName())
    this._columns = await this._getTable().getColumns()
    this._columnsAsHash = {}

    for (const column of this._columns) {
      this._columnsAsHash[column.getName()] = column

      const camelizedColumnName = inflection.camelize(column.getName(), true)
      const camelizedColumnNameBigFirst = inflection.camelize(column.getName())
      const getterMethodName = `get${camelizedColumnNameBigFirst}`
      const setterMethodName = `set${camelizedColumnNameBigFirst}`

      this.prototype[getterMethodName] = function () {
        return this.getAttribute(camelizedColumnName)
      }

      this.prototype[setterMethodName] = function (newValue) {
        return this._setColumnAttribute(camelizedColumnName, newValue)
      }
    }

    this._defineTranslationMethods()
    this._initialized = true
  }

  static isInitialized() {
    if (this._initialized) return true

    return false
  }

  getAttribute(name) {
    const columnName = inflection.underscore(name)

    if (!(columnName in this._attributes)) throw new Error(`${this.constructor.name}#${name} attribute hasn't been loaded yet in ${Object.keys(this._attributes).join(", ")}`)

    return this._attributes[columnName]
  }

  setAttribute(name, newValue) {
    const setterName = `set${inflection.camelize(name)}`

    if (!this.constructor.isInitialized()) throw new Error(`${this.constructor.name} model isn't initialized yet`)
    if (!(setterName in this)) throw new Error(`No such setter method: ${this.constructor.name}#${setterName}`)

    this[setterName](newValue)
  }

  _setColumnAttribute(name, newValue) {
    const columnName = inflection.underscore(name)

    if (this._attributes[columnName] != newValue) {
      this._changes[columnName] = newValue
    }
  }

  static getColumns() {
    if (!this._columns) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._columns
  }

  static _getTable() {
    if (!this._table) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._table
  }

  static async last() {
    const query = this._newQuery().order(this.primaryKey())
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

  static setTableName(tableName) {
    this._tableName = tableName
  }

  static translates(name) {
    if (!this._translations) this._translations = {}
    if (name in this._translations) throw new Error(`Translation already exists: ${name}`)

    this._translations[name] = {}
    this._defineRelationship("translations", {klass: this.getTranslationClass(), type: "hasMany"})
  }

  static getTranslationClass() {
    if (this._translationClass) return this._translationClass

    const className = `${this.name}Translation`
    const TranslationClass = class Translation extends VelociousDatabaseRecord {}
    const belongsTo = `${inflection.camelize(inflection.singularize(this.tableName()), true)}`
    const tableName = `${inflection.singularize(this.tableName())}_translations`

    Object.defineProperty(TranslationClass, "name", {value: className})
    TranslationClass.setTableName(tableName)
    TranslationClass.belongsTo(belongsTo)

    this._translationClass = TranslationClass

    return this._translationClass
  }

  static getTranslationsTableName() {
    return `${inflection.singularize(this.tableName())}_translations`
  }

  static async hasTranslationsTable() {
    try {
      await this.connection().getTableByName(this.getTranslationsTableName())

      return true
    } catch {
      return false
    }
  }

  static _defineTranslationMethods() {
    const locales = Configuration.current().getLocales()

    if (this._translations) {
      for (const name in this._translations) {
        const nameCamelized = inflection.camelize(name)
        const getterMethodName = `get${nameCamelized}`
        const setterMethodName = `set${nameCamelized}`

        this.prototype[getterMethodName] = function () {
          const locale = Configuration.current().getLocale()

          return this._getTranslatedAttribute(name, locale)
        }

        this.prototype[setterMethodName] = function (newValue) {
          const locale = Configuration.current().getLocale()

          return this._setTranslatedAttribute(name, locale, newValue)
        }

        for (const locale of locales) {
          const localeCamelized = inflection.camelize(locale)
          const getterMethodNameLocalized = `${getterMethodName}${localeCamelized}`
          const setterMethodNameLocalized = `${setterMethodName}${localeCamelized}`

          this.prototype[getterMethodNameLocalized] = function () {
            return this._getTranslatedAttribute(name, locale)
          }

          this.prototype[setterMethodNameLocalized] = function (newValue) {
            return this._setTranslatedAttribute(name, locale, newValue)
          }
        }
      }
    }
  }

  _getTranslatedAttribute(name, locale) {
    const translation = this.translations().loaded().find((translation) => translation.getLocale() == locale)

    if (translation) {
      return translation[name]()
    }
  }

  _setTranslatedAttribute(name, locale, newValue) {
    let translation = this.translations().loaded().find((translation) => translation.getLocale() == locale)

    if (!translation) {
      translation = this.translations().build({locale})
    }

    const assignments = {}

    assignments[name] = newValue

    translation.assign(assignments)
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
    this._isNewRecord = true
  }

  assign(attributesToAssign) {
    for (const attributeToAssign in attributesToAssign) {
      this.setAttribute(attributeToAssign, attributesToAssign[attributeToAssign])
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

  isChanged() {
    if (Object.keys(this._changes).length > 0) {
      return true
    }

    return false
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
    await this._connection().query(sql)
    const id = await this._connection().lastInsertID()

    await this._reloadWithId(id)
    this.setIsNewRecord(false)
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

  id = () => this.readAttribute(this.constructor.primaryKey())
  isPersisted = () => !this._isNewRecord
  isNewRecord = () => _isNewRecord

  setIsNewRecord(newIsNewRecord) {
    this._isNewRecord = newIsNewRecord
  }

  async _reloadWithId(id) {
    const primaryKey = this.constructor.primaryKey()
    const whereObject = {}

    whereObject[primaryKey] = id

    const query = this.constructor.where(whereObject)
    const reloadedModel = await query.first()

    if (!reloadedModel) throw new Error(`${this.constructor.name}#${this.id()} couldn't be reloaded - record didn't exist`)

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
