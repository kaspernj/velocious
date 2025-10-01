import BelongsToInstanceRelationship from "./instance-relationships/belongs-to.js"
import BelongsToRelationship from "./relationships/belongs-to.js"
import Configuration from "../../configuration.js"
import FromTable from "../query/from-table.js"
import Handler from "../handler.js"
import HasManyRelationship from "./relationships/has-many.js"
import HasManyInstanceRelationship from "./instance-relationships/has-many.js"
import HasOneRelationship from "./relationships/has-one.js"
import HasOneInstanceRelationship from "./instance-relationships/has-one.js"
import * as inflection from "inflection"
import Query from "../query/index.js"
import ValidatorsPresence from "./validators/presence.js"
import ValidatorsUniqueness from "./validators/uniqueness.js"

class ValidationError extends Error {
  getModel() {
    return this._model
  }

  setModel(model) {
    this._model = model
  }

  getValidationErrors() {
    return this._validationErrors
  }

  setValidationErrors(validationErrors) {
    this._validationErrors = validationErrors
  }
}

class VelociousDatabaseRecord {
  static validatorTypes() {
    if (!this._validatorTypes) this._validatorTypes = {}

    return this._validatorTypes
  }

  static registerValidatorType(name, validatorClass) {
    this.validatorTypes()[name] = validatorClass
  }

  static getValidatorType(validatorName) {
    if (!(validatorName in this.validatorTypes())) throw new Error(`Validator type ${validatorName} not found`)

    return this.validatorTypes()[validatorName]
  }

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

      this.prototype[relationshipName] = function() {
        const relationship = this.getRelationshipByName(relationshipName)

        return relationship.loaded()
      }

      this.prototype[`build${inflection.camelize(relationshipName)}`] = function(attributes) {
        const instanceRelationship = this.getRelationshipByName(relationshipName)
        const record = instanceRelationship.build(attributes)

        const inverseOf = instanceRelationship.getRelationship().getInverseOf()

        if (inverseOf) {
          const inverseInstanceRelationship = record.getRelationshipByName(inverseOf)

          inverseInstanceRelationship.setAutoSave(false)

          if (inverseInstanceRelationship.getType() == "hasOne") {
            inverseInstanceRelationship.setLoaded(this)
          } else if (inverseInstanceRelationship.getType() == "hasMany") {
            inverseInstanceRelationship.addToLoaded(this)
          } else {
            throw new Error(`Unknown relationship type: ${inverseInstanceRelationship.getType()}`)
          }
        }

        return record
      }

      this.prototype[`load${inflection.camelize(relationshipName)}`] = async function() {
        await this.getRelationshipByName(relationshipName).load()
      }

