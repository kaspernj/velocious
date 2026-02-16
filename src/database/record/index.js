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
   * @returns {VelociousDatabaseRecord} - The model.
   */
  getModel() {
    if (!this._model) throw new Error("Model hasn't been set")

    return this._model
  }

  /**
   * @param {VelociousDatabaseRecord} model - Model instance.
   * @returns {void} - No return value.
   */
  setModel(model) {
    this._model = model
  }

  /** @returns {Record<string, ValidationErrorObjectType[]>} - The validation errors.  */
  getValidationErrors() {
    if (!this._validationErrors) throw new Error("Validation errors hasn't been set")

    return this._validationErrors
  }

  /** @param {Record<string, ValidationErrorObjectType[]>} validationErrors - Validation errors to assign. */
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
   * @param {string} name - Name.
   * @param {typeof import("./validators/base.js").default} validatorClass - Validator class.
   */
  static registerValidatorType(name, validatorClass) {
    this.validatorTypes()[name] = validatorClass
  }

  /**
   * @param {string} validatorName - Validator name.
   * @returns {typeof import("./validators/base.js").default} - The validator type.
   */
  static getValidatorType(validatorName) {
    if (!(validatorName in this.validatorTypes())) throw new Error(`Validator type ${validatorName} not found`)

    return this.validatorTypes()[validatorName]
  }

  /**
   * @param {string} relationshipName - Relationship name.
   * @returns {boolean} - Whether relationship exists.
   */
  static _relationshipExists(relationshipName) {
    if (relationshipName in this.getRelationshipsMap()) {
      return true
    }

    return false
  }

  /**
   * @typedef {(query: import("../query/model-class-query.js").default) => (import("../query/model-class-query.js").default | void)} RelationshipScopeCallback
   */
  /**
   * @typedef {object} RelationshipDataArgumentType
   * @property {string} [className] - Model class name for the related record.
   * @property {typeof VelociousDatabaseRecord} [klass] - Model class for the related record.
   * @property {RelationshipScopeCallback} [scope] - Optional scope callback for the relationship.
   * @property {string} [type] - Relationship type (e.g. "hasMany", "belongsTo").
   */
  /**
   * @param {string} relationshipName - Relationship name.
   * @param {RelationshipDataArgumentType} data - Data payload.
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
   * @param {RelationshipScopeCallback | object | undefined} scopeOrOptions - Scope callback or options.
   * @param {object | undefined} options - Options.
   * @returns {{scope: (RelationshipScopeCallback | undefined), relationshipOptions: object}} - Normalized arguments.
   */
  static _normalizeRelationshipArgs(scopeOrOptions, options) {
    if (typeof scopeOrOptions == "function") {
      return {
        scope: scopeOrOptions,
        relationshipOptions: options || {}
      }
    }

    return {
      scope: undefined,
      relationshipOptions: scopeOrOptions || {}
    }
  }

  /**
   * @param {string} relationshipName - Relationship name.
   * @returns {import("./relationships/base.js").default} - The relationship by name.
   */
  static getRelationshipByName(relationshipName) {
    const relationship = this.getRelationshipsMap()[relationshipName]

    if (!relationship) throw new Error(`No relationship in ${this.name} called "${relationshipName}" in list: ${Object.keys(this.getRelationshipsMap()).join(", ")}`)

    return relationship
  }

  /**
   * @returns {Array<import("./relationships/base.js").default>} - The relationships.
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
   * @returns {Array<string>} - The relationship names.
   */
  static getRelationshipNames() {
    return this.getRelationships().map((relationship) => relationship.getRelationshipName())
  }

  /**
   * @param {string} relationshipName - Relationship name.
   * @returns {import("./instance-relationships/base.js").default} - The relationship by name.
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
   * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
   * @param {object} [options] The options for the relationship.
   */
  static belongsTo(relationshipName, scopeOrOptions, options) {
    const {scope, relationshipOptions} = this._normalizeRelationshipArgs(scopeOrOptions, options)

    this._defineRelationship(relationshipName, Object.assign({type: "belongsTo", scope}, relationshipOptions))
  }

  /**
   * @returns {import("../drivers/base.js").default} - The connection.
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
   * @param {Record<string, any>} [attributes] - Attributes.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the create.
   */
  static async create(attributes) {
    const record = /** @type {InstanceType<MC>} */ (new this(attributes))

    await record.save()

    return record
  }

  /**
   * @returns {import("../../configuration.js").default} - The configuration.
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
   * @returns {import("../../configuration.js").default} - The configuration.
   */
  _getConfiguration() {
    return this.getModelClass()._getConfiguration()
  }

  /**
   * Adds a has-many-relationship to the model class.
   * @param {string} relationshipName The name of the relationship (e.g. "posts")
   * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
   * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
   * @returns {void} - No return value.
   */
  static hasMany(relationshipName, scopeOrOptions, options) {
    const {scope, relationshipOptions} = this._normalizeRelationshipArgs(scopeOrOptions, options)

    return this._defineRelationship(relationshipName, Object.assign({type: "hasMany", scope}, relationshipOptions))
  }

  /**
   * Adds a has-one-relationship to the model class.
   * @param {string} relationshipName The name of the relationship (e.g. "post")
   * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
   * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
   * @returns {void} - No return value.
   */
  static hasOne(relationshipName, scopeOrOptions, options) {
    const {scope, relationshipOptions} = this._normalizeRelationshipArgs(scopeOrOptions, options)

    return this._defineRelationship(relationshipName, Object.assign({type: "hasOne", scope}, relationshipOptions))
  }

  /**
   * @param {string} attributeName - Attribute name.
   * @returns {string} - The human attribute name.
   */
  static humanAttributeName(attributeName) {
    const modelNameKey = inflection.underscore(this.name)

    return this._getConfiguration().getTranslator()(`velocious.database.record.attributes.${modelNameKey}.${attributeName}`, {defaultValue: inflection.camelize(attributeName)})
  }

  /**
   * @returns {string} - The database type.
   */
  static getDatabaseType() {
    if (!this._databaseType) throw new Error("Database type hasn't been set")

    return this._databaseType
  }

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @returns {Promise<void>} - Resolves when complete.
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
   * @param {any} value - Value to use.
   * @returns {boolean} - Whether attribute.
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
   * @returns {boolean} - Whether initialized.
   */
  static isInitialized() {
    if (this._initialized) return true

    return false
  }

  /**
   * @returns {void} - No return value.
   */
  static _assertHasBeenInitialized() {
    if (this._initialized) return

    throw new Error(`${this.name} used before initialization. Call ${this.name}.initializeRecord(...) or configuration.initialize().`)
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
   * @returns {string} - The database identifier.
   */
  static getDatabaseIdentifier() {
    return this._databaseIdentifier || "default"
  }

  /**
   * @param {string} databaseIdentifier - Database identifier.
   * @returns {void} - No return value.
   */
  static setDatabaseIdentifier(databaseIdentifier) {
    this._databaseIdentifier = databaseIdentifier
  }

  /**
   * @param {string} name - Name.
   * @returns {any} - The attribute.
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
   * @returns {typeof VelociousDatabaseRecord} - The model class.
   */
  getModelClass() {
    const modelClass = /** @type {typeof VelociousDatabaseRecord} */ (this.constructor)

    return modelClass
  }

  /**
   * @param {string} name - Name.
   * @param {any} newValue - New value.
   * @returns {void} - No return value.
   */
  setAttribute(name, newValue) {
    const setterName = `set${inflection.camelize(name)}`

    this.getModelClass()._assertHasBeenInitialized()
    if (!this.getModelClass().isInitialized()) throw new Error(`${this.constructor.name} model isn't initialized yet`)
    if (!(setterName in this)) throw new Error(`No such setter method: ${this.constructor.name}#${setterName}`)

    this[setterName](newValue)
  }

  /**
   * @param {string} name - Name.
   * @param {any} newValue - New value.
   */
  _setColumnAttribute(name, newValue) {
    this.getModelClass()._assertHasBeenInitialized()
    if (!this.getModelClass()._attributeNameToColumnName) throw new Error("No attribute-to-column mapping. Has record been initialized?")

    const columnName = this.getModelClass().getAttributeNameToColumnNameMap()[name]

    if (!columnName) throw new Error(`Couldn't figure out column name for attribute: ${name}`)

    let normalizedValue = newValue
    const columnType = this.getModelClass().getColumnTypeByName(columnName)

    if (columnType && this.getModelClass()._isDateLikeType(columnType)) {
      normalizedValue = this._normalizeDateValue(newValue)
    }

    normalizedValue = this._normalizeSqliteBooleanValue({columnType, value: normalizedValue})

    if (this._attributes[columnName] != normalizedValue) {
      this._changes[columnName] = normalizedValue
    }
  }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The date value.
   */
  _normalizeDateValue(value) {
    if (typeof value != "string") return value

    const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

    if (!isoDateTimeRegex.test(value)) return value

    const timestamp = Date.parse(value)

    if (Number.isNaN(timestamp)) return value

    return new Date(timestamp)
  }

  /**
   * @param {object} args - Options object.
   * @param {string | undefined} args.columnType - Column type.
   * @param {any} args.value - Value to normalize.
   * @returns {any} - Normalized value.
   */
  _normalizeSqliteBooleanValue({columnType, value}) {
    if (this.getModelClass().getDatabaseType() != "sqlite") return value
    if (!columnType || typeof columnType != "string") return value
    if (columnType.toLowerCase() !== "boolean") return value
    if (value === true) return 1
    if (value === false) return 0

    return value
  }

  /**
   * @returns {import("../drivers/base-column.js").default[]} - The columns.
   */
  static getColumns() {
    this._assertHasBeenInitialized()
    if (!this._columns) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._columns
  }

  /** @returns {Record<string, import("../drivers/base-column.js").default>} - The columns hash.  */
  static getColumnsHash() {
    if (!this._columnsAsHash) {
      /** @type {Record<string, import("../drivers/base-column.js").default>} */
      this._columnsAsHash = {}

      for (const column of this.getColumns()) {
        this._columnsAsHash[column.getName()] = column
      }
    }

    return this._columnsAsHash
  }

  /**
   * @param {string} name - Name.
   * @returns {string | undefined} - The column type by name.
   */
  static getColumnTypeByName(name) {
    if (!this._columnTypeByName) {
      this._columnTypeByName = {}

      for (const column of this.getColumns()) {
        this._columnTypeByName[column.getName()] = column.getType()
      }
    }

    return this._columnTypeByName[name]
  }

  /**
   * @param {string} type - Type identifier.
   * @returns {boolean} - Whether date like type.
   */
  static _isDateLikeType(type) {
    const normalizedType = type.toLowerCase()

    return normalizedType == "date" ||
      normalizedType == "datetime" ||
      normalizedType == "timestamp" ||
      normalizedType == "timestamptz" ||
      normalizedType.startsWith("timestamp ")
  }

  /**
   * @returns {Array<string>} - The column names.
   */
  static getColumnNames() {
    if (!this._columnNames) {
      this._columnNames = this.getColumns().map((column) => column.getName())
    }

    return this._columnNames
  }

  /**
   * @returns {import("../drivers/base-table.js").default} - The table.
   */
  static _getTable() {
    if (!this._table) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._table
  }

  /**
   * @param {Array<string>} columns - Column names.
   * @param {Array<Array<unknown>>} rows - Rows to insert.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.cast] - Whether to cast values based on column types.
   * @param {boolean} [args.retryIndividuallyOnFailure] - Retry rows individually if a batch insert fails.
   * @param {boolean} [args.returnResults] - Return succeeded/failed rows instead of throwing when retries fail.
   * @returns {Promise<void | {succeededRows: Array<Array<unknown>>, failedRows: Array<Array<unknown>>, errors: Array<{row: Array<unknown>, error: unknown}>}>} - Resolves when complete.
   */
  static async insertMultiple(columns, rows, args = {}) {
    const {cast = true, retryIndividuallyOnFailure = false, returnResults = false, ...restArgs} = args

    restArgsError(restArgs)

    const normalizedRows = cast
      ? this._normalizeInsertMultipleRows({columns, rows})
      : rows
    const tableName = this.tableName()

    if (!retryIndividuallyOnFailure) {
      await this.connection().insertMultiple(tableName, columns, normalizedRows)
      if (returnResults) return {succeededRows: normalizedRows.slice(), failedRows: [], errors: []}
      return
    }

    try {
      await this.connection().insertMultiple(tableName, columns, normalizedRows)
      if (returnResults) return {succeededRows: normalizedRows.slice(), failedRows: [], errors: []}
      return
    } catch {
      const results = {
        succeededRows: [],
        failedRows: [],
        errors: []
      }

      for (const row of normalizedRows) {
        try {
          await this.connection().insertMultiple(tableName, columns, [row])
          results.succeededRows.push(row)
        } catch (rowError) {
          results.failedRows.push(row)
          results.errors.push({row, error: rowError})
        }
      }

      if (results.failedRows.length > 0) {
        const combinedErrors = results.errors.map((entry, index) => {
          const message = entry.error instanceof Error ? entry.error.message : String(entry.error)
          return `[${index}] ${message}. Row: ${this._safeSerializeInsertRow(entry.row)}`
        }).join(" | ")
        const combinedError = new Error(`insertMultiple failed for ${results.failedRows.length} rows. ${combinedErrors}`)

        if (returnResults) return results
        throw combinedError
      }

      if (returnResults) return results
      return
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {Array<string>} args.columns - Column names.
   * @param {Array<Array<unknown>>} args.rows - Rows to insert.
   * @returns {Array<Array<unknown>>} - Normalized rows.
   */
  static _normalizeInsertMultipleRows({columns, rows}) {
    return rows.map((row) => {
      if (!Array.isArray(row) || row.length !== columns.length) {
        const rowLength = Array.isArray(row) ? row.length : "non-array"

        throw new Error(`insertMultiple row length mismatch. Expected ${columns.length} values but got ${rowLength}. Row: ${JSON.stringify(row)}`)
      }

      const normalizedRow = []

      for (let index = 0; index < columns.length; index++) {
        const columnName = columns[index]
        const value = row[index]

        normalizedRow[index] = this._normalizeInsertValueForColumn({columnName, value})
      }

      return normalizedRow
    })
  }

  /**
   * @param {Array<unknown>} row - Row to serialize.
   * @returns {string} - Safe row representation.
   */
  static _safeSerializeInsertRow(row) {
    const seen = new WeakSet()

    try {
      return JSON.stringify(row, (key, value) => {
        if (typeof value === "bigint") return value.toString()
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[Circular]"
          seen.add(value)
        }

        return value
      })
    } catch {
      return String(row)
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.columnName - Column name.
   * @param {unknown} args.value - Column value.
   * @returns {unknown} - Normalized value.
   */
  static _normalizeInsertValueForColumn({columnName, value}) {
    const column = this.getColumnsHash()[columnName]

    if (!column) return value

    const columnType = column.getType()
    const normalizedType = typeof columnType === "string" ? columnType.toLowerCase() : undefined
    let normalizedValue = value

    if (normalizedType && this._isDateLikeType(normalizedType)) {
      normalizedValue = this._normalizeDateValueForInsert(normalizedValue)
    }

    normalizedValue = this._normalizeSqliteBooleanValueForInsert({columnType, value: normalizedValue})

    if (normalizedValue === "" && column.getNull() && !this._isStringType(normalizedType)) {
      normalizedValue = null
    }

    if (normalizedType && this._isNumericType(normalizedType)) {
      normalizedValue = this._normalizeNumericValue({columnType: normalizedType, value: normalizedValue})
    }

    return normalizedValue
  }

  /**
   * @param {string | undefined} columnType - Column type.
   * @returns {boolean} - Whether string-like type.
   */
  static _isStringType(columnType) {
    if (!columnType) return false

    const stringTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary"])

    return columnType.includes("uuid") ||
      columnType.includes("text") ||
      stringTypes.has(columnType)
  }

  /**
   * @param {string} columnType - Column type.
   * @returns {boolean} - Whether numeric-like type.
   */
  static _isNumericType(columnType) {
    return columnType.includes("int") ||
      columnType.includes("decimal") ||
      columnType.includes("numeric") ||
      columnType.includes("float") ||
      columnType.includes("double") ||
      columnType.includes("real")
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.columnType - Column type.
   * @param {unknown} args.value - Value to normalize.
   * @returns {unknown} - Normalized value.
   */
  static _normalizeNumericValue({columnType, value}) {
    if (value === "" || value === null || value === undefined) return value
    if (typeof value !== "string") return value

    if (columnType.includes("decimal") || columnType.includes("numeric")) {
      return value
    }

    const parsed = Number(value)

    if (!Number.isFinite(parsed)) return value

    if (columnType.includes("int")) {
      if (!Number.isSafeInteger(parsed)) return value
      if (!/^-?\d+$/.test(value)) return value
    }

    return parsed
  }

  /**
   * @param {any} value - Value to normalize.
   * @returns {any} - Normalized value.
   */
  static _normalizeDateValueForInsert(value) {
    let normalizedValue = value

    if (typeof normalizedValue == "string") {
      normalizedValue = this._normalizeDateStringForInsert(normalizedValue)
    }

    if (normalizedValue instanceof Date) {
      const configuration = this._getConfiguration()
      const offsetMinutes = configuration.getEnvironmentHandler().getTimezoneOffsetMinutes(configuration)
      const offsetMs = offsetMinutes * 60 * 1000

      normalizedValue = new Date(normalizedValue.getTime() - offsetMs)
    }

    return normalizedValue
  }

  /**
   * @param {string} value - Date string value.
   * @returns {string | Date} - Parsed date or original string.
   */
  static _normalizeDateStringForInsert(value) {
    const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

    if (!isoDateTimeRegex.test(value)) return value

    const timestamp = Date.parse(value)

    if (Number.isNaN(timestamp)) return value

    return new Date(timestamp)
  }

  /**
   * @param {object} args - Options object.
   * @param {string | undefined} args.columnType - Column type.
   * @param {any} args.value - Value to normalize.
   * @returns {any} - Normalized value.
   */
  static _normalizeSqliteBooleanValueForInsert({columnType, value}) {
    if (this.getDatabaseType() != "sqlite") return value
    if (!columnType || typeof columnType != "string") return value
    if (columnType.toLowerCase() !== "boolean") return value
    if (value === true) return 1
    if (value === false) return 0

    return value
  }

  /**
   * @returns {Promise<number>} - Resolves with the next primary key.
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
   * @param {string} primaryKey - Primary key.
   * @returns {void} - No return value.
   */
  static setPrimaryKey(primaryKey) {
    this._primaryKey = primaryKey
  }

  /**
   * @returns {string} - The primary key.
   */
  static primaryKey() {
    if (this._primaryKey) return this._primaryKey

    return "id"
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
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
   * @param {object} args - Options object.
   * @param {boolean} args.isNewRecord - Whether is new record.
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
   * @returns {string} - The table name.
   */
  static tableName() {
    if (!this._tableName) this._tableName = inflection.underscore(inflection.pluralize(this.name))

    return this._tableName
  }

  /**
   * @param {string} tableName - Table name.
   * @returns {void} - No return value.
   */
  static setTableName(tableName) {
    this._tableName = tableName
  }

  /**
   * @param {function() : Promise<void>} callback - Callback function.
   * @returns {Promise<unknown>} - Resolves with the transaction.
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
   * @param {...string} names - Names.
   * @returns {void} - No return value.
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
   * @returns {typeof VelociousDatabaseRecord} - The translation class.
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
   * @returns {string} - The translations table name.
   */
  static getTranslationsTableName() {
    const tableNameParts = this.tableName().split("_")

    tableNameParts[tableNameParts.length - 1] = inflection.singularize(tableNameParts[tableNameParts.length - 1])

    return `${tableNameParts.join("_")}_translations`
  }

  /**
   * @returns {Promise<boolean>} - Resolves with Whether it has translations table.
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
   * @returns {TranslationBase[]} - The translations loaded.
   */
  translationsLoaded() {
    throw new Error("'translationsLoaded' not implemented")
  }

  /**
   * @param {string} name - Name.
   * @param {string} locale - Locale.
   * @returns {string | undefined} - The translated attribute, if found.
   */
  _getTranslatedAttribute(name, locale) {
    const translation = this.translationsLoaded().find((translation) => translation.locale() == locale)

    if (translation) {
      /** @type {Record<string, any>} */
      const dict = translation

      const attributeMethod = /** @type {function() : string | undefined} */ (dict[name])

      if (typeof attributeMethod == "function") {
        return attributeMethod.bind(translation)()
      } else {
        throw new Error(`No such translated method: ${name} (${typeof attributeMethod})`)
      }
    }

    return undefined
  }

  /**
   * @param {string} name - Name.
   * @param {string} locale - Locale.
   * @returns {string | undefined} - The translated attribute with fallback, if found.
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

    return undefined
  }

  /**
   * @param {string} name - Name.
   * @param {string} locale - Locale.
   * @param {any} newValue - New value.
   * @returns {void} - No return value.
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
   * @returns {ModelClassQuery<MC>} - The new query.
   */
  static _newQuery() {
    this._assertHasBeenInitialized()
    const handler = new Handler()
    const query = new ModelClassQuery({
      driver: () => this.connection(),
      handler,
      modelClass: this
    })

    return query.from(new FromTable(this.tableName()))
  }

  /** @returns {string} - The orderable column.  */
  static orderableColumn() {
    // FIXME: Allow to change to 'created_at' if using UUID?

    return this.primaryKey()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {ModelClassQuery<MC>} - The all.
   */
  static all() {
    return this._newQuery()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string} action - Ability action to scope by.
   * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
   * @returns {ModelClassQuery<MC>} - Authorized query.
   */
  static accessibleFor(action, ability) {
    const query = this._newQuery()
    const currentAbility = ability || this._getConfiguration().getCurrentAbility()

    if (!currentAbility) {
      throw new Error(`No ability in context for ${this.name}. Pass an ability or configure ability resolver on the request`)
    }

    return /** @type {ModelClassQuery<MC>} */ (currentAbility.applyToQuery({
      action,
      modelClass: this,
      query
    }))
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
   * @returns {ModelClassQuery<MC>} - Authorized query.
   */
  static accessible(ability) {
    return this.accessibleFor("read", ability)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
   * @returns {ModelClassQuery<MC>} - Authorized query.
   */
  static accessibleBy(ability) {
    return this.accessible(ability)
  }

  /** @returns {Promise<number>} - Resolves with the count.  */
  static async count() {
    return await this._newQuery().count()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string} group - Group.
   * @returns {ModelClassQuery<MC>} - The group.
   */
  static group(group) {
    return this._newQuery().group(group)
  }

  static async destroyAll() {
    return await this._newQuery().destroyAll()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {...string|string[]} columns - Column names.
   * @returns {Promise<any[]>} - Resolves with the pluck.
   */
  static async pluck(...columns) {
    return await this._newQuery().pluck(...columns)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {number|string} recordId - Record id.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
   */
  static async find(recordId) {
    return await this._newQuery().find(recordId)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
   */
  static async findBy(conditions) {
    return await this._newQuery().findBy(conditions)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
   */
  static async findByOrFail(conditions) {
    return await this._newQuery().findByOrFail(conditions)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @param {function() : void} [callback] - Callback function.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
   */
  static async findOrCreateBy(conditions, callback) {
    return await this._newQuery().findOrCreateBy(conditions, callback)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {Record<string, string | number>} conditions - Conditions.
   * @param {function(InstanceType<MC>) : void} [callback] - Callback function.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
   */
  static async findOrInitializeBy(conditions, callback) {
    return await this._newQuery().findOrInitializeBy(conditions, callback)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>>} - Resolves with the first.
   */
  static async first() {
    return await this._newQuery().first()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string | import("../query/join-object.js").JoinObject} join - Join clause or join descriptor.
   * @returns {ModelClassQuery<MC>} - The joins.
   */
  static joins(join) {
    return this._newQuery().joins(join)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>>} - Resolves with the last.
   */
  static async last() {
    return await this._newQuery().last()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {number} value - Value to use.
   * @returns {ModelClassQuery<MC>} - The limit.
   */
  static limit(value) {
    return this._newQuery().limit(value)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string | number} order - Order.
   * @returns {ModelClassQuery<MC>} - The order.
   */
  static order(order) {
    return this._newQuery().order(order)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {boolean} [value] - Value to use.
   * @returns {ModelClassQuery<MC>} - The distinct.
   */
  static distinct(value = true) {
    return this._newQuery().distinct(value)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").NestedPreloadRecord} preload - Preload.
   * @returns {ModelClassQuery<MC>} - The preload.
   */
  static preload(preload) {
    const query = /** @type {ModelClassQuery<MC>} */ (this._newQuery().preload(preload))

    return query
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").SelectArgumentType} select - Select.
   * @returns {ModelClassQuery<MC>} - The select.
   */
  static select(select) {
    return this._newQuery().select(select)
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
   */
  static async toArray() {
    return await this._newQuery().toArray()
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").WhereArgumentType} where - Where.
   * @returns {ModelClassQuery<MC>} - The where.
   */
  static where(where) {
    return this._newQuery().where(where)
  }

  /**
   * @param {Record<string, any>} changes - Changes.
   */
  constructor(changes = {}) {
    this.getModelClass()._assertHasBeenInitialized()
    this._attributes = {}
    this._changes = {}
    this._isNewRecord = true

    for (const key in changes) {
      this.setAttribute(key, changes[key])
    }
  }

  /**
   * @param {object} attributes - Attributes.
   * @returns {void} - No return value.
   */
  loadExistingRecord(attributes) {
    this._attributes = attributes
    this._isNewRecord = false
  }

  /**
   * Assigns the given attributes to the record.
   * @param {Record<string, any>} attributesToAssign - Attributes to assign.
   * @returns {void} - No return value.
   */
  assign(attributesToAssign) {
    for (const attributeToAssign in attributesToAssign) {
      this.setAttribute(attributeToAssign, attributesToAssign[attributeToAssign])
    }
  }

  /**
   * Returns a the current attributes of the record (original attributes from database plus changes)
   * @returns {Record<string, any>} - The attributes.
   */
  attributes() {
    const data = this.rawAttributes()
    const columnNameToAttributeName = this.getModelClass().getColumnNameToAttributeNameMap()
    /** @type {Record<string, any>} */
    const attributes = {}

    for (const columnName in data) {
      const attributeName = columnNameToAttributeName[columnName] || columnName

      attributes[attributeName] = this.readAttribute(attributeName)
    }

    return attributes
  }

  /**
   * Returns column-name keyed data (original attributes from database plus changes)
   * @returns {Record<string, any>} - The raw attributes.
   */
  rawAttributes() {
    return Object.assign({}, this._attributes, this._changes)
  }

  /**
   * @returns {import("../drivers/base.js").default} - The connection.
   */
  _connection() {
    if (this.__connection) return this.__connection

    return this.getModelClass().connection()
  }

  /**
   * Destroys the record in the database and all of its dependent records.
   * @returns {Promise<void>} - Resolves when complete.
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

  /** @returns {boolean} - Whether changes.  */
  _hasChanges() { return Object.keys(this._changes).length > 0 }

  /**
   * Returns true if the model has been changed since it was loaded from the database.
   * @returns {boolean} - Whether changed.
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

  /**
   * Returns the changes that have been made to this record since it was loaded from the database.
   * @returns {Record<string, any[]>} - The changes.
   */
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
   * @returns {string} - The table name.
   */
  _tableName() {
    if (this.__tableName) return this.__tableName

    return this.getModelClass().tableName()
  }

  /**
   * Reads an attribute value from the record.
   * @param {string} attributeName The name of the attribute to read. This is the attribute name, not the column name.
   * @returns {any} - The attribute.
   */
  readAttribute(attributeName) {
    this.getModelClass()._assertHasBeenInitialized()
    const columnName = this.getModelClass().getAttributeNameToColumnNameMap()[attributeName]

    if (!columnName) throw new Error(`Couldn't figure out column name for attribute: ${attributeName} from these mappings: ${Object.keys(this.getModelClass().getAttributeNameToColumnNameMap()).join(", ")}`)

    return this.readColumn(columnName)
  }

  /**
   * Reads a column value from the record.
   * @param {string} attributeName The name of the column to read. This is the column name, not the attribute name.
   * @returns {any} - The column.
   */
  readColumn(attributeName) {
    this.getModelClass()._assertHasBeenInitialized()
    const column = this.getModelClass().getColumnsHash()[attributeName]
    let result

    if (attributeName in this._changes) {
      result = this._changes[attributeName]
    } else if (attributeName in this._attributes) {
      result = this._attributes[attributeName]
    } else if (this.isPersisted()) {
      throw new Error(`No such attribute or not selected ${this.constructor.name}#${attributeName}`)
    }

    const columnType = column?.getType()

    if (columnType && this.getModelClass()._isDateLikeType(columnType)) {
      result = this._normalizeDateValueForRead(result)
    }

    return result
  }

  /**
   * @param {any} value - Value from database.
   * @returns {any} - Normalized value.
   */
  _normalizeDateValueForRead(value) {
    if (value === null || value === undefined) return value

    const configuration = this.getModelClass()._getConfiguration()
    const offsetMinutes = configuration.getEnvironmentHandler().getTimezoneOffsetMinutes(configuration)
    const offsetMs = offsetMinutes * 60 * 1000

    if (value instanceof Date) {
      return new Date(value.getTime() + offsetMs)
    }

    if (typeof value != "string") return value

    const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(value)
    const normalized = value.includes("T") ? value : value.replace(" ", "T")
    const parseValue = hasTimezone ? normalized : `${normalized}Z`
    const parsed = Date.parse(parseValue)

    if (Number.isNaN(parsed)) return value

    return new Date(parsed + offsetMs)
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

  /** @returns {Promise<void>} - Resolves when complete.  */
  async _createNewRecord() {
    if (!this.getModelClass().connection()["insertSql"]) {
      throw new Error(`No insertSql on ${this.getModelClass().connection().constructor.name}`)
    }

    const createdAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "created_at")
    const updatedAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "updated_at")
    const data = Object.assign({}, this._belongsToChanges(), this.rawAttributes())
    const primaryKey = this.getModelClass().primaryKey()
    const primaryKeyColumn = this.getModelClass().getColumns().find((column) => column.getName() == primaryKey)
    const primaryKeyType = primaryKeyColumn?.getType()?.toLowerCase()
    const driverSupportsDefaultUUID = typeof this._connection().supportsDefaultPrimaryKeyUUID == "function" && this._connection().supportsDefaultPrimaryKeyUUID()
    const isUUIDPrimaryKey = primaryKeyType?.includes("uuid")
    const shouldAssignUUIDPrimaryKey = isUUIDPrimaryKey && !driverSupportsDefaultUUID
    const currentDate = new Date()

    if (createdAtColumn && (data.created_at === undefined || data.created_at === null || data.created_at === "")) {
      data.created_at = currentDate
    }
    if (updatedAtColumn && (data.updated_at === undefined || data.updated_at === null || data.updated_at === "")) {
      data.updated_at = currentDate
    }

    const columnNames = this.getModelClass().getColumnNames()
    const hasUserProvidedPrimaryKey = data[primaryKey] !== undefined && data[primaryKey] !== null && data[primaryKey] !== ""

    if (shouldAssignUUIDPrimaryKey && !hasUserProvidedPrimaryKey) {
      data[primaryKey] = new UUID(4).format()
    }

    this._normalizeDateValuesForWrite(data)

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

  /**
   * @param {Record<string, any>} data - Column-keyed data.
   * @returns {void} - No return value.
   */
  _normalizeDateValuesForWrite(data) {
    const configuration = this.getModelClass()._getConfiguration()
    const offsetMinutes = configuration.getEnvironmentHandler().getTimezoneOffsetMinutes(configuration)
    const offsetMs = offsetMinutes * 60 * 1000

    for (const columnName in data) {
      const columnType = this.getModelClass().getColumnTypeByName(columnName)

      if (!columnType || !this.getModelClass()._isDateLikeType(columnType)) continue

      const value = data[columnName]

      if (!(value instanceof Date)) continue

      data[columnName] = new Date(value.getTime() - offsetMs)
    }
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async _updateRecordWithChanges() {
    /** @type {Record<string, any>} */
    const conditions = {}

    conditions[this.getModelClass().primaryKey()] = this.id()

    const changes = Object.assign({}, this._belongsToChanges(), this._changes)
    const updatedAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "updated_at")
    const currentDate = new Date()

    if (updatedAtColumn && (changes.updated_at === undefined || changes.updated_at === null || changes.updated_at === "")) {
      changes.updated_at = currentDate
    }

    if (Object.keys(changes).length > 0) {
      this._normalizeDateValuesForWrite(changes)
      const sql = this._connection().updateSql({
        tableName: this._tableName(),
        data: changes,
        conditions
      })
      await this._connection().query(sql)
      await this._reloadWithId(this.id())
    }
  }

  /** @returns {number|string} - The id.  */
  id() {
    if (!this.getModelClass()._columnNameToAttributeName) {
      throw new Error(`Column names mapping hasn't been set on ${this.constructor.name}. Has the model been initialized?`)
    }

    const primaryKey = this.getModelClass().primaryKey()
    const attributeName = this.getModelClass().getColumnNameToAttributeNameMap()[primaryKey]

    if (attributeName === undefined) {
      throw new Error(`Primary key ${primaryKey} doesn't exist in columns: ${Object.keys(this.getModelClass().getColumnNameToAttributeNameMap()).join(", ")}`)
    }

    return /** @type {number | string} */ (this.readAttribute(attributeName))
  }

  /** @returns {boolean} - Whether persisted.  */
  isPersisted() { return !this._isNewRecord }

  /** @returns {boolean} - Whether new record.  */
  isNewRecord() { return this._isNewRecord }

  /**
   * @param {boolean} newIsNewRecord - New is new record.
   * @returns {void} - No return value.
   */
  setIsNewRecord(newIsNewRecord) {
    this._isNewRecord = newIsNewRecord
  }

  /**
   * @template {typeof VelociousDatabaseRecord} MC
   * @param {string | number} id - Record identifier.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _reloadWithId(id) {
    const primaryKey = this.getModelClass().primaryKey()

    /** @type {Record<string, any>} */
    const whereObject = {}

    whereObject[primaryKey] = id

    const query = /** @type {import("../query/model-class-query.js").default<MC>} */ (this.getModelClass().where(whereObject))
    const reloadedModel = await query.first()

    if (!reloadedModel) throw new Error(`${this.constructor.name}#${id} couldn't be reloaded - record didn't exist`)

    this._attributes = reloadedModel.rawAttributes()
    this._changes = {}
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async reload() {
    const recordId = /** @type {string | number} */ (this.readAttribute("id"))
    await this._reloadWithId(recordId)
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

  /** @returns {string[]} - The full error messages.  */
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
   * @returns {string} - The locale.
   */
  locale() {
    throw new Error("'locale' not implemented")
  }
}

VelociousDatabaseRecord.registerValidatorType("presence", ValidatorsPresence)
VelociousDatabaseRecord.registerValidatorType("uniqueness", ValidatorsUniqueness)

export {ValidationError}
export default VelociousDatabaseRecord
