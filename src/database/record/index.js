import BelongsToInstanceRelationship from "./instance-relationships/belongs-to.js"
import BelongsToRelationship from "./relationships/belongs-to.js"
import Configuration from "../../configuration.js"
import FromTable from "../query/from-table.js"
import Handler from "../handler.js"
import HasManyRelationship from "./relationships/has-many.js"
import HasManyInstanceRelationship from "./instance-relationships/has-many.js"
import * as inflection from "inflection"
import Query from "../query/index.js"

export default class VelociousDatabaseRecord {
  static _relationshipExists(relationshipName) {
    if (this._relationships && relationshipName in this._relationships) {
      return true
    }

    return false
  }

  static _defineRelationship(relationshipName, data) {
    if (!relationshipName) throw new Error(`Invalid relationship name given: ${relationshipName}`)
    if (!this._relationships) this._relationships = {}
    if (this._relationshipExists(relationshipName)) throw new Error(`Relationship ${relationshipName} already exists`)

    const actualData = Object.assign(
      {
        modelClass: this,
        relationshipName,
        type: "hasMany"
      },
      data
    )

    if (!actualData.className && !actualData.klass) {
      actualData.className = inflection.camelize(inflection.singularize(relationshipName))
    }

    let relationship

    if (actualData.type == "belongsTo") {
      relationship = new BelongsToRelationship(actualData)

      const buildMethodName = `build${inflection.camelize(relationshipName)}`

      this.prototype[relationshipName] = function () {
        const relationship = this.getRelationshipByName(relationshipName)

        return relationship.loaded()
      }

      this.prototype[buildMethodName] = function (attributes) {
        const relationship = this.getRelationshipByName(relationshipName)
        const record = relationship.build(attributes)

        return record
      }
    } else if (actualData.type == "hasMany") {
      relationship = new HasManyRelationship(actualData)

      this.prototype[relationshipName] = function () {
        return this.getRelationshipByName(relationshipName)
      }
    } else {
      throw new Error(`Unknown relationship type: ${actualData.type}`)
    }

    this._relationships[relationshipName] = relationship
  }

  static getRelationshipByName(relationshipName) {
    if (!this._relationships) this._relationships = {}

    const relationship = this._relationships[relationshipName]

    if (!relationship) throw new Error(`No relationship by that name: ${relationshipName}`)

    return relationship
  }

  static getRelationships() {
    if (this._relationships) return Object.values(this._relationships)

    return []
  }

  getRelationshipByName(relationshipName) {
    if (!this._instanceRelationships) this._instanceRelationships = {}

    if (!(relationshipName in this._instanceRelationships)) {
      const modelClassRelationship = this.constructor.getRelationshipByName(relationshipName)
      let instanceRelationship

      if (modelClassRelationship.getType() == "belongsTo") {
        instanceRelationship = new BelongsToInstanceRelationship({model: this, relationship: modelClassRelationship})
      } else if (modelClassRelationship.getType() == "hasMany") {
        instanceRelationship = new HasManyInstanceRelationship({model: this, relationship: modelClassRelationship})
      } else {
        throw new Error(`Unknown relationship type: ${modelClassRelationship.getType()}`)
      }

      this._instanceRelationships[relationshipName] = instanceRelationship
    }

    return this._instanceRelationships[relationshipName]
  }

  static belongsTo(relationshipName) {
    this._defineRelationship(relationshipName, {type: "belongsTo"})
  }

  static connection() {
    const connection = this._getConfiguration().getDatabasePoolType().current().getCurrentConnection()

    if (!connection) throw new Error("No connection?")

    return connection
  }

  static async create(attributes) {
    const record = new this(attributes)

    await record.save()

    return record
  }

  static _getConfiguration() {
    if (!this._configuration) {
      this._configuration = Configuration.current()

      if (!this._configuration) {
        throw new Error("Configuration hasn't been set (model class probably hasn't been initialized)")
      }
    }

    return this._configuration
  }

  _getConfiguration() {
    return this.constructor._getConfiguration()
  }

  static hasMany(relationshipName, options = {}) {
    return this._defineRelationship(relationshipName, Object.assign({type: "hasMany"}, options))
  }