      this.prototype[`set${inflection.camelize(relationshipName)}`] = function(model) {
        const relationship = this.getRelationshipByName(relationshipName)

        relationship.setLoaded(model)
        relationship.setDirty(true)
      }
    } else if (actualData.type == "hasMany") {
      relationship = new HasManyRelationship(actualData)

      this.prototype[relationshipName] = function() {
        return this.getRelationshipByName(relationshipName)
      }

      this.prototype[`load${inflection.camelize(relationshipName)}`] = async function() {
        await this.getRelationshipByName(relationshipName).load()
      }
    } else if (actualData.type == "hasOne") {
      relationship = new HasOneRelationship(actualData)

      this.prototype[relationshipName] = function() {
        return this.getRelationshipByName(relationshipName).loaded()
      }

      this.prototype[`build${inflection.camelize(relationshipName)}`] = function(attributes) {
        const instanceRelationship = this.getRelationshipByName(relationshipName)
        const record = instanceRelationship.build(attributes)

        const inverseOf = instanceRelationship.getRelationship().getInverseOf()

        if (inverseOf) {
          const inverseInstanceRelationship = record.getRelationshipByName(inverseOf)

          inverseInstanceRelationship.setAutoSave(false)
          inverseInstanceRelationship.setLoaded(this)
        }

        return record
      }

      this.prototype[`load${inflection.camelize(relationshipName)}`] = async function() {
        await this.getRelationshipByName(relationshipName).load()
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

  static getRelationshipNames() {
    return this.getRelationships().map((relationship) => relationship.getRelationshipName())
  }

  getRelationshipByName(relationshipName) {
    if (!this._instanceRelationships) this._instanceRelationships = {}

    if (!(relationshipName in this._instanceRelationships)) {
      const modelClassRelationship = this.constructor.getRelationshipByName(relationshipName)
      const relationshipType = modelClassRelationship.getType()
      let instanceRelationship

      if (relationshipType == "belongsTo") {
        instanceRelationship = new BelongsToInstanceRelationship({model: this, relationship: modelClassRelationship})
      } else if (relationshipType == "hasMany") {
        instanceRelationship = new HasManyInstanceRelationship({model: this, relationship: modelClassRelationship})
      } else if (relationshipType == "hasOne") {
        instanceRelationship = new HasOneInstanceRelationship({model: this, relationship: modelClassRelationship})
      } else {
        throw new Error(`Unknown relationship type: ${relationshipType}`)
      }

      this._instanceRelationships[relationshipName] = instanceRelationship
    }

    return this._instanceRelationships[relationshipName]
  }

  static belongsTo(relationshipName, options) {
    this._defineRelationship(relationshipName, Object.assign({type: "belongsTo"}, options))
  }

  static connection() {
    const databasePool = this._getConfiguration().getDatabasePool(this.getDatabaseIdentifier())
    const connection = databasePool.getCurrentConnection()

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

  static hasOne(relationshipName, options = {}) {
    return this._defineRelationship(relationshipName, Object.assign({type: "hasOne"}, options))
  }

  static humanAttributeName(attributeName) {
    const modelNameKey = inflection.underscore(this.constructor.name)

    return this._getConfiguration().getTranslator()(`velocious.database.record.attributes.${modelNameKey}.${attributeName}`, {defaultValue: inflection.camelize(attributeName)})
  }

  static getDatabaseType() { return this._databaseType }

  static async initializeRecord({configuration}) {
    if (!configuration) throw new Error(`No configuration given for ${this.name}`)

    this._configuration = configuration
    this._configuration.registerModelClass(this)
    this._databaseType = this.connection().getType()

    this._table = await this.connection().getTableByName(this.tableName())
    this._columns = await this._getTable().getColumns()
    this._columnsAsHash = {}
    this._columnNameToAttributeName = {}
    this._attributeNameToColumnName = {}

    for (const column of this._columns) {
      this._columnsAsHash[column.getName()] = column

      const camelizedColumnName = inflection.camelize(column.getName(), true)
      const camelizedColumnNameBigFirst = inflection.camelize(column.getName())

      this._attributeNameToColumnName[camelizedColumnName] = column.getName()
      this._columnNameToAttributeName[column.getName()] = camelizedColumnName

      this.prototype[camelizedColumnName] = function() {
        return this.readAttribute(camelizedColumnName)
      }

      this.prototype[`set${camelizedColumnNameBigFirst}`] = function(newValue) {
        return this._setColumnAttribute(camelizedColumnName, newValue)
      }

      this.prototype[`has${camelizedColumnNameBigFirst}`] = function() {
        let value = this[camelizedColumnName]()

        if (typeof value == "string") {
          value = value.trim()
        }

        if (value) {
          return true
        }

        return false
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

        this.prototype[name] = function() {
          const locale = this._getConfiguration().getLocale()

          return this._getTranslatedAttributeWithFallback(name, locale)
        }

        this.prototype[setterMethodName] = function(newValue) {
          const locale = this._getConfiguration().getLocale()

          return this._setTranslatedAttribute(name, locale, newValue)
        }

        for (const locale of locales) {
          const localeCamelized = inflection.camelize(locale)
          const getterMethodNameLocalized = `${name}${localeCamelized}`
          const setterMethodNameLocalized = `${setterMethodName}${localeCamelized}`

          this.prototype[getterMethodNameLocalized] = function() {
            return this._getTranslatedAttribute(name, locale)
          }

          this.prototype[setterMethodNameLocalized] = function(newValue) {
            return this._setTranslatedAttribute(name, locale, newValue)
          }
        }
      }
    }
  }

  static getDatabaseIdentifier() {
    return this._databaseIdentifier || "default"
  }

  static setDatabaseIdentifier(databaseIdentifier) {
    this._databaseIdentifier = databaseIdentifier
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
    if (!this.constructor._attributeNameToColumnName) throw new Error("No attribute-to-column mapping. Has record been initialized?")

    const columnName = this.constructor._attributeNameToColumnName[name]

    if (!columnName) throw new Error(`Couldn't figure out column name for attribute: ${attributeName}`)

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

  static async nextPrimaryKey() {
    const primaryKey = this.primaryKey()
    const tableName = this.tableName()
    const connection = this.connection()
    const newestRecord = await this.order(`${connection.quoteTable(tableName)}.${connection.quoteColumn(primaryKey)}`).last()

    if (newestRecord) {
      return newestRecord.id() + 1
    } else {
      return 1
    }
  }

  static setPrimaryKey(primaryKey) {
    this._primaryKey = primaryKey
  }

  static primaryKey() {
    if (this._primaryKey) return this._primaryKey

    return "id"
  }

  async save() {
    const isNewRecord = this.isNewRecord()
    let result

    await this.constructor._getConfiguration().ensureConnections(async () => {
      await this._runValidations()

      await this.constructor.transaction(async () => {
        // If any belongs-to-relationships was saved, then updated-at should still be set on this record.
        const {savedCount} = await this._autoSaveBelongsToRelationships()

        if (this.isPersisted()) {
          // If any has-many-relationships will be saved, then updated-at should still be set on this record.
          const autoSaveHasManyrelationships = this._autoSaveHasManyAndHasOneRelationshipsToSave()

          if (this._hasChanges() || savedCount > 0 || autoSaveHasManyrelationships.length > 0) {
            result = await this._updateRecordWithChanges()
          }
        } else {
          result = await this._createNewRecord()
        }

        await this._autoSaveHasManyAndHasOneRelationships({isNewRecord})
      })
    })

    return result
  }

  async _autoSaveBelongsToRelationships() {
    let savedCount = 0

    for (const relationshipName in this._instanceRelationships) {
      const instanceRelationship = this._instanceRelationships[relationshipName]

      if (instanceRelationship.getType() != "belongsTo") {
        continue
      }

      if (instanceRelationship.getAutoSave() === false) {
        continue
      }

      const model = instanceRelationship.loaded()

      if (model?.isChanged()) {
        await model.save()

        const foreignKey = instanceRelationship.getForeignKey()

        this.setAttribute(foreignKey, model.id())

        instanceRelationship.setPreloaded(true)
        instanceRelationship.setDirty(false)

        savedCount++
      }
    }

    return {savedCount}
  }

  _autoSaveHasManyAndHasOneRelationshipsToSave() {
    const relationships = []

    for (const relationshipName in this._instanceRelationships) {
      const instanceRelationship = this._instanceRelationships[relationshipName]

      if (instanceRelationship.getType() != "hasMany" && instanceRelationship.getType() != "hasOne") {
        continue
      }

      if (instanceRelationship.getAutoSave() === false) {
        continue
      }

      let loaded

      if (instanceRelationship.getType() == "hasOne") {
        const hasOneLoaded = instanceRelationship.getLoadedOrNull()

        if (hasOneLoaded) {
          loaded = [hasOneLoaded]
        } else {
          continue
        }
      } else {
        loaded = instanceRelationship.getLoadedOrNull()
      }

      let useRelationship = false

      if (loaded) {
        for (const model of loaded) {
          const foreignKey = instanceRelationship.getForeignKey()

          model.setAttribute(foreignKey, this.id())

          if (model.isChanged()) {
            useRelationship = true
            continue
          }
        }
      }

      if (useRelationship) relationships.push(instanceRelationship)
    }

    return relationships
  }

  async _autoSaveHasManyAndHasOneRelationships({isNewRecord}) {
    for (const instanceRelationship of this._autoSaveHasManyAndHasOneRelationshipsToSave()) {
      let loaded = instanceRelationship.getLoadedOrNull()

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
    if (!this._tableName) this._tableName = inflection.underscore(inflection.pluralize(this.name))

    return this._tableName
  }

  static setTableName(tableName) {
    this._tableName = tableName
  }

  static async transaction(callback) {
    const useTransactions = this.connection().getArgs().record?.transactions

    if (useTransactions !== false) {
      await this.connection().transaction(callback)
    } else {
      return await callback()
    }
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

    Object.defineProperty(TranslationClass, "name", {value: className})
    TranslationClass.setTableName(this.getTranslationsTableName())
    TranslationClass.belongsTo(belongsTo)

    this._translationClass = TranslationClass

    return this._translationClass
  }

  static getTranslationsTableName() {
    const tableNameParts = this.tableName().split("_")

    tableNameParts[tableNameParts.length - 1] = inflection.singularize(tableNameParts[tableNameParts.length - 1])

    return `${tableNameParts.join("_")}_translations`
  }

  static async hasTranslationsTable() {
    try {
      await this.connection().getTableByName(this.getTranslationsTableName())

      return true
    } catch {
      return false
    }
  }

  static async validates(attributeName, validators) {
    for (const validatorName in validators) {
      const validatorArgs = validators[validatorName]
      const ValidatorClass = this.getValidatorType(validatorName)
      const validator = new ValidatorClass({attributeName, args: validatorArgs})

      if (!this._validators) this._validators = {}
      if (!(attributeName in this._validators)) this._validators[attributeName] = []

      this._validators[attributeName].push(validator)
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

  static async count() {
    return this._newQuery().count()
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

  static async findByOrFail(...args) {
    return this._newQuery().findByOrFail(...args)
  }

  static async findOrCreateBy(...args) {
    return this._newQuery().findOrCreateBy(...args)
  }

  static async findOrInitializeBy(...args) {
    return this._newQuery().findOrInitializeBy(...args)
  }

  static async first() {
    return this._newQuery().first()
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

  static select(...args) {
    return this._newQuery().select(...args)
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

        if (instanceRelationship.getAutoSave() === false) {
          continue
        }

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
    const columnName = this.constructor._attributeNameToColumnName[attributeName]

    if (!columnName) throw new Error(`Couldn't figure out column name for attribute: ${attributeName} from these mappings: ${Object.keys(this.constructor._attributeNameToColumnName)}`)

    return this.readColumn(columnName)
  }

  readColumn(attributeName) {
    const column = this.constructor.getColumns().find((column) => column.getName() == attributeName)
    let result

    if (attributeName in this._changes) {
      result = this._changes[attributeName]
    } else if (attributeName in this._attributes) {
      result = this._attributes[attributeName]
    } else if (this.isPersisted()) {
      throw new Error(`No such attribute or not selected ${this.constructor.name}#${attributeName}`)
    }

    if (column && this.constructor.getDatabaseType() == "sqlite") {
      if (column.getType() == "date" || column.getType() == "datetime") {
        result = new Date(Date.parse(result))
      }
    }

    return result
  }

  _belongsToChanges() {
    const belongsToChanges = {}

    if (this._instanceRelationships) {
      for (const relationshipName in this._instanceRelationships) {
        const relationship = this._instanceRelationships[relationshipName]

        if (relationship.getType() == "belongsTo" && relationship.getDirty()) {
          belongsToChanges[relationship.getForeignKey()] = relationship.loaded()?.id()
        }
      }
    }

    return belongsToChanges
  }

  async _createNewRecord() {
    if (!this.constructor.connection()["insertSql"]) {
      throw new Error(`No insertSql on ${this.constructor.connection().constructor.name}`)
    }

    const createdAtColumn = this.constructor.getColumns().find((column) => column.getName() == "created_at")
    const updatedAtColumn = this.constructor.getColumns().find((column) => column.getName() == "updated_at")
    const data = Object.assign({}, this._belongsToChanges(), this.attributes())
    const currentDate = new Date()

    if (createdAtColumn) data.created_at = currentDate
    if (updatedAtColumn) data.updated_at = currentDate

    const sql = this._connection().insertSql({
      returnLastInsertedColumnName: this.constructor.primaryKey(),
      tableName: this._tableName(),
      data
    })
    const insertResult = await this._connection().query(sql)
    let id

    if (insertResult && insertResult[0]?.lastInsertID) {
      id = insertResult[0]?.lastInsertID
    } else {
      id = await this._connection().lastInsertID()
    }

    await this._reloadWithId(id)
    this.setIsNewRecord(false)

    // Mark all relationships as preloaded, since we don't expect anything to have magically appeared since we created the record.
    for (const relationship of this.constructor.getRelationships()) {
      const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName())

      if (instanceRelationship.getType() == "hasMany" && instanceRelationship.getLoadedOrNull() === null) {
        instanceRelationship.setLoaded([])
      }

      instanceRelationship.setPreloaded(true)
    }
  }

  async _updateRecordWithChanges() {
    const conditions = {}

    conditions[this.constructor.primaryKey()] = this.id()

    const changes = Object.assign({}, this._belongsToChanges(), this._changes)
    const updatedAtColumn = this.constructor.getColumns().find((column) => column.getName() == "updated_at")
    const currentDate = new Date()

    if (updatedAtColumn) changes.updated_at = currentDate

    if (Object.keys(changes).length > 0) {
      const sql = this._connection().updateSql({
        tableName: this._tableName(),
        data: changes,
        conditions
      })
      await this._connection().query(sql)
      await this._reloadWithId(this.id())
    }
  }

  id() { return this.readAttribute(this.constructor._columnNameToAttributeName[this.constructor.primaryKey()]) }
  isPersisted() { return !this._isNewRecord }
  isNewRecord() { return this._isNewRecord }

  setIsNewRecord(newIsNewRecord) {
    this._isNewRecord = newIsNewRecord
  }

  async _reloadWithId(id) {
    const primaryKey = this.constructor.primaryKey()
    const whereObject = {}

    whereObject[primaryKey] = id

    const query = this.constructor.where(whereObject)
    const reloadedModel = await query.first()

    if (!reloadedModel) throw new Error(`${this.constructor.name}#${id} couldn't be reloaded - record didn't exist`)

    this._attributes = reloadedModel.attributes()
    this._changes = {}
  }

  async reload() {
    this._reloadWithId(this.readAttribute("id"))
  }

  async _runValidations() {
    this._validationErrors = {}

    const validators = this.constructor._validators

    if (validators) {
      for (const attributeName in validators) {
        const attributeValidators = validators[attributeName]

        for (const validator of attributeValidators) {
          await validator.validate({model: this, attributeName})
        }
      }
    }

    if (Object.keys(this._validationErrors).length > 0) {
      const validationError = new ValidationError(this.fullErrorMessages().join(". "))

      validationError.setValidationErrors(this._validationErrors)
      validationError.setModel(this)

      throw validationError
    }
  }

  fullErrorMessages() {
    const validationErrorMessages = []

    if (this._validationErrors) {
      for (const attributeName in this._validationErrors) {
        for (const validationError of this._validationErrors[attributeName]) {
          const message = `${this.constructor.humanAttributeName(attributeName)} ${validationError.message}`

          validationErrorMessages.push(message)
        }
      }
    }

    return validationErrorMessages
  }

  async update(attributesToAssign) {
    if (attributesToAssign) this.assign(attributesToAssign)

    await this.save()
  }
}

VelociousDatabaseRecord.registerValidatorType("presence", ValidatorsPresence)
VelociousDatabaseRecord.registerValidatorType("uniqueness", ValidatorsUniqueness)

export {ValidationError}
export default VelociousDatabaseRecord
