// @ts-check

/**
 * @typedef {{type: string, message: string}} ValidationErrorObjectType
 */

import BelongsToInstanceRelationship from "./instance-relationships/belongs-to.js"
import BelongsToRelationship from "./relationships/belongs-to.js"
import Configuration from "../../configuration.js"
import FromTable from "../query/from-table.js"
import Handler from "../handler.js"
import HasManyInstanceRelationship from "./instance-relationships/has-many.js"
import HasManyRelationship from "./relationships/has-many.js"
import HasOneInstanceRelationship from "./instance-relationships/has-one.js"
import HasOneRelationship from "./relationships/has-one.js"
import * as inflection from "inflection"
import ModelClassQuery from "../query/model-class-query.js"
import restArgsError from "../../utils/rest-args-error.js"
import singularizeModelName from "../../utils/singularize-model-name.js"
import ValidatorsPresence from "./validators/presence.js"
import ValidatorsUniqueness from "./validators/uniqueness.js"
import UUID from "pure-uuid"

class ValidationError extends Error {
  /**
   * @returns {VelociousDatabaseRecord}
   */
  getModel() {
    if (!this._model) throw new Error("Model hasn't been set")

    return this._model
  }

  /**
   * @param {VelociousDatabaseRecord} model
   * @returns {void}
   */
  setModel(model) {
    this._model = model
  }

  /** @returns {Record<string, ValidationErrorObjectType[]>} */
  getValidationErrors() {
    if (!this._validationErrors) throw new Error("Validation errors hasn't been set")

    return this._validationErrors
  }

  /** @param {Record<string, ValidationErrorObjectType[]>} validationErrors */
  setValidationErrors(validationErrors) {
    this._validationErrors = validationErrors
  }
}

class VelociousDatabaseRecord {
  static getAttributeNameToColumnNameMap() {
    if (!this._attributeNameToColumnName) {
      /** @type {Record<string, string>} */
      this._attributeNameToColumnName = {}
    }

    return this._attributeNameToColumnName
  }

  static getColumnNameToAttributeNameMap() {
    if (!this._columnNameToAttributeName) {
      /** @type {Record<string, string>} */
      this._columnNameToAttributeName = {}
    }

    return this._columnNameToAttributeName
  }

  static getTranslationsMap() {
    if (!this._translations) {
      /** @type {Record<string, object>} */
      this._translations = {}
    }

    return this._translations
  }

  static getValidatorsMap() {
    if (!this._validators) {
      /** @type {Record<string, import("./validators/base.js").default[]>} */
      this._validators = {}
    }

    return this._validators
  }

  static getValidatorTypesMap() {
    if (!this._validatorTypes) {
      /** @type {Record<string, typeof import("./validators/base.js").default>} */
      this._validatorTypes = {}
    }

    return this._validatorTypes
  }

  /** @type {Record<string, any>} */
  _attributes = {}

  /** @type {Record<string, any>} */
  _changes = {}

  /** @type {Record<string, import("../drivers/base-column.js").default>} */
  _columnsAsHash = {}

  /** @type {import("../drivers/base.js").default | undefined} */
  __connection = undefined

  /** @type {Record<string, import("./instance-relationships/base.js").default>} */
  _instanceRelationships = {}

  /** @type {string | undefined} */
  __tableName = undefined

  /** @type {Record<string, ValidationErrorObjectType[]>} */
  _validationErrors = {}

  static validatorTypes() {
    return this.getValidatorTypesMap()
  }

  /**
   * @param {string} name
   * @param {typeof import("./validators/base.js").default} validatorClass
   */
  static registerValidatorType(name, validatorClass) {
    this.validatorTypes()[name] = validatorClass
  }

  /**
   * @param {string} validatorName
   * @returns {typeof import("./validators/base.js").default}
   */
  static getValidatorType(validatorName) {
    if (!(validatorName in this.validatorTypes())) throw new Error(`Validator type ${validatorName} not found`)

    return this.validatorTypes()[validatorName]
  }

  /**
   * @param {string} relationshipName
   * @returns {boolean}
   */
  static _relationshipExists(relationshipName) {
    if (relationshipName in this.getRelationshipsMap()) {
      return true
    }

    return false
  }

  /**
   * @typedef {object} RelationshipDataArgumentType
   * @property {string} [className]
   * @property {typeof VelociousDatabaseRecord} [klass]
   * @property {string} [type]
   */
  /**
   * @param {string} relationshipName
   * @param {RelationshipDataArgumentType} data
   */
  static _defineRelationship(relationshipName, data) {
    if (!relationshipName) throw new Error(`Invalid relationship name given: ${relationshipName}`)
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
      actualData.className = singularizeModelName(relationshipName)
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
        return /** @type {import("./instance-relationships/has-many.js").default} */ (this.getRelationshipByName(relationshipName))
      }