  static async initializeRecord({configuration}) {
    if (!configuration) throw new Error(`No configuration given for ${this.name}`)

    this._configuration = configuration
    this._configuration.registerModelClass(this)

    this._table = await this.connection().getTableByName(this.tableName())
    this._columns = await this._getTable().getColumns()
    this._columnsAsHash = {}

    for (const column of this._columns) {
      this._columnsAsHash[column.getName()] = column

      const camelizedColumnName = inflection.camelize(column.getName(), true)
      const camelizedColumnNameBigFirst = inflection.camelize(column.getName())
      const setterMethodName = `set${camelizedColumnNameBigFirst}`

      this.prototype[camelizedColumnName] = function () {
        return this.readAttribute(camelizedColumnName)
      }

      this.prototype[setterMethodName] = function (newValue) {
        return this._setColumnAttribute(camelizedColumnName, newValue)
      }
    }

    await this._defineTranslationMethods()
    this._initialized = true
  }

  static isInitialized() {
    if (this._initialized) return true

    return false
  }

  static async _defineTranslationMethods() {
    if (this._translations) {
      const locales = this._getConfiguration().getLocales()

      if (!locales) throw new Error("Locales hasn't been set in the configuration")

      await this.getTranslationClass().initializeRecord({configuration: this._getConfiguration()})

      for (const name in this._translations) {
        const nameCamelized = inflection.camelize(name)
        const setterMethodName = `set${nameCamelized}`

        this.prototype[name] = function () {
          const locale = this._getConfiguration().getLocale()

          return this._getTranslatedAttributeWithFallback(name, locale)
        }

        this.prototype[setterMethodName] = function (newValue) {
          const locale = this._getConfiguration().getLocale()

          return this._setTranslatedAttribute(name, locale, newValue)
        }

        for (const locale of locales) {
          const localeCamelized = inflection.camelize(locale)
          const getterMethodNameLocalized = `${name}${localeCamelized}`
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

  getAttribute(name) {
    const columnName = inflection.underscore(name)

    if (!this.isNewRecord() && !(columnName in this._attributes)) {
      throw new Error(`${this.constructor.name}#${name} attribute hasn't been loaded yet in ${Object.keys(this._attributes).join(", ")}`)
    }

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

  static async insertMultiple(columns, rows) {
    return await this.connection().insertMultiple(this.tableName(), columns, rows)
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
    let result

    const isNewRecord = this.isNewRecord()

    await this._autoSaveBelongsToRelationships()

    if (this.isPersisted()) {
      result = await this._updateRecordWithChanges()
    } else {
      result = await this._createNewRecord()
    }

    await this._autoSaveHasManyRelationships({isNewRecord})

    return result
  }

  async _autoSaveBelongsToRelationships() {
    for (const relationshipName in this._instanceRelationships) {
      const instanceRelationship = this._instanceRelationships[relationshipName]

      if (instanceRelationship.getType() != "belongsTo") {
        continue
      }

      const model = instanceRelationship.loaded()

      if (model?.isChanged()) {
        await model.save()

        const foreignKey = instanceRelationship.getForeignKey()

        this.setAttribute(foreignKey, model.id())
        instanceRelationship.setPreloaded(true)
      }
    }
  }

  async _autoSaveHasManyRelationships({isNewRecord}) {
    for (const relationshipName in this._instanceRelationships) {
      const instanceRelationship = this._instanceRelationships[relationshipName]

      if (instanceRelationship.getType() != "hasMany") {
        continue
      }

      let loaded = instanceRelationship._loaded

      if (!Array.isArray(loaded)) loaded = [loaded]

      for (const model of loaded) {
        const foreignKey = instanceRelationship.getForeignKey()

        model.setAttribute(foreignKey, this.id())

        if (model.isChanged()) {
          await model.save()
        }
      }

      if (isNewRecord) {
        instanceRelationship.setPreloaded(true)
      }
    }
  }

  static tableName() {
    return inflection.underscore(inflection.pluralize(this.name))
  }

  static setTableName(tableName) {
    this._tableName = tableName
  }

  static translates(...names) {
    for (const name of names) {
      if (!this._translations) this._translations = {}
      if (name in this._translations) throw new Error(`Translation already exists: ${name}`)

      this._translations[name] = {}

      if (!this._relationshipExists("translations")) {
        this._defineRelationship("translations", {klass: this.getTranslationClass(), type: "hasMany"})
      }
    }
  }

  static getTranslationClass() {
    if (this._translationClass) return this._translationClass
    if (this.tableName().endsWith("_translations")) throw new Error("Trying to define a translations class for a translation class")

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

  _getTranslatedAttribute(name, locale) {
    const translation = this.translations().loaded().find((translation) => translation.locale() == locale)

    if (translation) {
      return translation[name]()
    }
  }

  _getTranslatedAttributeWithFallback(name, locale) {
    let localesInOrder
    const fallbacks = this._getConfiguration().getLocaleFallbacks()

    if (fallbacks && locale in fallbacks) {
      localesInOrder = fallbacks[locale]
    } else {
      localesInOrder = [locale]
    }

    for (const fallbackLocale of localesInOrder) {
      const result = this._getTranslatedAttribute(name, fallbackLocale)

      if (result && result.trim() != "") {
        return result
      }
    }
  }

  _setTranslatedAttribute(name, locale, newValue) {
    let translation = this.translations().loaded()?.find((translation) => translation.locale() == locale)

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

    return query.from(new FromTable({driver: this.connection(), tableName: this.tableName()}))
  }

  static orderableColumn() {
    // FIXME: Allow to change to 'created_at' if using UUID?

    return this.primaryKey()
  }

  static all() {
    return this._newQuery()
  }

  static async destroyAll(...args) {
    return this._newQuery().destroyAll(...args)
  }

  static async find(...args) {
    return this._newQuery().find(...args)
  }

  static async findBy(...args) {
    return this._newQuery().findBy(...args)
  }

  static async findOrCreateBy(...args) {
    return this._newQuery().findOrCreateBy(...args)
  }

  static async findOrInitializeBy(...args) {
    return this._newQuery().findOrInitializeBy(...args)
  }

  static joins(...args) {
    return this._newQuery().joins(...args)
  }

  static limit(...args) {
    return this._newQuery().limit(...args)
  }

  static order(...args) {
    return this._newQuery().order(...args)
  }

  static preload(...args) {
    return this._newQuery().preload(...args)
  }

  static toArray(...args) {
    return this._newQuery().toArray(...args)
  }

  static where(...args) {
    return this._newQuery().where(...args)
  }

  constructor(changes = {}) {
    this._attributes = {}
    this._changes = {}
    this._isNewRecord = true
    this._relationships = {}

    for (const key in changes) {
      this.setAttribute(key, changes[key])
    }
  }

  loadExistingRecord(attributes) {
    this._attributes = attributes
    this._isNewRecord = false
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
    for (const relationship of this.constructor.getRelationships()) {
      if (relationship.getDependent() != "destroy") {
        continue
      }

      const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName())
      let models

      if (instanceRelationship.getType() == "belongsTo") {
        if (!instanceRelationship.isLoaded()) {
          await instanceRelationship.load()
        }

        const model = instanceRelationship.loaded()

        models = [model]
      } else if (instanceRelationship.getType() == "hasMany") {
        if (!instanceRelationship.isLoaded()) {
          await instanceRelationship.load()
        }

        models = instanceRelationship.loaded()
      } else {
        throw new Error(`Unhandled relationship type: ${instanceRelationship.getType()}`)
      }

      for (const model of models) {
        if (model.isPersisted()) {
          await model.destroy()
        }
      }
    }

    const conditions = {}

    conditions[this.constructor.primaryKey()] = this.id()

    const sql = this._connection().deleteSql({
      conditions,
      tableName: this._tableName()
    })

    await this._connection().query(sql)
  }

  _hasChanges = () => Object.keys(this._changes).length > 0

  isChanged() {
    if (this.isNewRecord() || this._hasChanges()){
      return true
    }

    // Check if a loaded sub-model of a relationship is changed and should be saved along with this model.
    if (this._instanceRelationships) {
      for (const instanceRelationshipName in this._instanceRelationships) {
        const instanceRelationship = this._instanceRelationships[instanceRelationshipName]
        let loaded = instanceRelationship._loaded

        if (!loaded) continue
        if (!Array.isArray(loaded)) loaded = [loaded]

        for (const model of loaded) {
          if (model.isChanged()) {
            return true
          }
        }
      }
    }

    return false
  }

  changes() {
    const changes = {}

    for (const changeKey in this._changes) {
      const changeValue = this._changes[changeKey]

      changes[changeKey] = [this._attributes[changeKey], changeValue]
    }

    return changes
  }

  _tableName() {
    if (this.__tableName) return this.__tableName

    return this.constructor.tableName()
  }

  readAttribute(attributeName) {
    const attributeNameUnderscore = inflection.underscore(attributeName)

    if (attributeNameUnderscore in this._changes) return this._changes[attributeNameUnderscore]

    if (!(attributeNameUnderscore in this._attributes) && this.isPersisted()) {
      throw new Error(`No such attribute or not selected ${this.constructor.name}#${attributeName}`)
    }

    return this._attributes[attributeNameUnderscore]
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

    // Mark all relationships as preloaded, since we don't expect anything to have magically appeared since we created the record.
    for (const relationship of this.constructor.getRelationships()) {
      const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName())

      instanceRelationship.setPreloaded(true)
    }
  }

  async _updateRecordWithChanges() {
    if (!this._hasChanges()) return

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
  isNewRecord = () => this._isNewRecord

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