      this.prototype[`${relationshipName}Loaded`] = function() {
        return this.getRelationshipByName(relationshipName).loaded()
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

    this.getRelationshipsMap()[relationshipName] = relationship
  }

  /**
   * @param {string} relationshipName
   * @returns {import("./relationships/base.js").default}
   */
  static getRelationshipByName(relationshipName) {
    const relationship = this.getRelationshipsMap()[relationshipName]

    if (!relationship) throw new Error(`No relationship in ${this.name} called "${relationshipName}" in list: ${Object.keys(this.getRelationshipsMap()).join(", ")}`)

    return relationship
  }

  /**
   * @returns {Array<import("./relationships/base.js").default>}
   */
  static getRelationships() {
    return Object.values(this.getRelationshipsMap())
  }

  static getRelationshipsMap() {
    if (!this._relationships) {
      /** @type {Record<string, import("./relationships/base.js").default>} */
      this._relationships = {}
    }

    return this._relationships
  }

  /**
   * @returns {Array<string>}
   */
  static getRelationshipNames() {
    return this.getRelationships().map((relationship) => relationship.getRelationshipName())
  }

  /**
   * @param {string} relationshipName
   * @returns {import("./instance-relationships/base.js").default}
   */
  getRelationshipByName(relationshipName) {
    if (!(relationshipName in this._instanceRelationships)) {
      const modelClassRelationship = this.getModelClass().getRelationshipByName(relationshipName)
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

  /**
   * Adds a belongs-to-relationship to the model.
   * @param {string} relationshipName The name of the relationship.
   * @param {object} [options] The options for the relationship.
   */
  static belongsTo(relationshipName, options) {
    this._defineRelationship(relationshipName, Object.assign({type: "belongsTo"}, options))
  }

  /**
   * @returns {import("../drivers/base.js").default}
   */
  static connection() {
    const databasePool = this._getConfiguration().getDatabasePool(this.getDatabaseIdentifier())
    const connection = databasePool.getCurrentConnection()

    if (!connection) throw new Error("No connection?")

    return connection
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {Record<string, any>} [attributes]
   * @returns {Promise<InstanceType<MC>>}
   */
  static async create(attributes) {
    const record = /** @type {InstanceType<MC>} */ (new this(attributes))

    await record.save()

    return record
  }

  /**
   * @returns {import("../../configuration.js").default}
   */
  static _getConfiguration() {
    if (!this._configuration) {
      this._configuration = Configuration.current()

      if (!this._configuration) {
        throw new Error("Configuration hasn't been set (model class probably hasn't been initialized)")
      }
    }

    return this._configuration
  }

  /**
   * @returns {import("../../configuration.js").default}
   */
  _getConfiguration() {
    return this.getModelClass()._getConfiguration()
  }

  /**
   * Adds a has-many-relationship to the model class.
   * @param {string} relationshipName The name of the relationship (e.g. "posts")
   * @param {object} options The options for the relationship (e.g. {className: "Post"})
   * @returns {void}
   */
  static hasMany(relationshipName, options = {}) {
    return this._defineRelationship(relationshipName, Object.assign({type: "hasMany"}, options))
  }

  /**
   * Adds a has-one-relationship to the model class.
   * @param {string} relationshipName The name of the relationship (e.g. "post")
   * @param {object} options The options for the relationship (e.g. {className: "Post"})
   * @returns {void}
   */
  static hasOne(relationshipName, options = {}) {
    return this._defineRelationship(relationshipName, Object.assign({type: "hasOne"}, options))
  }

  /**
   * @param {string} attributeName
   * @returns {string}
   */
  static humanAttributeName(attributeName) {
    const modelNameKey = inflection.underscore(this.constructor.name)

    return this._getConfiguration().getTranslator()(`velocious.database.record.attributes.${modelNameKey}.${attributeName}`, {defaultValue: inflection.camelize(attributeName)})
  }

  /**
   * @returns {string}
   */
  static getDatabaseType() {
    if (!this._databaseType) throw new Error("Database type hasn't been set")

    return this._databaseType
  }

  /**
   * @param {object} args
   * @param {import("../../configuration.js").default} args.configuration
   * @returns {Promise<void>}
   */
  static async initializeRecord({configuration, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error(`No configuration given for ${this.name}`)

    this._configuration = configuration
    this._configuration.registerModelClass(this)
    this._databaseType = this.connection().getType()

    this._table = await this.connection().getTableByName(this.tableName())
    this._columns = await this._getTable().getColumns()

    /** @type {Record<string, import("../drivers/base-column.js").default>} */
    this._columnsAsHash = {}

    const columnNameToAttributeName = this.getColumnNameToAttributeNameMap()
    const attributeNameToColumnName = this.getAttributeNameToColumnNameMap()

    for (const column of this._columns) {
      this._columnsAsHash[column.getName()] = column

      const camelizedColumnName = inflection.camelize(column.getName(), true)
      const camelizedColumnNameBigFirst = inflection.camelize(column.getName())

      attributeNameToColumnName[camelizedColumnName] = column.getName()
      columnNameToAttributeName[column.getName()] = camelizedColumnName

      this.prototype[camelizedColumnName] = function() {
        return this.readAttribute(camelizedColumnName)
      }

      this.prototype[`set${camelizedColumnNameBigFirst}`] = function(newValue) {
        return this._setColumnAttribute(camelizedColumnName, newValue)
      }

      this.prototype[`has${camelizedColumnNameBigFirst}`] = function() {
        let value = this[camelizedColumnName]()

        return this._hasAttribute(value)
      }
    }

    await this._defineTranslationMethods()
    this._initialized = true
  }

  /**
   * @param {any} value
   * @returns {boolean}
   */
  _hasAttribute(value) {
    if (typeof value == "string") {
      value = value.trim()
    }

    if (value) {
      return true
    }

    return false
  }

  /**
   * @returns {boolean}
   */
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

        this.prototype[name] = function getTranslatedAttribute() {
          const locale = this._getConfiguration().getLocale()

          return this._getTranslatedAttributeWithFallback(name, locale)
        }

        this.prototype[`has${nameCamelized}`] = function hasTranslatedAttribute() {
          const candidate = this[name]

          if (typeof candidate == "function") {
            const value = candidate.bind(this)()

            return this._hasAttribute(value)
          } else {
            throw new Error(`Expected candidate to be a function but it was: ${typeof candidate}`)
          }
        }

        this.prototype[setterMethodName] = function setTranslatedAttribute(newValue) {
          const locale = this._getConfiguration().getLocale()

          return this._setTranslatedAttribute(name, locale, newValue)
        }

        for (const locale of locales) {
          const localeCamelized = inflection.camelize(locale)
          const getterMethodNameLocalized = `${name}${localeCamelized}`
          const setterMethodNameLocalized = `${setterMethodName}${localeCamelized}`
          const hasMethodNameLocalized = `has${inflection.camelize(name)}${localeCamelized}`

          this.prototype[getterMethodNameLocalized] = function getTranslatedAttributeWithLocale() {
            return this._getTranslatedAttribute(name, locale)
          }

          this.prototype[setterMethodNameLocalized] = function setTranslatedAttributeWithLocale(newValue) {
            return this._setTranslatedAttribute(name, locale, newValue)
          }

          this.prototype[hasMethodNameLocalized] = function hasTranslatedAttribute() {
            const candidate = this[getterMethodNameLocalized]

            if (typeof candidate == "function") {
              const value = candidate.bind(this)()

              return this._hasAttribute(value)
            } else {
              throw new Error(`Expected candidate to be a function but it was: ${typeof candidate}`)
            }
          }
        }
      }
    }
  }

  /**
   * @returns {string}
   */
  static getDatabaseIdentifier() {
    return this._databaseIdentifier || "default"
  }

  /**
   * @param {string} databaseIdentifier
   * @returns {void}
   */
  static setDatabaseIdentifier(databaseIdentifier) {
    this._databaseIdentifier = databaseIdentifier
  }

  /**
   * @param {string} name
   * @returns {*}
   */
  getAttribute(name) {
    const columnName = inflection.underscore(name)

    if (!this.isNewRecord() && !(columnName in this._attributes)) {
      throw new Error(`${this.constructor.name}#${name} attribute hasn't been loaded yet in ${Object.keys(this._attributes).join(", ")}`)
    }

    return this._attributes[columnName]
  }

  /**
   * @abstract
   * @returns {typeof VelociousDatabaseRecord}
   */
  getModelClass() {
    const modelClass = /** @type {typeof VelociousDatabaseRecord} */ (this.constructor)

    return modelClass
  }

  /**
   * @param {string} name
   * @param {*} newValue
   * @returns {void}
   */
  setAttribute(name, newValue) {
    const setterName = `set${inflection.camelize(name)}`

    if (!this.getModelClass().isInitialized()) throw new Error(`${this.constructor.name} model isn't initialized yet`)
    if (!(setterName in this)) throw new Error(`No such setter method: ${this.constructor.name}#${setterName}`)

    this[setterName](newValue)
  }

  /**
   * @param {string} name
   * @param {any} newValue
   */
  _setColumnAttribute(name, newValue) {
    if (!this.getModelClass()._attributeNameToColumnName) throw new Error("No attribute-to-column mapping. Has record been initialized?")

    const columnName = this.getModelClass().getAttributeNameToColumnNameMap()[name]

    if (!columnName) throw new Error(`Couldn't figure out column name for attribute: ${name}`)

    if (this._attributes[columnName] != newValue) {
      this._changes[columnName] = newValue
    }
  }

  /**
   * @returns {import("../drivers/base-column.js").default[]}
   */
  static getColumns() {
    if (!this._columns) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._columns
  }

  /**
   * @returns {Array<string>}
   */
  static getColumnNames() {
    if (!this._columnNames) {
      this._columnNames = this.getColumns().map((column) => column.getName())
    }

    return this._columnNames
  }

  /**
   * @returns {import("../drivers/base-table.js").default}
   */
  static _getTable() {
    if (!this._table) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._table
  }

  /**
   * @param {Array<string>} columns
   * @param {Array<Array<string>>} rows
   * @returns {Promise<void>}
   */
  static async insertMultiple(columns, rows) {
    return await this.connection().insertMultiple(this.tableName(), columns, rows)
  }

  /**
   * @returns {Promise<number>}
   */
  static async nextPrimaryKey() {
    const primaryKey = this.primaryKey()
    const tableName = this.tableName()
    const connection = this.connection()
    const newestRecord = await this.order(`${connection.quoteTable(tableName)}.${connection.quoteColumn(primaryKey)}`).last()

    if (newestRecord) {
      const id = newestRecord.id()

      if (typeof id == "number") {
        return id + 1
      } else {
        throw new Error("ID from newest record wasn't a number")
      }
    } else {
      return 1
    }
  }

  /**
   * @param {string} primaryKey
   * @returns {void}
   */
  static setPrimaryKey(primaryKey) {
    this._primaryKey = primaryKey
  }

  /**
   * @returns {string}
   */
  static primaryKey() {
    if (this._primaryKey) return this._primaryKey

    return "id"
  }

  /**
   * @returns {Promise<void>}
   */
  async save() {
    const isNewRecord = this.isNewRecord()
    let result

    await this._getConfiguration().ensureConnections(async () => {
      await this._runValidations()

      await this.getModelClass().transaction(async () => {
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

      if (model) {
        if (model instanceof VelociousDatabaseRecord) {
          if (model.isChanged()) {
            await model.save()

            const foreignKey = instanceRelationship.getForeignKey()

            this.setAttribute(foreignKey, model.id())

            instanceRelationship.setPreloaded(true)
            instanceRelationship.setDirty(false)

            savedCount++
          }
        } else {
          throw new Error(`Expected a record but got: ${typeof model}`)
        }
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

      /** @type {VelociousDatabaseRecord[]} */
      let loaded

      const hasManyOrOneLoaded = instanceRelationship.getLoadedOrUndefined()

      if (hasManyOrOneLoaded) {
        if (Array.isArray(hasManyOrOneLoaded)) {
          loaded = hasManyOrOneLoaded
        } else if (hasManyOrOneLoaded instanceof VelociousDatabaseRecord) {
          loaded = [hasManyOrOneLoaded]
        } else {
          throw new Error(`Expected hasOneLoaded to be a record but it wasn't: ${typeof hasManyOrOneLoaded}`)
        }
      } else {
        continue
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

  /**
   * @param {object} args
   * @param {boolean} args.isNewRecord
   */
  async _autoSaveHasManyAndHasOneRelationships({isNewRecord}) {
    for (const instanceRelationship of this._autoSaveHasManyAndHasOneRelationshipsToSave()) {
      let hasManyOrOneLoaded = instanceRelationship.getLoadedOrUndefined()

      /** @type {VelociousDatabaseRecord[]} */
      let loaded

      if (hasManyOrOneLoaded === undefined) {
        loaded = []
      } else if (hasManyOrOneLoaded instanceof VelociousDatabaseRecord) {
        loaded = [hasManyOrOneLoaded]
      } else if (Array.isArray(hasManyOrOneLoaded)) {
        loaded = hasManyOrOneLoaded
      } else {
        throw new Error(`Unexpected type for hasManyOrOneLoaded: ${typeof hasManyOrOneLoaded}`)
      }

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

  /**
   * @returns {string}
   */
  static tableName() {
    if (!this._tableName) this._tableName = inflection.underscore(inflection.pluralize(this.name))

    return this._tableName
  }

  /**
   * @param {string} tableName
   * @returns {void}
   */
  static setTableName(tableName) {
    this._tableName = tableName
  }

  /**
   * @param {function() : Promise<void>} callback
   * @returns {Promise<*>}
   */
  static async transaction(callback) {
    const useTransactions = this.connection().getArgs().record?.transactions

    if (useTransactions !== false) {
      return await this.connection().transaction(callback)
    } else {
      return await callback()
    }
  }

  /**
   * @param {...string} names
   * @returns {void}
   */
  static translates(...names) {
    const translations = this.getTranslationsMap()

    for (const name of names) {
      if (name in translations) throw new Error(`Translation already exists: ${name}`)

      translations[name] = {}

      if (!this._relationshipExists("translations")) {
        this._defineRelationship("translations", {klass: this.getTranslationClass(), type: "hasMany"})
      }
    }
  }

  /**
   * @returns {typeof VelociousDatabaseRecord}
   */
  static getTranslationClass() {
    if (this._translationClass) return this._translationClass
    if (this.tableName().endsWith("_translations")) throw new Error("Trying to define a translations class for a translation class")

    const className = `${this.name}Translation`
    const TranslationClass = class Translation extends VelociousDatabaseRecord {}
    const belongsTo = singularizeModelName(inflection.camelize(this.tableName(), true))

    Object.defineProperty(TranslationClass, "name", {value: className})
    TranslationClass.setTableName(this.getTranslationsTableName())
    TranslationClass.belongsTo(belongsTo)

    this._translationClass = TranslationClass

    return this._translationClass
  }

  /**
   * @returns {string}
   */
  static getTranslationsTableName() {
    const tableNameParts = this.tableName().split("_")

    tableNameParts[tableNameParts.length - 1] = inflection.singularize(tableNameParts[tableNameParts.length - 1])

    return `${tableNameParts.join("_")}_translations`
  }

  /**
   * @returns {Promise<boolean>}
   */
  static async hasTranslationsTable() {
    try {
      await this.connection().getTableByName(this.getTranslationsTableName())

      return true
    } catch {
      return false
    }
  }

  /**
   * Adds a validation to an attribute.
   * @param {string} attributeName The name of the attribute to validate.
   * @param {Record<string, boolean | Record<string, any>>} validators The validators to add. Key is the validator name, value is the validator arguments.
   */
  static async validates(attributeName, validators) {
    for (const validatorName in validators) {
      /** @type {Record<string, any>} */
      let validatorArgs

      /** @type {boolean} */
      let useValidator = true

      const validatorArgsCandidate = validators[validatorName]

      if (typeof validatorArgsCandidate == "boolean") {
        validatorArgs = {}
        useValidator

        if (!validatorArgsCandidate) {
          useValidator = false
        }
      } else {
        validatorArgs = validatorArgsCandidate
      }

      if (!useValidator) {
        continue
      }

      const ValidatorClass = this.getValidatorType(validatorName)
      const validator = new ValidatorClass({attributeName, args: validatorArgs})

      if (!this._validators) this._validators = {}
      if (!(attributeName in this._validators)) this._validators[attributeName] = []

      this._validators[attributeName].push(validator)
    }
  }

  /**
   * @abstract
   * @returns {TranslationBase[]}
   */
  translationsLoaded() {
    throw new Error("'translationsLoaded' not implemented")
  }

  /**
   * @param {string} name
   * @param {string} locale
   * @returns {*}
   */
  _getTranslatedAttribute(name, locale) {
    const translation = this.translationsLoaded().find((translation) => translation.locale() == locale)

    if (translation) {
      /** @type {Record<string, unknown>} */
      // @ts-expect-error
      const dict = translation

      const attributeMethod = /** @type {function() : any | undefined} */ (dict[name])

      if (typeof attributeMethod == "function") {
        return attributeMethod.bind(translation)()
      } else {
        throw new Error(`No such translated method: ${name} (${typeof attributeMethod})`)
      }
    }
  }

  /**
   * @param {string} name
   * @param {string} locale
   * @returns {*}
   */
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

  /**
   * @param {string} name
   * @param {string} locale
   * @param {*} newValue
   * @returns {void}
   */
  _setTranslatedAttribute(name, locale, newValue) {
    /** @type {VelociousDatabaseRecord | TranslationBase | undefined} */
    let translation

    translation = this.translationsLoaded()?.find((translation) => translation.locale() == locale)

    if (!translation) {
      const instanceRelationship = this.getRelationshipByName("translations")

      translation = instanceRelationship.build({locale})
    }

    /** @type {Record<string, any>} */
    const assignments = {}

    assignments[name] = newValue

    translation.assign(assignments)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {ModelClassQuery<MC>}
   */
  static _newQuery() {
    const handler = new Handler()
    const query = new ModelClassQuery({
      driver: () => this.connection(),
      handler,
      modelClass: this
    })

    return query.from(new FromTable(this.tableName()))
  }

  /** @returns {string} */
  static orderableColumn() {
    // FIXME: Allow to change to 'created_at' if using UUID?

    return this.primaryKey()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {ModelClassQuery<MC>}
   */
  static all() {
    return this._newQuery()
  }

  /** @returns {Promise<number>} */
  static async count() {
    return await this._newQuery().count()
  }

  static async destroyAll() {
    return await this._newQuery().destroyAll()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {...string|string[]} columns
   * @returns {Promise<any[]>}
   */
  static async pluck(...columns) {
    return await this._newQuery().pluck(...columns)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {number|string} recordId
   * @returns {Promise<InstanceType<MC>>}
   */
  static async find(recordId) {
    return await this._newQuery().find(recordId)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: any}} conditions
   * @returns {Promise<InstanceType<MC> | null>}
   */
  static async findBy(conditions) {
    return await this._newQuery().findBy(conditions)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: any}} conditions
   * @returns {Promise<InstanceType<MC>>}
   */
  static async findByOrFail(conditions) {
    return await this._newQuery().findByOrFail(conditions)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: any}} conditions
   * @param {function() : void} [callback]
   * @returns {Promise<InstanceType<MC>>}
   */
  static async findOrCreateBy(conditions, callback) {
    return await this._newQuery().findOrCreateBy(conditions, callback)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {Record<string, any>} conditions
   * @param {function(InstanceType<MC>) : void} [callback]
   * @returns {Promise<InstanceType<MC>>}
   */
  static async findOrInitializeBy(conditions, callback) {
    return await this._newQuery().findOrInitializeBy(conditions, callback)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>>}
   */
  static async first() {
    return await this._newQuery().first()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string|{[key: string]: any}} join
   * @returns {ModelClassQuery<MC>}
   */
  static joins(join) {
    return this._newQuery().joins(join)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>>}
   */
  static async last() {
    return await this._newQuery().last()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {number} value
   * @returns {ModelClassQuery<MC>}
   */
  static limit(value) {
    return this._newQuery().limit(value)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string | number} order
   * @returns {ModelClassQuery<MC>}
   */
  static order(order) {
    return this._newQuery().order(order)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {boolean} [value]
   * @returns {ModelClassQuery<MC>}
   */
  static distinct(value = true) {
    return this._newQuery().distinct(value)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").NestedPreloadRecord} preload
   */
  static preload(preload) {
    const query = /** @type {ModelClassQuery<MC>} */ (this._newQuery().preload(preload))

    return query
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").SelectArgumentType} select
   * @returns {ModelClassQuery<MC>}
   */
  static select(select) {
    return this._newQuery().select(select)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>[]>}
   */
  static async toArray() {
    return await this._newQuery().toArray()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").WhereArgumentType} where
   * @returns {ModelClassQuery<MC>}
   */
  static where(where) {
    return this._newQuery().where(where)
  }

  /**
   * @param {Record<string, any>} changes
   */
  constructor(changes = {}) {
    this._attributes = {}
    this._changes = {}
    this._isNewRecord = true

    for (const key in changes) {
      this.setAttribute(key, changes[key])
    }
  }

  /**
   * @param {object} attributes
   * @returns {void}
   */
  loadExistingRecord(attributes) {
    this._attributes = attributes
    this._isNewRecord = false
  }

  /**
   * Assigns the given attributes to the record.
   * @param {Record<string, any>} attributesToAssign
   * @returns {void}
   */
  assign(attributesToAssign) {
    for (const attributeToAssign in attributesToAssign) {
      this.setAttribute(attributeToAssign, attributesToAssign[attributeToAssign])
    }
  }

  /**
   * Returns a the current attributes of the record (original attributes from database plus changes)
   * @returns {Record<string, any>}
   */
  attributes() {
    return Object.assign({}, this._attributes, this._changes)
  }

  /**
   * @returns {import("../drivers/base.js").default}
   */
  _connection() {
    if (this.__connection) return this.__connection

    return this.getModelClass().connection()
  }

  /**
   * Destroys the record in the database and all of its dependent records.
   * @returns {Promise<void>}
   */
  async destroy() {
    for (const relationship of this.getModelClass().getRelationships()) {
      if (relationship.getDependent() != "destroy") {
        continue
      }

      const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName())

      /** @type {VelociousDatabaseRecord[]} */
      let models

      if (instanceRelationship.getType() == "belongsTo") {
        if (!instanceRelationship.isLoaded()) {
          await instanceRelationship.load()
        }

        const model = instanceRelationship.loaded()

        if (model instanceof VelociousDatabaseRecord) {
          models = [model]
        } else {
          throw new Error(`Unexpected loaded type: ${typeof model}`)
        }
      } else if (instanceRelationship.getType() == "hasMany") {
        if (!instanceRelationship.isLoaded()) {
          await instanceRelationship.load()
        }

        const loadedModels = instanceRelationship.loaded()

        if (Array.isArray(loadedModels)) {
          models = loadedModels
        } else {
          throw new Error(`Unexpected loaded type: ${typeof loadedModels}`)
        }
      } else {
        throw new Error(`Unhandled relationship type: ${instanceRelationship.getType()}`)
      }

      for (const model of models) {
        if (model.isPersisted()) {
          await model.destroy()
        }
      }
    }

    /** @type {Record<string, any>} */
    const conditions = {}

    conditions[this.getModelClass().primaryKey()] = this.id()

    const sql = this._connection().deleteSql({
      conditions,
      tableName: this._tableName()
    })

    await this._connection().query(sql)
  }

  /** @returns {boolean} */
  _hasChanges() { return Object.keys(this._changes).length > 0 }

  /**
   * Returns true if the model has been changed since it was loaded from the database.
   * @returns {boolean}
   */
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

  /** Returns the changes that have been made to this record since it was loaded from the database. */
  changes() {
    /** @type {Record<string, any[]>} */
    const changes = {}

    for (const changeKey in this._changes) {
      const changeValue = this._changes[changeKey]

      changes[changeKey] = [this._attributes[changeKey], changeValue]
    }

    return changes
  }

  /**
   * @returns {string}
   */
  _tableName() {
    if (this.__tableName) return this.__tableName

    return this.getModelClass().tableName()
  }

  /**
   * Reads an attribute value from the record.
   * @param {string} attributeName The name of the attribute to read. This is the attribute name, not the column name.
   * @returns {any}
   */
  readAttribute(attributeName) {
    const columnName = this.getModelClass().getAttributeNameToColumnNameMap()[attributeName]

    if (!columnName) throw new Error(`Couldn't figure out column name for attribute: ${attributeName} from these mappings: ${Object.keys(this.getModelClass().getAttributeNameToColumnNameMap()).join(", ")}`)

    return this.readColumn(columnName)
  }

  /**
   * Reads a column value from the record.
   * @param {string} attributeName The name of the column to read. This is the column name, not the attribute name.
   */
  readColumn(attributeName) {
    const column = this.getModelClass().getColumns().find((column) => column.getName() == attributeName)
    let result

    if (attributeName in this._changes) {
      result = this._changes[attributeName]
    } else if (attributeName in this._attributes) {
      result = this._attributes[attributeName]
    } else if (this.isPersisted()) {
      throw new Error(`No such attribute or not selected ${this.constructor.name}#${attributeName}`)
    }

    if (column && this.getModelClass().getDatabaseType() == "sqlite") {
      if (result && (column.getType() == "date" || column.getType() == "datetime")) {
        result = new Date(Date.parse(result))
      }
    }

    return result
  }

  _belongsToChanges() {
    /** @type {Record<string, any>} */
    const belongsToChanges = {}

    if (this._instanceRelationships) {
      for (const relationshipName in this._instanceRelationships) {
        const relationship = this._instanceRelationships[relationshipName]

        if (relationship.getType() == "belongsTo" && relationship.getDirty()) {
          const model = relationship.loaded()

          if (model) {
            if (model instanceof VelociousDatabaseRecord) {
              belongsToChanges[relationship.getForeignKey()] = model?.id()
            } else {
              throw new Error(`Unexpected model type: ${typeof model}`)
            }
          }
        }
      }
    }

    return belongsToChanges
  }

  /** @returns {Promise<void>} */
  async _createNewRecord() {
    if (!this.getModelClass().connection()["insertSql"]) {
      throw new Error(`No insertSql on ${this.getModelClass().connection().constructor.name}`)
    }

    const createdAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "created_at")
    const updatedAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "updated_at")
    const data = Object.assign({}, this._belongsToChanges(), this.attributes())
    const primaryKey = this.getModelClass().primaryKey()
    const primaryKeyColumn = this.getModelClass().getColumns().find((column) => column.getName() == primaryKey)
    const primaryKeyType = primaryKeyColumn?.getType()?.toLowerCase()
    const driverSupportsDefaultUUID = typeof this._connection().supportsDefaultPrimaryKeyUUID == "function" && this._connection().supportsDefaultPrimaryKeyUUID()
    const isUUIDPrimaryKey = primaryKeyType?.includes("uuid")
    const shouldAssignUUIDPrimaryKey = isUUIDPrimaryKey && !driverSupportsDefaultUUID
    const currentDate = new Date()

    if (createdAtColumn) data.created_at = currentDate
    if (updatedAtColumn) data.updated_at = currentDate

    const columnNames = this.getModelClass().getColumnNames()
    const hasUserProvidedPrimaryKey = data[primaryKey] !== undefined && data[primaryKey] !== null && data[primaryKey] !== ""

    if (shouldAssignUUIDPrimaryKey && !hasUserProvidedPrimaryKey) {
      data[primaryKey] = new UUID(4).format()
    }

    const sql = this._connection().insertSql({
      returnLastInsertedColumnNames: columnNames,
      tableName: this._tableName(),
      data
    })
    const insertResult = await this._connection().query(sql)

    if (Array.isArray(insertResult) && insertResult[0] && insertResult[0][primaryKey]) {
      this._attributes = insertResult[0]
      this._changes = {}
    } else if (primaryKeyType == "uuid" && data[primaryKey] !== undefined) {
      this._attributes = Object.assign({}, data)
      this._changes = {}
    } else {
      const id = await this._connection().lastInsertID()

      await this._reloadWithId(id)
    }

    this.setIsNewRecord(false)

    // Mark all relationships as preloaded, since we don't expect anything to have magically appeared since we created the record.
    for (const relationship of this.getModelClass().getRelationships()) {
      const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName())

      if (instanceRelationship.getType() == "hasMany" && instanceRelationship.getLoadedOrUndefined() === null) {
        instanceRelationship.setLoaded([])
      }

      instanceRelationship.setPreloaded(true)
    }
  }

  /** @returns {Promise<void>} */
  async _updateRecordWithChanges() {
    /** @type {Record<string, any>} */
    const conditions = {}

    conditions[this.getModelClass().primaryKey()] = this.id()

    const changes = Object.assign({}, this._belongsToChanges(), this._changes)
    const updatedAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "updated_at")
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

  /** @returns {number|string} */
  id() {
    if (!this.getModelClass()._columnNameToAttributeName) {
      throw new Error(`Column names mapping hasn't been set on ${this.constructor.name}. Has the model been initialized?`)
    }

    const primaryKey = this.getModelClass().primaryKey()
    const attributeName = this.getModelClass().getColumnNameToAttributeNameMap()[primaryKey]

    if (attributeName === undefined) {
      throw new Error(`Primary key ${primaryKey} doesn't exist in columns: ${Object.keys(this.getModelClass().getColumnNameToAttributeNameMap()).join(", ")}`)
    }

    return this.readAttribute(attributeName)
  }

  /** @returns {boolean} */
  isPersisted() { return !this._isNewRecord }

  /** @returns {boolean} */
  isNewRecord() { return this._isNewRecord }

  /**
   * @param {boolean} newIsNewRecord
   * @returns {void}
   */
  setIsNewRecord(newIsNewRecord) {
    this._isNewRecord = newIsNewRecord
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @param {string | number} id
   * @returns {Promise<void>}
   */
  async _reloadWithId(id) {
    const primaryKey = this.getModelClass().primaryKey()

    /** @type {Record<string, any>} */
    const whereObject = {}

    whereObject[primaryKey] = id

    const query = /** @type {import("../query/model-class-query.js").default<MC>} */ (this.getModelClass().where(whereObject))
    const reloadedModel = await query.first()

    if (!reloadedModel) throw new Error(`${this.constructor.name}#${id} couldn't be reloaded - record didn't exist`)

    this._attributes = reloadedModel.attributes()
    this._changes = {}
  }

  /**
   * @returns {Promise<void>}
   */
  async reload() {
    await this._reloadWithId(this.readAttribute("id"))
  }

  async _runValidations() {
    /** @type {Record<string, {type: string, message: string}>} */
    this._validationErrors = {}

    const validators = this.getModelClass()._validators

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

  /** @returns {string[]} */
  fullErrorMessages() {
    /** @type {string[]} */
    const validationErrorMessages = []

    if (this._validationErrors) {
      for (const attributeName in this._validationErrors) {
        for (const validationError of this._validationErrors[attributeName]) {
          const message = `${this.getModelClass().humanAttributeName(attributeName)} ${validationError.message}`

          validationErrorMessages.push(message)
        }
      }
    }

    return validationErrorMessages
  }

  /**
   * Assigns the attributes to the record and saves it.
   * @param {object} attributesToAssign - The attributes to assign to the record.
   */
  async update(attributesToAssign) {
    if (attributesToAssign) this.assign(attributesToAssign)

    await this.save()
  }
}

class TranslationBase extends VelociousDatabaseRecord {
  /**
   * @abstract
   * @returns {string}
   */
  locale() {
    throw new Error("'locale' not implemented")
  }
}

VelociousDatabaseRecord.registerValidatorType("presence", ValidatorsPresence)
VelociousDatabaseRecord.registerValidatorType("uniqueness", ValidatorsUniqueness)

export {ValidationError}
export default VelociousDatabaseRecord
