// @ts-check

/**
 * Defines this typedef.
 * @typedef {{type: string, message: string}} ValidationErrorObjectType
 */

/**
 * LifecycleCallbackType type.
 * @template {VelociousDatabaseRecord} [T=VelociousDatabaseRecord]
 * @typedef {((model: T) => void | Promise<void>) | string} LifecycleCallbackType
 */

/**
 * Model class constructor type used for static `this` typing.
 * @template {VelociousDatabaseRecord} T
 * @typedef {{new (...args: Array<never>): T}} ModelConstructor
 */

import timeout from "awaitery/build/timeout.js"
import BelongsToInstanceRelationship from "./instance-relationships/belongs-to.js"
import BelongsToRelationship from "./relationships/belongs-to.js"
import Configuration from "../../configuration.js"
import Current from "../../current.js"
import FromTable from "../query/from-table.js"
import Handler from "../handler.js"
import HasManyInstanceRelationship from "./instance-relationships/has-many.js"
import HasManyRelationship from "./relationships/has-many.js"
import HasOneInstanceRelationship from "./instance-relationships/has-one.js"
import HasOneRelationship from "./relationships/has-one.js"
import RecordAttachmentHandle from "./attachments/handle.js"
import * as inflection from "inflection"
import ModelClassQuery from "../query/model-class-query.js"
import Preloader from "../query/preloader.js"
import {readPayloadAssociationCount, readPayloadComputedAbility, readPayloadQueryData, setPayloadAssociationCount, setPayloadComputedAbility, setPayloadQueryData} from "../../record-payload-values.js"
import restArgsError from "../../utils/rest-args-error.js"
import singularizeModelName from "../../utils/singularize-model-name.js"
import {defineModelScope} from "../../utils/model-scope.js"
import {formatValue} from "../../utils/format-value.js"
import ValidatorsFormat from "./validators/format.js"
import ValidatorsPresence from "./validators/presence.js"
import ValidatorsUniqueness from "./validators/uniqueness.js"
import registerActsAsListCallbacks from "./acts-as-list.js"
import UUID from "pure-uuid"

/**
 * AttachmentDriverConstructor type.
 * @typedef {import("../../configuration-types.js").AttachmentDriverConstructor} AttachmentDriverConstructor
 */

/** Stored values that a declared `"boolean"` cast reads back as `true`. */
const declaredBooleanTruthyValues = new Set([1, true, "1"])

/** Stored values that a declared `"boolean"` cast reads back as `false`. */
const declaredBooleanFalsyValues = new Set([0, false, "0"])

class ValidationError extends Error {
  /**
   * Narrows the runtime value to the documented type.
   * @type {Record<string, ?> | undefined} - Velocious metadata for frontend-model error reporting.
   */
  velocious

  /**
   * Runs get model.
   * @returns {VelociousDatabaseRecord} - The model.
   */
  getModel() {
    if (!this._model) throw new Error("Model hasn't been set")

    return this._model
  }

  /**
   * Runs set model.
   * @param {VelociousDatabaseRecord} model - Model instance.
   * @returns {void} - No return value.
   */
  setModel(model) {
    this._model = model
  }

  /**
   * Runs get validation errors.
   * @returns {Record<string, ValidationErrorObjectType[]>} - The validation errors.
   */
  getValidationErrors() {
    if (!this._validationErrors) throw new Error("Validation errors hasn't been set")

    return this._validationErrors
  }

  /**
   * Runs set validation errors.
   * @param {Record<string, ValidationErrorObjectType[]>} validationErrors - Validation errors to assign.
   */
  setValidationErrors(validationErrors) {
    this._validationErrors = validationErrors
  }
}

/**
 * Runs apply built record inverse relationship.
 * @param {object} args - Options.
 * @param {VelociousDatabaseRecord} args.parent - Parent record being built from.
 * @param {{getRelationshipByName: VelociousDatabaseRecord["getRelationshipByName"]}} args.record - Newly built related record.
 * @param {string | undefined | null} args.inverseOf - Inverse relationship name.
 * @param {boolean} args.allowHasMany - Whether a has-many inverse should be appended.
 * @returns {void}
 */
function applyBuiltRecordInverseRelationship({allowHasMany, inverseOf, parent, record}) {
  if (!inverseOf) return

  const inverseInstanceRelationship = record.getRelationshipByName(inverseOf)

  inverseInstanceRelationship.setAutoSave(false)

  if (!allowHasMany || inverseInstanceRelationship.getType() == "hasOne") {
    inverseInstanceRelationship.setLoaded(parent)
    return
  }

  if (inverseInstanceRelationship.getType() == "hasMany") {
    inverseInstanceRelationship.addToLoaded(parent)
    return
  }

  throw new Error(`Unknown relationship type: ${inverseInstanceRelationship.getType()}`)
}

/**
 * Build a related record and wire its inverse relationship to the parent.
 * @param {VelociousDatabaseRecord} parent - Parent record building the relationship.
 * @param {string} relationshipName - Relationship name being built.
 * @param {Record<string, ?>} attributes - Attributes for the new related record.
 * @param {boolean} allowHasMany - Whether has-many inverse relationships should append the parent.
 * @returns {Record<string, ?>} - Built related record.
 */
function buildRelatedRecordWithInverse(parent, relationshipName, attributes, allowHasMany) {
  const instanceRelationship = parent.getRelationshipByName(relationshipName)
  const record = instanceRelationship.build(attributes)
  const inverseOf = instanceRelationship.getRelationship().getInverseOf()

  applyBuiltRecordInverseRelationship({
    allowHasMany,
    inverseOf,
    parent,
    record: /**
             * Narrows the runtime value to the documented type.
              @type {{getRelationshipByName: VelociousDatabaseRecord["getRelationshipByName"]}} */ (record)
  })

  return record
}

/**
 * Thrown by `Record.withAdvisoryLock` when the caller supplied a
 * `timeoutMs` and the lock was not granted before it elapsed.
 */
class AdvisoryLockTimeoutError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name that timed out.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockTimeoutError"
    this.lockName = name
  }
}

/**
 * Thrown by `Record.withAdvisoryLockOrFail` when the lock is already held
 * by another session at the moment of the call.
 */
class AdvisoryLockBusyError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name that was already held.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockBusyError"
    this.lockName = name
  }
}

/**
 * Thrown by `Record.withAdvisoryLock` / `withAdvisoryLockOrFail` when the
 * caller supplied a `holdTimeoutMs` and the callback ran longer than it. The
 * lock is released before this is thrown, so a hung holder can't block other
 * sessions indefinitely. Note: the callback itself is not cancelled — pass an
 * AbortSignal to the work if it needs to stop.
 */
class AdvisoryLockHoldTimeoutError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name whose hold timed out.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockHoldTimeoutError"
    this.lockName = name
  }
}

class TenantDatabaseScopeError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{modelName: string}} args - Context for the failed tenant-scoped model.
   */
  constructor(message, {modelName}) {
    super(message)
    this.name = "TenantDatabaseScopeError"
    this.modelName = modelName
  }
}

class VelociousDatabaseRecord {
  /**
   * Narrows the runtime value to the documented type.
    @type {string | undefined} */
  static modelName

  /**
   * Narrows the runtime value to the documented type.
    @type {Promise<void> | null | undefined} */
  static _initializeRecordPromise

  /**
   * Narrows the runtime value to the documented type.
    @type {boolean | undefined} */
  static _eagerLoadRecordMetadata

  /**
   * Returns the model name, preferring an explicit `static modelName` declaration
   * over the JavaScript class `.name` property. This allows minified builds to
   * preserve correct model names without relying on `keep_classnames`.
   * @returns {string} - The model name.
   */
  static getModelName() {
    if (typeof this.modelName === "string" && this.modelName.length > 0) return this.modelName

    return this.name
  }

  static getAttributeNameToColumnNameMap() {
    if (!this._attributeNameToColumnName) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, string>} */
      this._attributeNameToColumnName = {}
    }

    return this._attributeNameToColumnName
  }

  /**
   * Resolves the database column name for a record attribute name.
   * @param {string} attributeName - Attribute name to resolve.
   * @returns {string} - Mapped column name, or the underscored attribute name when no mapping exists.
   */
  static getColumnNameForAttributeName(attributeName) {
    const columnName = this.getAttributeNameToColumnNameMap()[attributeName]

    if (columnName) return columnName

    return inflection.underscore(attributeName)
  }

  /**
   * Runs define scope.
   * @param {(...args: Array<?>) => ?} callback - Scope callback.
   * @returns {((...args: Array<?>) => import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) & {scope: (...args: Array<?>) => import("../../utils/model-scope.js").ModelScopeDescriptor}} - Scope helper.
   */
  static defineScope(callback) {
    return defineModelScope({
      callback,
      modelClass: this,
      startQuery: () => this._newQuery()
    })
  }

  static getColumnNameToAttributeNameMap() {
    if (!this._columnNameToAttributeName) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, string>} */
      this._columnNameToAttributeName = {}
    }

    return this._columnNameToAttributeName
  }

  static getTranslationsMap() {
    if (!this._translations) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, object>} */
      this._translations = {}
    }

    return this._translations
  }

  static getValidatorsMap() {
    if (!this._validators) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, import("./validators/base.js").default[]>} */
      this._validators = {}
    }

    return this._validators
  }

  /**
   * Runs get lifecycle callbacks map.
   * @returns {Record<string, LifecycleCallbackType[]>} - Lifecycle callbacks keyed by name.
   */
  static getLifecycleCallbacksMap() {
    if (!this._lifecycleCallbacks) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, LifecycleCallbackType[]>} */
      this._lifecycleCallbacks = {}
    }

    return this._lifecycleCallbacks
  }

  static getValidatorTypesMap() {
    if (!this._validatorTypes) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, typeof import("./validators/base.js").default>} */
      this._validatorTypes = {}
    }

    return this._validatorTypes
  }

  /**
   * Runs get attachments map.
   * @returns {Record<string, {driver?: string | AttachmentDriverConstructor | Record<string, ?>, type: "hasOne" | "hasMany"}>} - Attachment definitions keyed by name.
   */
  static getAttachmentsMap() {
    if (!this._attachmentsMap) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, {driver?: string | AttachmentDriverConstructor | Record<string, ?>, type: "hasOne" | "hasMany"}>} */
      this._attachmentsMap = {}
    }

    return this._attachmentsMap
  }

  /**
   * Attributes.
    @type {Record<string, ?>} */
  _attributes = {}

  /**
   * Changes.
    @type {Record<string, ?>} */
  _changes = {}

  /**
   * Columns as hash.
    @type {Record<string, import("../drivers/base-column.js").default>} */
  _columnsAsHash = {}

  /**
   * Connection.
    @type {import("../drivers/base.js").default | undefined} */
  __connection = undefined

  /**
   * Instance relationships.
    @type {Record<string, import("./instance-relationships/base.js").default>} */
  _instanceRelationships = {}
  /**
   * Attachments.
    @type {Record<string, RecordAttachmentHandle>} */
  _attachments = {}

  /**
   * Load cohort.
   * @type {Array<VelociousDatabaseRecord> | undefined} - Shared reference to sibling records loaded in the same batch. Used by auto-preload.
   */
  _loadCohort = undefined

  /**
   * Table name.
    @type {string | undefined} */
  __tableName = undefined

  /**
   * Validation errors.
    @type {Record<string, ValidationErrorObjectType[]>} */
  _validationErrors = {}

  static validatorTypes() {
    return this.getValidatorTypesMap()
  }

  /**
   * Runs register validator type.
   * @param {string} name - Name.
   * @param {typeof import("./validators/base.js").default} validatorClass - Validator class.
   */
  static registerValidatorType(name, validatorClass) {
    this.validatorTypes()[name] = validatorClass
  }

  /**
   * Runs register lifecycle callback.
   * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
   * @param {LifecycleCallbackType} callback - Callback function or instance method name.
   * @returns {void}
   */
  static registerLifecycleCallback(callbackName, callback) {
    const callbacks = this.getLifecycleCallbacksMap()

    if (!callbacks[callbackName]) {
      callbacks[callbackName] = []
    }

    callbacks[callbackName].push(callback)
  }

  /**
   * Runs before validation.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static beforeValidation(callback) {
    this.registerLifecycleCallback("beforeValidation", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs before save.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static beforeSave(callback) {
    this.registerLifecycleCallback("beforeSave", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs before create.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static beforeCreate(callback) {
    this.registerLifecycleCallback("beforeCreate", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs before update.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static beforeUpdate(callback) {
    this.registerLifecycleCallback("beforeUpdate", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs before destroy.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static beforeDestroy(callback) {
    this.registerLifecycleCallback("beforeDestroy", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs after save.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static afterSave(callback) {
    this.registerLifecycleCallback("afterSave", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs after create.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static afterCreate(callback) {
    this.registerLifecycleCallback("afterCreate", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs after update.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static afterUpdate(callback) {
    this.registerLifecycleCallback("afterUpdate", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs after destroy.
   * @template {VelociousDatabaseRecord} T
   * @this {ModelConstructor<T> & typeof VelociousDatabaseRecord}
   * @param {LifecycleCallbackType<T>} callback - Callback function or instance method name.
   * @returns {void}
   */
  static afterDestroy(callback) {
    this.registerLifecycleCallback("afterDestroy", /** @type {LifecycleCallbackType} */ (callback))
  }

  /**
   * Runs get validator type.
   * @param {string} validatorName - Validator name.
   * @returns {typeof import("./validators/base.js").default} - The validator type.
   */
  static getValidatorType(validatorName) {
    if (!(validatorName in this.validatorTypes())) throw new Error(`Validator type ${validatorName} not found`)

    return this.validatorTypes()[validatorName]
  }

  /**
   * Runs relationship exists.
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
   * RelationshipScopeCallback type.
   * @typedef {(query: import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) => (import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord> | void)} RelationshipScopeCallback
   */
  /**
   * RelationshipDataArgumentType type.
   * @typedef {object} RelationshipDataArgumentType
   * @property {boolean} [autoload] - Disable auto-batch-preload for this relationship by passing false. Default true.
   * @property {string} [className] - Model class name for the related record.
   * @property {string} [dependent] - Dependent action when parent is destroyed (e.g. "destroy").
   * @property {typeof VelociousDatabaseRecord} [klass] - Model class for the related record.
   * @property {RelationshipScopeCallback} [scope] - Optional scope callback for the relationship.
   * @property {string} [type] - Relationship type (e.g. "hasMany", "belongsTo").
   */
  /**
   * Runs define relationship.
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
    const prototype = /**
                       * Narrows the runtime value to the documented type.
                        @type {Record<string, ?>} */ (/**
                                                       * Narrows the runtime value to the documented type.
                                                        @type {?} */ (this.prototype))

    if (actualData.type == "belongsTo") {
      relationship = new BelongsToRelationship(actualData)

      prototype[relationshipName] = function() {
        const relationship = this.getRelationshipByName(relationshipName)

        return relationship.loaded()
      }

      prototype[`build${inflection.camelize(relationshipName)}`] = function(/**
                                                                             * Narrows the runtime value to the documented type.
                                                                              @type {Record<string, ?>} */ attributes) {
        return buildRelatedRecordWithInverse(/**
                                              * Narrows the runtime value to the documented type.
                                               @type {VelociousDatabaseRecord} */ (this), relationshipName, attributes, true)
      }

      prototype[`load${inflection.camelize(relationshipName)}`] = async function() {
        return await this.loadRelationship(relationshipName)
      }

      prototype[`${relationshipName}OrLoad`] = async function() {
        return await this.relationshipOrLoad(relationshipName)
      }

      prototype[`set${inflection.camelize(relationshipName)}`] = function(/**
                                                                           * Narrows the runtime value to the documented type.
                                                                            @type {?} */ model) {
        const relationship = this.getRelationshipByName(relationshipName)

        relationship.setLoaded(model)
        relationship.setDirty(true)
      }
    } else if (actualData.type == "hasMany") {
      relationship = new HasManyRelationship(actualData)

      prototype[relationshipName] = function() {
        return /** Narrows the runtime value to the documented type. @type {import("./instance-relationships/has-many.js").default<?, ?>} */ (this.getRelationshipByName(relationshipName))
      }

      prototype[`${relationshipName}Loaded`] = function() {
        return this.getRelationshipByName(relationshipName).loaded()
      }

      prototype[`load${inflection.camelize(relationshipName)}`] = async function() {
        return await this.loadRelationship(relationshipName)
      }

      prototype[`${relationshipName}OrLoad`] = async function() {
        return await this.relationshipOrLoad(relationshipName)
      }
    } else if (actualData.type == "hasOne") {
      relationship = new HasOneRelationship(actualData)

      prototype[relationshipName] = function() {
        return this.getRelationshipByName(relationshipName).loaded()
      }

      prototype[`build${inflection.camelize(relationshipName)}`] = function(/**
                                                                             * Narrows the runtime value to the documented type.
                                                                              @type {Record<string, ?>} */ attributes) {
        return buildRelatedRecordWithInverse(/**
                                              * Narrows the runtime value to the documented type.
                                               @type {VelociousDatabaseRecord} */ (this), relationshipName, attributes, false)
      }

      prototype[`load${inflection.camelize(relationshipName)}`] = async function() {
        return await this.loadRelationship(relationshipName)
      }

      prototype[`${relationshipName}OrLoad`] = async function() {
        return await this.relationshipOrLoad(relationshipName)
      }
    } else {
      throw new Error(`Unknown relationship type: ${actualData.type}`)
    }

    this.getRelationshipsMap()[relationshipName] = relationship
  }

  /**
   * Runs normalize relationship args.
   * @param {RelationshipScopeCallback | object | undefined} scopeOrOptions - Scope callback or options.
   * @param {object | undefined} options - Options.
   * @returns {{scope: (RelationshipScopeCallback | undefined), relationshipOptions: object}} - Normalized arguments.
   */
  static _normalizeRelationshipArgs(scopeOrOptions, options) {
    if (typeof scopeOrOptions == "function") {
      return {
        scope: /**
                * Narrows the runtime value to the documented type.
                 @type {RelationshipScopeCallback} */ (scopeOrOptions),
        relationshipOptions: options || {}
      }
    }

    return {
      scope: undefined,
      relationshipOptions: scopeOrOptions || {}
    }
  }

  /**
   * Registers afterCreate, afterSave, and afterDestroy callbacks to sync
   * a counter cache column on the parent model. The column name follows
   * the convention `<childModelPluralCamelCase>Count`.
   * @param {string} relationshipName - The belongsTo relationship name.
   */
  static _registerCounterCacheCallbacks(relationshipName) {
    const ChildModel = this

    /**
     * Atomically recomputes the counter cache column on the parent via a
     * single UPDATE ... SET col = (SELECT COUNT(*)) so concurrent
     * creates/destroys cannot race into a stale count.
     * @param {number | string | null} parentId - Parent primary-key value.
     * @returns {Promise<void>} - Resolves when the counter cache has been synced.
     */
    async function syncCounter(parentId) {
      if (!parentId) return

      const relationship = ChildModel.getRelationshipByName(relationshipName)
      const ParentModel = relationship.getTargetModelClass()

      if (!ParentModel) return

      const primaryKey = relationship.getPrimaryKey()
      const fk = relationship.getForeignKey()
      const childModelName = ChildModel.getModelName()
      const counterColumn = inflection.underscore(`${inflection.pluralize(childModelName)}Count`)
      const parentTable = ParentModel.tableName()
      const childTable = ChildModel.tableName()
      const pkColumn = inflection.underscore(primaryKey)
      const connection = ParentModel.connection()
      const quoted = connection.quote(parentId)

      const sql = `UPDATE ${connection.quoteTable(parentTable)} SET ${connection.quoteColumn(counterColumn)} = (SELECT COUNT(*) FROM ${connection.quoteTable(childTable)} WHERE ${connection.quoteColumn(fk)} = ${quoted}) WHERE ${connection.quoteColumn(pkColumn)} = ${quoted}`

      await connection.query(sql, {logName: `${ParentModel.name} Update`})
    }

    /**
     * Runs read fk attribute.
     * @param {?} record - Child record instance.
     * @returns {?} - Current foreign-key attribute value.
     */
    function readFkAttribute(record) {
      const relationship = ChildModel.getRelationshipByName(relationshipName)
      const fkAttribute = inflection.camelize(relationship.getForeignKey().replace(/_id$/, "Id"), true)

      return record.readAttribute(fkAttribute)
    }

    ChildModel.afterCreate(async (record) => {
      await syncCounter(readFkAttribute(record))
    })

    ChildModel.afterDestroy(async (record) => {
      await syncCounter(readFkAttribute(record))
    })

    ChildModel.beforeSave(async (record) => {
      const model = /**
                     * Narrows the runtime value to the documented type.
                      @type {?} */ (record)

      if (model.isNewRecord()) return

      const relationship = ChildModel.getRelationshipByName(relationshipName)
      const fkColumn = relationship.getForeignKey()

      // Detect FK change via direct attribute assignment or relationship setter.
      const directChange = fkColumn in model._changes
      const belongsToChange = model._instanceRelationships?.[relationshipName]?.getDirty?.()

      if (directChange || belongsToChange) {
        model[`_counterCachePrev_${relationshipName}`] = model._attributes[fkColumn]
      }
    })

    ChildModel.afterSave(async (record) => {
      const model = /**
                     * Narrows the runtime value to the documented type.
                      @type {?} */ (record)
      const prevKey = `_counterCachePrev_${relationshipName}`
      const previousParentId = model[prevKey]

      if (previousParentId !== undefined) {
        delete model[prevKey]
        await syncCounter(previousParentId)
        await syncCounter(readFkAttribute(model))
      }
    })
  }

  /**
   * Runs get relationship by name.
   * @param {string} relationshipName - Relationship name.
   * @returns {import("./relationships/base.js").default} - The relationship by name.
   */
  static getRelationshipByName(relationshipName) {
    const relationship = this.getRelationshipsMap()[relationshipName]

    if (!relationship) throw new Error(`No relationship in ${this.name} called "${relationshipName}" in list: ${Object.keys(this.getRelationshipsMap()).join(", ")}`)

    return relationship
  }

  /**
   * Runs get relationships.
   * @returns {Array<import("./relationships/base.js").default>} - The relationships.
   */
  static getRelationships() {
    return Object.values(this.getRelationshipsMap())
  }

  /**
   * Runs get relationships map.
   * @returns {Record<string, import("./relationships/base.js").default>} - Relationship definitions keyed by name.
   */
  static getRelationshipsMap() {
    if (!Object.hasOwn(this, "_relationships")) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, import("./relationships/base.js").default>} */
      this._relationships = {}
    }

    return /** Narrows the runtime value to the documented type. @type {Record<string, import("./relationships/base.js").default>} */ (this._relationships)
  }

  /**
   * Runs get relationship names.
   * @returns {Array<string>} - The relationship names.
   */
  static getRelationshipNames() {
    return this.getRelationships().map((relationship) => relationship.getRelationshipName())
  }

  /**
   * Register a consumer-defined queryData entry. The callback receives
   * a grouped query already joined down the relationship chain from the
   * root of `.queryData(...)` to this model, already filtered by the
   * root parent IDs, and with `parent_id` pre-selected — so the fn
   * only needs to add its own SELECT (and optionally joins/where). Any
   * aliases the fn selects are attached to each **root** record via
   * `record.queryData(aliasName)`. Multi-column selects are fine — one
   * alias maps to one queryData key.
   *
   * **Quote AS aliases on PostgreSQL.** PostgreSQL folds unquoted
   * identifiers (including SELECT aliases) to lowercase, so a
   * `... AS manualTasksCount` lands in the result row as
   * `manualtaskscount` while the lookup `record.queryData("manualTasksCount")`
   * never finds it. Use `driver.quoteColumn("manualTasksCount")` for the
   * alias to preserve the case on every supported driver:
   *   query.select(`COUNT(...) AS ${driver.quoteColumn("manualTasksCount")}`)
   * @param {string} name - Identifier used in the `.queryData(...)` spec.
   * @param {import("../query/query-data.js").QueryDataFn} fn - Callback that mutates the query.
   * @returns {void}
   */
  static queryData(name, fn) {
    if (!name || typeof name !== "string") {
      throw new Error(`Invalid queryData name: ${name}`)
    }

    if (typeof fn !== "function") {
      throw new Error(`queryData fn for ${this.name}.queryData(${JSON.stringify(name)}) must be a function`)
    }

    const map = this.getQueryDataMap()

    // Use Object.hasOwn so a name that happens to match an inherited
    // Object.prototype key (e.g. "toString", "constructor") isn't
    // falsely treated as already registered.
    if (Object.hasOwn(map, name)) {
      throw new Error(`queryData for ${this.name}.${name} is already registered`)
    }

    map[name] = fn
  }

  /**
   * Runs get query data map.
   * @returns {Record<string, import("../query/query-data.js").QueryDataFn>} - queryData registrations keyed by name.
   */
  static getQueryDataMap() {
    if (!Object.hasOwn(this, "_queryDataRegistrations")) {
      // Prototype-less map so bracket access can only ever surface
      // registrations actually made on this class — never inherited
      // Object.prototype members.
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, import("../query/query-data.js").QueryDataFn>} */
      this._queryDataRegistrations = Object.create(null)
    }

    return /** Narrows the runtime value to the documented type. @type {Record<string, import("../query/query-data.js").QueryDataFn>} */ (this._queryDataRegistrations)
  }

  /**
   * Runs get query data by name.
   * @param {string} name - queryData name.
   * @returns {import("../query/query-data.js").QueryDataFn | null} - Registered fn or null when not found.
   */
  static getQueryDataByName(name) {
    const map = this.getQueryDataMap()

    // Own-property lookup so a spec containing e.g. "toString" doesn't
    // resolve to an inherited Object.prototype member — matching the
    // Object.hasOwn guard used when registering.
    return Object.hasOwn(map, name) ? map[name] : null
  }

  /**
   * Runs get attachments.
   * @returns {Record<string, {driver?: string | AttachmentDriverConstructor | Record<string, ?>, type: "hasOne" | "hasMany"}>} - Attachment definitions.
   */
  static getAttachments() {
    return this.getAttachmentsMap()
  }

  /**
   * Runs get attachment by name.
   * @param {string} attachmentName - Attachment name.
   * @returns {{driver?: string | AttachmentDriverConstructor | Record<string, ?>, type: "hasOne" | "hasMany"}} - Attachment definition.
   */
  static getAttachmentByName(attachmentName) {
    const definition = this.getAttachmentsMap()[attachmentName]

    if (!definition) throw new Error(`No attachment in ${this.name} called "${attachmentName}" in list: ${Object.keys(this.getAttachmentsMap()).join(", ")}`)

    return definition
  }

  /**
   * Runs get relationship by name.
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
   * Preloads relationship(s) onto this already-loaded record. Accepts either a
   * query built via `Model.preload(...).select(...)` or a raw preload spec
   * (string / array / nested object). A relationship that is already preloaded
   * with all the required columns present is left untouched unless `force` is
   * set. Preloading onto the relationship cache lets later accessors reuse the
   * loaded data instead of issuing identical queries.
   * @param {import("../query/model-class-query.js").default | import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>} queryOrSpec - Preload source.
   * @param {{force?: boolean}} [options] - Options.
   * @returns {Promise<void>} - Resolves when preloading completes.
   */
  async preload(queryOrSpec, options = {}) {
    await Preloader.preload([this], queryOrSpec, options)
  }

  /**
   * Runs load relationship.
   * @param {string} relationshipName - Relationship name.
   * @returns {Promise<?>} - Loaded relationship value.
   */
  async loadRelationship(relationshipName) {
    const relationship = this.getRelationshipByName(relationshipName)

    await relationship.load()

    return relationship.loaded()
  }

  /**
   * Runs relationship or load.
   * @param {string} relationshipName - Relationship name.
   * @returns {Promise<?>} - Loaded relationship value.
   */
  async relationshipOrLoad(relationshipName) {
    const relationship = this.getRelationshipByName(relationshipName)

    return await relationship.autoloadOrLoad()
  }

  /**
   * Runs get attachment by name.
   * @param {string} attachmentName - Attachment name.
   * @returns {RecordAttachmentHandle} - Attachment handle.
   */
  getAttachmentByName(attachmentName) {
    if (!(attachmentName in this._attachments)) {
      const attachmentDefinition = this.getModelClass().getAttachmentByName(attachmentName)

      this._attachments[attachmentName] = new RecordAttachmentHandle({
        model: this,
        name: attachmentName,
        type: attachmentDefinition.type
      })
    }

    return this._attachments[attachmentName]
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

    if (/**
         * Narrows the runtime value to the documented type.
          @type {?} */ (relationshipOptions)?.counterCache) {
      this._registerCounterCacheCallbacks(relationshipName)
    }
  }

  /**
   * Runs connection.
   * @param {object} [args] - Options.
   * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
   * @returns {import("../drivers/base.js").default} - The connection.
   */
  static connection({enforceTenantDatabaseScope = true, ...restArgs} = {}) {
    restArgsError(restArgs)

    const databasePool = this._getConfiguration().getDatabasePool(this.getDatabaseIdentifier({enforceTenantDatabaseScope}))
    const connection = databasePool.getCurrentConnection()

    if (!connection) throw new Error("No connection?")

    return connection
  }

  /**
   * Runs create.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {Record<string, ?>} [attributes] - Attributes.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the create.
   */
  static async create(attributes) {
    await this.ensureInitialized()

    const record = /**
                    * Narrows the runtime value to the documented type.
                     @type {InstanceType<MC>} */ (new this(attributes))

    await record.save()

    return record
  }

  /**
   * Runs get configuration.
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
   * Runs get configuration.
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
   * Rails-style declaration that this model accepts nested-attribute writes
   * for a relationship when saved through a parent. Required — Velocious
   * will refuse nested writes for any relationship not listed here, even
   * if a frontend-model resource permits them.
   *
   * Options:
   *   - allowDestroy: whether `_destroy: true` entries are allowed. Default false.
   *   - limit: optional upper bound on the number of nested entries per request.
   *   - rejectIf: optional predicate `(attributes) => boolean` that silently skips entries.
   *
   * Usage:
   *   class Project extends Record {}
   *   Project.hasMany("tasks")
   *   Project.acceptsNestedAttributesFor("tasks", {allowDestroy: true})
   * @param {string} relationshipName - Relationship name on this model.
   * @param {{allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ?>) => boolean}} [options] - Policy options.
   * @returns {void}
   */
  static acceptsNestedAttributesFor(relationshipName, options = {}) {
    if (!relationshipName || typeof relationshipName !== "string") {
      throw new Error(`Invalid relationshipName passed to acceptsNestedAttributesFor: ${relationshipName}`)
    }

    if (!Object.prototype.hasOwnProperty.call(this, "_acceptedNestedAttributes")) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ?>) => boolean}>} */
      this._acceptedNestedAttributes = {}
    }

    /**
     * Narrows the runtime value to the documented type.
      @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ?>) => boolean}>} */ (this._acceptedNestedAttributes)[relationshipName] = {...options}
  }

  /**
   * Runs accepted nested attributes for.
   * @param {string} relationshipName - Relationship name.
   * @returns {{allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ?>) => boolean} | null} - Policy declared via `acceptsNestedAttributesFor`, or null when not accepted.
   */
  static acceptedNestedAttributesFor(relationshipName) {
    return this._acceptedNestedAttributes?.[relationshipName] || null
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
   * Runs define attachment.
   * @param {string} attachmentName - Attachment name.
   * @param {object} args - Attachment args.
   * @param {string | AttachmentDriverConstructor | Record<string, ?>} [args.driver] - Attachment driver name, class, or instance.
   * @param {"hasOne" | "hasMany"} args.type - Attachment type.
   * @returns {void} - No return value.
   */
  static _defineAttachment(attachmentName, {driver, type}) {
    if (!attachmentName || typeof attachmentName !== "string") throw new Error(`Invalid attachment name: ${attachmentName}`)
    if (attachmentName in this.getAttachmentsMap()) throw new Error(`Attachment ${attachmentName} already exists`)

    this.getAttachmentsMap()[attachmentName] = {driver, type}

    const prototype = /**
                       * Narrows the runtime value to the documented type.
                        @type {Record<string, ?>} */ (/**
                                                       * Narrows the runtime value to the documented type.
                                                        @type {?} */ (this.prototype))

    prototype[attachmentName] = function() {
      return this.getAttachmentByName(attachmentName)
    }

      prototype[`set${inflection.camelize(attachmentName)}`] = function(/**
                                                                         * Narrows the runtime value to the documented type.
                                                                          @type {?} */ newValue) {
      this.getAttachmentByName(attachmentName).queueAttach(newValue)
      return newValue
    }
  }

  /**
   * Adds a single attachment helper to the model.
   * @param {string} attachmentName - Attachment name.
   * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ?>}} [args] - Attachment options.
   * @returns {void} - No return value.
   */
  static hasOneAttachment(attachmentName, args = {}) {
    this._defineAttachment(attachmentName, {driver: args.driver, type: "hasOne"})
  }

  /**
   * Adds a collection attachment helper to the model.
   * @param {string} attachmentName - Attachment name.
   * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ?>}} [args] - Attachment options.
   * @returns {void} - No return value.
   */
  static hasManyAttachments(attachmentName, args = {}) {
    this._defineAttachment(attachmentName, {driver: args.driver, type: "hasMany"})
  }

  /**
   * Runs human attribute name.
   * @param {string} attributeName - Attribute name.
   * @returns {string} - The human attribute name.
   */
  static humanAttributeName(attributeName) {
    const modelNameKey = inflection.underscore(this.getModelName())

    return this._getConfiguration().getTranslator()(`velocious.database.record.attributes.${modelNameKey}.${attributeName}`, {defaultValue: inflection.camelize(attributeName)})
  }

  /**
   * Runs get database type.
   * @returns {string} - The database type.
   */
  static getDatabaseType() {
    if (!this._databaseType) throw new Error("Database type hasn't been set")

    return this._databaseType
  }

  /**
   * Runs set eager load record metadata.
   * @param {boolean} eagerLoadRecordMetadata - Whether require-context initialization should load table metadata for this model.
   * @returns {void} - No return value.
   */
  static setEagerLoadRecordMetadata(eagerLoadRecordMetadata) {
    this._eagerLoadRecordMetadata = eagerLoadRecordMetadata
  }

  /**
   * Runs get eager load record metadata.
   * @returns {boolean} - Whether require-context initialization should load table metadata for this model.
   */
  static getEagerLoadRecordMetadata() {
    if (this._eagerLoadRecordMetadata === undefined) return true

    return this._eagerLoadRecordMetadata
  }

  /**
   * Runs reset record metadata.
   * @returns {void} - No return value.
   */
  static resetRecordMetadata() {
    this._initialized = false
    this._initializeRecordPromise = null
    this._databaseType = undefined
    this._table = undefined
    this._columns = undefined
    this._columnsAsHash = undefined
    this._columnNames = undefined
    this._columnTypeByName = undefined
    this._attributeNameToColumnName = undefined
    this._columnNameToAttributeName = undefined
  }

  /**
   * Registers the model class with a configuration without loading table metadata.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @returns {void} - No return value.
   */
  static registerRecordClass({configuration, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error(`No configuration given for ${this.name}`)

    this.resetRecordMetadata()
    this._configuration = configuration
    this._configuration.registerModelClass(this)
  }

  /**
   * Runs initialize record.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @returns {Promise<void>} - Resolves when complete.
   */
  static async initializeRecord({configuration, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error(`No configuration given for ${this.name}`)

    this.registerRecordClass({configuration})
    const connection = this.connection({enforceTenantDatabaseScope: false})

    this._databaseType = connection.getType()

    this._table = await connection.getTableByName(this.tableName())
    this._columns = await this._getTable().getColumns()

    /**
     * Narrows the runtime value to the documented type.
      @type {Record<string, import("../drivers/base-column.js").default>} */
    this._columnsAsHash = {}

    const columnNameToAttributeName = this.getColumnNameToAttributeNameMap()
    const attributeNameToColumnName = this.getAttributeNameToColumnNameMap()
    const prototype = /**
                       * Narrows the runtime value to the documented type.
                        @type {Record<string, ?>} */ (/**
                                                       * Narrows the runtime value to the documented type.
                                                        @type {?} */ (this.prototype))

    for (const column of this._columns) {
      this._columnsAsHash[column.getName()] = column

      const camelizedColumnName = inflection.camelize(column.getName(), true)
      const camelizedColumnNameBigFirst = inflection.camelize(column.getName())

      attributeNameToColumnName[camelizedColumnName] = column.getName()
      columnNameToAttributeName[column.getName()] = camelizedColumnName

      if (!(camelizedColumnName in prototype)) {
        prototype[camelizedColumnName] = function() {
          return this.readAttribute(camelizedColumnName)
        }
      }

      if (!(`set${camelizedColumnNameBigFirst}` in prototype)) {
        prototype[`set${camelizedColumnNameBigFirst}`] = function(/**
                                                                   * Narrows the runtime value to the documented type.
                                                                    @type {?} */ newValue) {
          return this._setColumnAttribute(camelizedColumnName, newValue)
        }
      }

      if (!(`has${camelizedColumnNameBigFirst}` in prototype)) {
        prototype[`has${camelizedColumnNameBigFirst}`] = function() {
          const dynamicThis = /**
                               * Narrows the runtime value to the documented type.
                                @type {Record<string, (...args: Array<?>) => ?>} */ (/**
                                                                                      * Narrows the runtime value to the documented type.
                                                                                       @type {?} */ (this))
          const value = dynamicThis[camelizedColumnName]()

          return this._hasAttribute(value)
        }
      }
    }

    await this._defineTranslationMethods()
    this._initialized = true
  }

  /**
   * Initializes the model class the first time an async record API needs table
   * metadata. Concurrent callers share the same initialization promise, and a
   * failed initialization can be retried by a later call.
   * @param {{configuration?: import("../../configuration.js").default}} [args] - Optional configuration override.
   * @returns {Promise<void>} - Resolves when the model class is initialized.
   */
  static async ensureInitialized(args = {}) {
    const {configuration, ...restArgs} = args

    restArgsError(restArgs)

    if (this._initialized) return

    if (this._initializeRecordPromise) {
      await this._initializeRecordPromise
      return
    }

    const resolvedConfiguration = configuration || this._configuration || Configuration.current()

    const initializeRecordPromise = this.initializeRecord({configuration: resolvedConfiguration})

    this._initializeRecordPromise = initializeRecordPromise

    try {
      await initializeRecordPromise
    } finally {
      if (this._initializeRecordPromise === initializeRecordPromise) {
        this._initializeRecordPromise = null
      }
    }
  }

  /**
   * Runs has attribute.
   * @param {?} value - Value to use.
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
   * Runs is initialized.
   * @returns {boolean} - Whether initialized.
   */
  static isInitialized() {
    if (this._initialized) return true

    return false
  }

  /**
   * Runs assert has been initialized.
   * @returns {void} - No return value.
   */
  static _assertHasBeenInitialized() {
    if (this._initialized) return

    throw new Error(`${this.name} used before initialization. Call ${this.name}.initializeRecord(...) or configuration.initialize().`)
  }

  static async _defineTranslationMethods() {
    if (this._translations && Object.keys(this._translations).length > 0) {
      const locales = this._getConfiguration().getLocales()

      if (!locales) throw new Error("Locales hasn't been set in the configuration")

      await this.getTranslationClass().initializeRecord({configuration: this._getConfiguration()})

      for (const name in this._translations) {
        const nameCamelized = inflection.camelize(name)
        const setterMethodName = `set${nameCamelized}`
        const prototype = /**
                           * Narrows the runtime value to the documented type.
                            @type {Record<string, ?>} */ (/**
                                                           * Narrows the runtime value to the documented type.
                                                            @type {?} */ (this.prototype))

        prototype[name] = function getTranslatedAttribute() {
          const locale = this._getConfiguration().getLocale()

          return this._getTranslatedAttributeWithFallback(name, locale)
        }

        prototype[`has${nameCamelized}`] = function hasTranslatedAttribute() {
          const dynamicThis = /**
                               * Narrows the runtime value to the documented type.
                                @type {Record<string, ?>} */ (/**
                                                               * Narrows the runtime value to the documented type.
                                                                @type {?} */ (this))
          const candidate = dynamicThis[name]

          if (typeof candidate == "function") {
            const value = candidate.bind(this)()

            return this._hasAttribute(value)
          } else {
            throw new Error(`Expected candidate to be a function but it was: ${typeof candidate}`)
          }
        }

        prototype[setterMethodName] = function setTranslatedAttribute(/**
                                                                       * Narrows the runtime value to the documented type.
                                                                        @type {?} */ newValue) {
          const locale = this._getConfiguration().getLocale()

          return this._setTranslatedAttribute(name, locale, newValue)
        }

        for (const locale of locales) {
          const localeCamelized = inflection.camelize(locale)
          const getterMethodNameLocalized = `${name}${localeCamelized}`
          const setterMethodNameLocalized = `${setterMethodName}${localeCamelized}`
          const hasMethodNameLocalized = `has${inflection.camelize(name)}${localeCamelized}`

          prototype[getterMethodNameLocalized] = function getTranslatedAttributeWithLocale() {
            return this._getTranslatedAttribute(name, locale)
          }

          prototype[setterMethodNameLocalized] = function setTranslatedAttributeWithLocale(/**
                                                                                            * Narrows the runtime value to the documented type.
                                                                                             @type {?} */ newValue) {
            return this._setTranslatedAttribute(name, locale, newValue)
          }

          prototype[hasMethodNameLocalized] = function hasTranslatedAttribute() {
            const dynamicThis = /**
                                 * Narrows the runtime value to the documented type.
                                  @type {Record<string, ?>} */ (/**
                                                                 * Narrows the runtime value to the documented type.
                                                                  @type {?} */ (this))
            const candidate = dynamicThis[getterMethodNameLocalized]

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
   * Runs get configured database identifier.
   * @returns {string} - The configured non-tenant database identifier.
   */
  static getConfiguredDatabaseIdentifier() {
    return this._databaseIdentifier || "default"
  }

  /**
   * Runs get database identifier.
   * @param {object} [args] - Options.
   * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
   * @returns {string} - The database identifier.
   */
  static getDatabaseIdentifier({enforceTenantDatabaseScope = true, ...restArgs} = {}) {
    restArgsError(restArgs)

    const tenant = Current.tenant()
    const tenantDatabaseIdentifier = this.getTenantDatabaseIdentifier(tenant)

    if (tenantDatabaseIdentifier) {
      if (
        enforceTenantDatabaseScope &&
        this._getConfiguration().getEnforceTenantDatabaseScopes() &&
        !this._getConfiguration().isDatabaseIdentifierActive(tenantDatabaseIdentifier, tenant)
      ) {
        throw new TenantDatabaseScopeError(
          `${this.getModelName()} resolved tenant database identifier ${JSON.stringify(tenantDatabaseIdentifier)} but that database identifier is not active for the current tenant. Wrap the model query in configuration.runWithTenant(...) or set enforceTenantDatabaseScopes: false to allow legacy fallback behavior.`,
          {modelName: this.getModelName()}
        )
      }

      return tenantDatabaseIdentifier
    }

    if (enforceTenantDatabaseScope && this._tenantDatabaseIdentifierResolver && this._getConfiguration().getEnforceTenantDatabaseScopes()) {
      throw new TenantDatabaseScopeError(
        `${this.getModelName()} is configured with switchesTenantDatabase(...) but no tenant database identifier resolved for the current tenant. Wrap the model query in configuration.runWithTenant(...) or set enforceTenantDatabaseScopes: false to allow legacy fallback behavior.`,
        {modelName: this.getModelName()}
      )
    }

    return this.getConfiguredDatabaseIdentifier()
  }

  /**
   * Runs set database identifier.
   * @param {string} databaseIdentifier - Database identifier.
   * @returns {void} - No return value.
   */
  static setDatabaseIdentifier(databaseIdentifier) {
    this._databaseIdentifier = databaseIdentifier
  }

  /**
   * Declares a tenant-aware database identifier resolver for this model class.
   * @param {string | ((args: {modelClass: typeof VelociousDatabaseRecord, tenant: ?}) => string | undefined)} databaseIdentifierOrResolver - Static identifier or resolver.
   * @returns {void} - No return value.
   */
  static switchesTenantDatabase(databaseIdentifierOrResolver) {
    this._tenantDatabaseIdentifierResolver = databaseIdentifierOrResolver
  }

  /**
   * Runs get tenant database identifier.
   * @param {?} [tenant] - Tenant override.
   * @returns {string | undefined} - Tenant-scoped database identifier when configured.
   */
  static getTenantDatabaseIdentifier(tenant = Current.tenant()) {
    const tenantDatabaseIdentifierResolver = this._tenantDatabaseIdentifierResolver

    if (!tenantDatabaseIdentifierResolver) {
      return
    }

    if (typeof tenantDatabaseIdentifierResolver === "function") {
      return tenantDatabaseIdentifierResolver({
        modelClass: this,
        tenant
      })
    }

    return tenantDatabaseIdentifierResolver
  }

  /**
   * Runs get attribute.
   * @param {string} name - Name.
   * @returns {?} - The attribute.
   */
  getAttribute(name) {
    const columnName = inflection.underscore(name)

    if (!this.isNewRecord() && !(columnName in this._attributes)) {
      throw new Error(`${this.constructor.name}#${name} attribute hasn't been loaded yet in ${Object.keys(this._attributes).join(", ")}`)
    }

    return this._attributes[columnName]
  }

  /**
   * Runs get model class.
   * @abstract
   * @returns {typeof VelociousDatabaseRecord} - The model class.
   */
  getModelClass() {
    const modelClass = /**
                        * Narrows the runtime value to the documented type.
                         @type {typeof VelociousDatabaseRecord} */ (this.constructor)

    return modelClass
  }

  /**
   * Runs set attribute.
   * @param {string} name - Name.
   * @param {?} newValue - New value.
   * @returns {void} - No return value.
   */
  setAttribute(name, newValue) {
    const setterName = `set${inflection.camelize(name)}`
    const dynamicThis = /**
                         * Narrows the runtime value to the documented type.
                          @type {Record<string, (value: ?) => void>} */ (/**
                                                                          * Narrows the runtime value to the documented type.
                                                                           @type {?} */ (this))

    this.getModelClass()._assertHasBeenInitialized()
    if (!this.getModelClass().isInitialized()) throw new Error(`${this.constructor.name} model isn't initialized yet`)
    if (!(setterName in this)) throw new Error(`No such setter method: ${this.constructor.name}#${setterName}`)

    dynamicThis[setterName](newValue)
  }

  /**
   * Runs set column attribute.
   * @param {string} name - Name.
   * @param {?} newValue - New value.
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

    normalizedValue = this._normalizeBooleanValueForWrite({attributeName: name, columnType, value: normalizedValue})

    if (this._attributes[columnName] != normalizedValue) {
      this._clearBelongsToRelationshipForChangedForeignKey(columnName, normalizedValue)
      this._changes[columnName] = normalizedValue
    }
  }

  /**
   * Clears loaded belongs-to caches when callers assign the foreign key directly.
   * @param {string} columnName - Changed database column name.
   * @param {?} normalizedValue - New normalized column value.
   * @returns {void} - No return value.
   */
  _clearBelongsToRelationshipForChangedForeignKey(columnName, normalizedValue) {
    for (const relationship of this._belongsToRelationshipsForForeignKey(columnName)) {
      if (this._belongsToRelationshipMatchesForeignKeyValue({normalizedValue, relationship})) continue

      this._clearLoadedBelongsToRelationship(relationship)
    }
  }

  /**
   * Runs belongs to relationships for foreign key.
   * @param {string} columnName - Changed database column name.
   * @returns {Array<?>} - Loaded relationship instances that use the changed foreign key.
   */
  _belongsToRelationshipsForForeignKey(columnName) {
    if (!this._instanceRelationships) return []

    return Object
      .values(this._instanceRelationships)
      .filter((relationship) => this._belongsToRelationshipUsesForeignKey({columnName, relationship}))
  }

  /**
   * Runs belongs to relationship uses foreign key.
   * @param {object} args - Relationship match arguments.
   * @param {string} args.columnName - Changed database column name.
   * @param {?} args.relationship - Relationship instance.
   * @returns {boolean} - Whether the relationship is a belongs-to using the changed foreign key.
   */
  _belongsToRelationshipUsesForeignKey({columnName, relationship}) {
    if (relationship.getType() != "belongsTo") return false

    return relationship.getForeignKey() == columnName
  }

  /**
   * Runs belongs to relationship matches foreign key value.
   * @param {object} args - Relationship cache arguments.
   * @param {?} args.normalizedValue - New normalized column value.
   * @param {?} args.relationship - Relationship instance.
   * @returns {boolean} - Whether the loaded related record still matches the changed foreign key.
   */
  _belongsToRelationshipMatchesForeignKeyValue({normalizedValue, relationship}) {
    const loaded = relationship.getLoadedOrUndefined()

    if (!loaded) return false
    if (Array.isArray(loaded)) return false
    if (!relationship.getTargetModelClass()) return false

    return loaded.readColumn(relationship.getPrimaryKey()) == normalizedValue
  }

  /**
   * Runs clear loaded belongs to relationship.
   * @param {?} relationship - Relationship instance.
   * @returns {void} - No return value.
   */
  _clearLoadedBelongsToRelationship(relationship) {
    relationship.setLoaded(undefined)
    relationship.setPreloaded(false)
    relationship.setDirty(false)
  }

  /**
   * Runs normalize date value.
   * @param {?} value - Value to use.
   * @returns {?} - The date value.
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
   * Runs normalize sqlite boolean value.
   * @param {object} args - Options object.
   * @param {string | undefined} args.columnType - Column type.
   * @param {?} args.value - Value to normalize.
   * @returns {?} - Normalized value.
   */
  _normalizeSqliteBooleanValue({columnType, value}) {
    if (this.getModelClass().getDatabaseType() != "sqlite") return value
    if (!columnType) return value
    if (columnType.toLowerCase() !== "boolean") return value
    if (value === true) return 1
    if (value === false) return 0

    return value
  }

  /**
   * Normalizes a boolean value before storing. A declared `"boolean"` attribute cast stores
   * booleans as 1/0 only for integer-backed columns (e.g. an MSSQL `bit`). Columns whose
   * underlying type is already a native boolean (e.g. Postgres `boolean`) keep `true`/`false`
   * so the driver can emit the proper boolean literal; otherwise the sqlite-only normalizer applies.
   * @param {object} args - Options object.
   * @param {string} args.attributeName - Attribute name being written.
   * @param {string | undefined} args.columnType - Column type.
   * @param {?} args.value - Value to normalize.
   * @returns {?} - Normalized value.
   */
  _normalizeBooleanValueForWrite({attributeName, columnType, value}) {
    if (!this.getModelClass()._declaredBooleanStoresAsInteger(attributeName)) {
      return this._normalizeSqliteBooleanValue({columnType, value})
    }

    if (value === true) return 1
    if (value === false) return 0

    return value
  }

  /**
   * Whether a declared `"boolean"` attribute cast is backed by an integer column (e.g. an MSSQL
   * `bit`), so booleans must be stored as 1/0. A native boolean column (e.g. Postgres `boolean`)
   * returns false and keeps `true`/`false` for the driver.
   * @param {string} attributeName - Attribute name.
   * @returns {boolean} - Whether the declared boolean is stored as an integer.
   */
  static _declaredBooleanStoresAsInteger(attributeName) {
    if (this.getAttributeCast(attributeName) !== "boolean") return false

    const columnName = this.getAttributeNameToColumnNameMap()[attributeName]
    const introspectedType = columnName ? this.getColumnsHash()[columnName]?.getType() : undefined

    return typeof introspectedType === "string" && introspectedType.toLowerCase() !== "boolean"
  }

  /**
   * Runs get columns.
   * @returns {import("../drivers/base-column.js").default[]} - The columns.
   */
  static getColumns() {
    this._assertHasBeenInitialized()
    if (!this._columns) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._columns
  }

  /**
   * Runs get columns hash.
   * @returns {Record<string, import("../drivers/base-column.js").default>} - The columns hash.
   */
  static getColumnsHash() {
    if (!this._columnsAsHash) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, import("../drivers/base-column.js").default>} */
      this._columnsAsHash = {}

      for (const column of this.getColumns()) {
        this._columnsAsHash[column.getName()] = column
      }
    }

    return this._columnsAsHash
  }

  /**
   * Runs get column type by name.
   * @param {string} name - Name.
   * @returns {string | undefined} - The column type by name.
   */
  static getColumnTypeByName(name) {
    if (!this._columnTypeByName) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, string | undefined>} */
      this._columnTypeByName = {}

      for (const column of this.getColumns()) {
        this._columnTypeByName[column.getName()] = column.getType()
      }
    }

    const attributeName = this.getColumnNameToAttributeNameMap()[name]

    if (attributeName) {
      const cast = this.getAttributeCast(attributeName)

      if (cast) return cast
    }

    return this._columnTypeByName[name]
  }

  /**
   * Runs is date like type.
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
   * Runs get column names.
   * @returns {Array<string>} - The column names.
   */
  static getColumnNames() {
    if (!this._columnNames) {
      this._columnNames = this.getColumns().map((column) => column.getName())
    }

    return this._columnNames
  }

  /**
   * Runs get table.
   * @returns {import("../drivers/base-table.js").default} - The table.
   */
  static _getTable() {
    if (!this._table) throw new Error(`${this.name} hasn't been initialized yet`)

    return this._table
  }

  /**
   * Runs insert multiple.
   * @param {Array<string>} columns - Column names.
   * @param {Array<Array<?>>} rows - Rows to insert.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.cast] - Whether to cast values based on column types.
   * @param {boolean} [args.retryIndividuallyOnFailure] - Retry rows individually if a batch insert fails.
   * @param {boolean} [args.returnResults] - Return succeeded/failed rows instead of throwing when retries fail.
   * @returns {Promise<void | {succeededRows: Array<Array<?>>, failedRows: Array<Array<?>>, errors: Array<{row: Array<?>, error: ?}>}>} - Resolves when complete.
   */
  static async insertMultiple(columns, rows, args = {}) {
    const {cast = true, retryIndividuallyOnFailure = false, returnResults = false, ...restArgs} = args

    restArgsError(restArgs)
    await this.ensureInitialized()

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
      // Wrap the batch in a transaction/savepoint. On databases that abort the
      // whole transaction when a statement fails (PostgreSQL), a failed batch
      // would otherwise poison the surrounding transaction so that the
      // individual retries below all fail with "current transaction is aborted".
      // transaction() opens a savepoint when already inside a transaction and a
      // real transaction otherwise, so a failure rolls back only this attempt.
      await this.connection().transaction(async () => {
        await this.connection().insertMultiple(tableName, columns, normalizedRows)
      })
      if (returnResults) return {succeededRows: normalizedRows.slice(), failedRows: [], errors: []}
      return
    } catch {
      /**
       * Results.
        @type {{succeededRows: Array<?>[], failedRows: Array<?>[], errors: Array<{row: Array<?>, error: ?}>}} */
      const results = {
        succeededRows: [],
        failedRows: [],
        errors: []
      }

      for (const row of normalizedRows) {
        try {
          // Each retry runs in its own savepoint so a failed row rolls back only
          // that row and leaves the surrounding transaction usable for the rest.
          await this.connection().transaction(async () => {
            await this.connection().insertMultiple(tableName, columns, [row])
          })
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
   * Runs normalize insert multiple rows.
   * @param {object} args - Options object.
   * @param {Array<string>} args.columns - Column names.
   * @param {Array<Array<?>>} args.rows - Rows to insert.
   * @returns {Array<Array<?>>} - Normalized rows.
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
   * Runs safe serialize insert row.
   * @param {Array<?>} row - Row to serialize.
   * @returns {string} - Safe row representation.
   */
  static _safeSerializeInsertRow(row) {
    return formatValue(row)
  }

  /**
   * Runs normalize insert value for column.
   * @param {object} args - Options object.
   * @param {string} args.columnName - Column name.
   * @param {?} args.value - Column value.
   * @returns {?} - Normalized value.
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
   * Runs is string type.
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
   * Runs is numeric type.
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
   * Runs normalize numeric value.
   * @param {object} args - Options object.
   * @param {string} args.columnType - Column type.
   * @param {?} args.value - Value to normalize.
   * @returns {?} - Normalized value.
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
   * Runs normalize date value for insert.
   * @param {?} value - Value to normalize.
   * @returns {?} - Normalized value.
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
   * Runs normalize date string for insert.
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
   * Runs normalize sqlite boolean value for insert.
   * @param {object} args - Options object.
   * @param {string | undefined} args.columnType - Column type.
   * @param {?} args.value - Value to normalize.
   * @returns {?} - Normalized value.
   */
  static _normalizeSqliteBooleanValueForInsert({columnType, value}) {
    if (this.getDatabaseType() != "sqlite") return value
    if (!columnType) return value
    if (columnType.toLowerCase() !== "boolean") return value
    if (value === true) return 1
    if (value === false) return 0

    return value
  }

  /**
   * Runs next primary key.
   * @returns {Promise<number>} - Resolves with the next primary key.
   */
  static async nextPrimaryKey() {
    await this.ensureInitialized()

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
   * Runs set primary key.
   * @param {string} primaryKey - Primary key.
   * @returns {void} - No return value.
   */
  static setPrimaryKey(primaryKey) {
    this._primaryKey = primaryKey
  }

  /**
   * Returns this class's own attribute-cast map, creating it on the class itself
   * (never inherited from a parent) so subclasses don't share the same object.
   * @returns {Record<string, string>} - Declared casts keyed by attribute name.
   */
  static getAttributeCastsMap() {
    if (!Object.prototype.hasOwnProperty.call(this, "_attributeCasts") || !this._attributeCasts) {
      /**
       * Narrows the runtime value to the documented type.
        @type {Record<string, string>} */
      this._attributeCasts = {}
    }

    return this._attributeCasts
  }

  /**
   * Declares a Rails-style per-attribute cast so a column whose introspected type
   * isn't what the app wants (e.g. an MSSQL `bit` mapped to `number`) can be
   * exposed as another type with real runtime conversion. Currently fully
   * implements the `"boolean"` cast (0/1 <-> false/true); other types only record
   * the label so the effective type and generated typings reflect them.
   * @param {string} attributeName - Attribute name (camelCase), e.g. `"sichtbarVVK"`.
   * @param {string} type - Declared type, e.g. `"boolean"`.
   * @returns {void} - No return value.
   */
  static attribute(attributeName, type) {
    this.getAttributeCastsMap()[attributeName] = type
  }

  /**
   * Returns the declared cast type for an attribute, if any.
   * @param {string} attributeName - Attribute name (camelCase).
   * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
   */
  static getAttributeCast(attributeName) {
    return this.getAttributeCastsMap()[attributeName]
  }

  /**
   * Runs primary key.
   * @returns {string} - The primary key.
   */
  static primaryKey() {
    if (this._primaryKey) return this._primaryKey

    return "id"
  }

  /**
   * Runs save.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async save() {
    const isNewRecord = this.isNewRecord()
    let result

    await this._getConfiguration().ensureConnections({name: `${this.getModelClass().name} save`}, async () => {
      await this._runLifecycleCallbacks("beforeValidation")
      await this._runValidations()

      await this.getModelClass().transaction(async () => {
        await this._runLifecycleCallbacks("beforeSave")

        // If any belongs-to-relationships was saved, then updated-at should still be set on this record.
        const {savedCount} = await this._autoSaveBelongsToRelationships()

        if (this.isPersisted()) {
          await this._runLifecycleCallbacks("beforeUpdate")

          // If any has-many-relationships will be saved, then updated-at should still be set on this record.
          const autoSaveHasManyrelationships = this._autoSaveHasManyAndHasOneRelationshipsToSave()

          if (this._hasChanges() || savedCount > 0 || autoSaveHasManyrelationships.length > 0) {
            result = await this._updateRecordWithChanges()
          }

          await this._runLifecycleCallbacks("afterUpdate")
        } else {
          await this._runLifecycleCallbacks("beforeCreate")
          result = await this._createNewRecord()
          await this._runLifecycleCallbacks("afterCreate")
        }

        await this._autoSaveHasManyAndHasOneRelationships({isNewRecord})
        await this._autoSaveAttachments()
        await this._runLifecycleCallbacks("afterSave")
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

      const model = instanceRelationship.getLoadedOrUndefined()

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

      /**
       * Defines loaded.
        @type {VelociousDatabaseRecord[]} */
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
   * Runs auto save has many and has one relationships.
   * @param {object} args - Options object.
   * @param {boolean} args.isNewRecord - Whether is new record.
   */
  async _autoSaveHasManyAndHasOneRelationships({isNewRecord}) {
    for (const instanceRelationship of this._autoSaveHasManyAndHasOneRelationshipsToSave()) {
      let hasManyOrOneLoaded = instanceRelationship.getLoadedOrUndefined()

      /**
       * Defines loaded.
        @type {VelociousDatabaseRecord[]} */
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
   * Runs auto save attachments.
   * @returns {Promise<void>} - Resolves when pending attachments have been saved.
   */
  async _autoSaveAttachments() {
    for (const attachmentName in this._attachments) {
      const attachment = this._attachments[attachmentName]

      if (!attachment.hasPendingAttachments()) continue

      await attachment.flushPendingAttachments()
    }
  }

  /**
   * Runs table name.
   * @returns {string} - The table name.
   */
  static tableName() {
    if (!this._tableName) this._tableName = inflection.underscore(inflection.pluralize(this.getModelName()))

    return this._tableName
  }

  /**
   * Runs set table name.
   * @param {string} tableName - Table name.
   * @returns {void} - No return value.
   */
  static setTableName(tableName) {
    this._tableName = tableName
  }

  /**
   * Runs transaction.
   * @param {function() : Promise<void>} callback - Callback function.
   * @returns {Promise<?>} - Resolves with the transaction.
   */
  static async transaction(callback) {
    await this.ensureInitialized()

    const useTransactions = this.connection().getArgs().record?.transactions

    if (useTransactions !== false) {
      return await this.connection().transaction(callback)
    } else {
      return await callback()
    }
  }

  /**
   * Runs the callback while holding a named advisory lock on the current
   * connection. Advisory locks are cooperative and connection-scoped: they
   * serialize callers that opt into the same `name`, without touching row
   * or table locks, so unrelated traffic is free to proceed.
   *
   * The lock is acquired before the callback runs and released in a
   * `finally` block afterwards, so the callback's return value is
   * propagated and thrown errors still release the lock.
   * @template T
   * @param {string} name - Lock name.
   * @param {() => Promise<T>} callback - Callback to invoke while the lock is held.
   * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null}} [args] - `timeoutMs` caps how long we wait to acquire the lock; `holdTimeoutMs` caps how long the callback may hold it before the lock is released and `AdvisoryLockHoldTimeoutError` is thrown.
   * @returns {Promise<T>} - Resolves with the callback's return value.
   * @throws {AdvisoryLockTimeoutError} - If `timeoutMs` elapses before the lock is granted.
   * @throws {AdvisoryLockHoldTimeoutError} - If `holdTimeoutMs` elapses while the callback holds the lock.
   */
  static async withAdvisoryLock(name, callback, args = {}) {
    await this.ensureInitialized()

    const connection = this.connection()
    const acquired = await connection.acquireAdvisoryLock(name, args)

    if (!acquired) {
      throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)}`, {name})
    }

    try {
      return await this.runWithAdvisoryLockHoldTimeout(name, callback, args.holdTimeoutMs)
    } finally {
      await connection.releaseAdvisoryLock(name)
    }
  }

  /**
   * Runs the callback only if the named advisory lock can be acquired
   * immediately. If the lock is already held by any session, throws
   * `AdvisoryLockBusyError` without waiting.
   * Use this when contention is a signal that somebody else is already
   * doing the work and you want to bail out rather than queue up.
   * @template T
   * @param {string} name - Lock name.
   * @param {() => Promise<T>} callback - Callback to invoke while the lock is held.
   * @param {{holdTimeoutMs?: number | null}} [args] - `holdTimeoutMs` caps how long the callback may hold the lock before it is released and `AdvisoryLockHoldTimeoutError` is thrown.
   * @returns {Promise<T>} - Resolves with the callback's return value.
   * @throws {AdvisoryLockBusyError} - If the lock is already held.
   * @throws {AdvisoryLockHoldTimeoutError} - If `holdTimeoutMs` elapses while the callback holds the lock.
   */
  static async withAdvisoryLockOrFail(name, callback, args = {}) {
    await this.ensureInitialized()

    const connection = this.connection()
    const acquired = await connection.tryAcquireAdvisoryLock(name)

    if (!acquired) {
      throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held`, {name})
    }

    try {
      return await this.runWithAdvisoryLockHoldTimeout(name, callback, args.holdTimeoutMs)
    } finally {
      await connection.releaseAdvisoryLock(name)
    }
  }

  /**
   * Runs `callback`, rejecting with `AdvisoryLockHoldTimeoutError` if it has
   * not settled within `holdTimeoutMs`. The caller's `finally` then releases
   * the lock, so a hung holder can't block other sessions forever. The
   * callback is not cancelled — this is a safety net, not cancellation.
   *
   * Uses `awaitery`'s shared `timeout` helper for the hard timeout, then
   * translates its timeout into the typed `AdvisoryLockHoldTimeoutError` so
   * callers can catch it like the other advisory-lock errors. A `callbackSettled`
   * flag distinguishes the timeout from a rejection thrown by the callback
   * itself, which is rethrown unchanged.
   * @template T
   * @param {string} name - Lock name (for the error message).
   * @param {() => Promise<T>} callback - Callback holding the lock.
   * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
   * @returns {Promise<T>}
   */
  static async runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs) {
    if (!holdTimeoutMs || holdTimeoutMs <= 0) {
      return await callback()
    }

    let callbackSettled = false

    try {
      return await timeout({timeout: holdTimeoutMs}, async () => {
        try {
          return await callback()
        } finally {
          callbackSettled = true
        }
      })
    } catch (error) {
      if (!callbackSettled) {
        throw new AdvisoryLockHoldTimeoutError(`Advisory lock ${JSON.stringify(name)} held longer than ${holdTimeoutMs}ms`, {name})
      }

      throw error
    }
  }

  /**
   * Returns true if the named advisory lock is currently held by any
   * session. Primarily useful as a diagnostic; callers that want to act
   * on the result should prefer `withAdvisoryLockOrFail` to avoid a
   * TOCTOU window between the check and the action.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Whether the advisory lock is currently held.
   */
  static async hasAdvisoryLock(name) {
    await this.ensureInitialized()

    return await this.connection().isAdvisoryLockHeld(name)
  }

  /**
   * Runs translates.
   * @param {...string} names - Names.
   * @returns {void} - No return value.
   */
  static translates(...names) {
    const translations = this.getTranslationsMap()

    for (const name of names) {
      if (name in translations) throw new Error(`Translation already exists: ${name}`)

      translations[name] = {}

      if (!this._relationshipExists("translations")) {
        this._defineRelationship("translations", {dependent: "destroy", klass: this.getTranslationClass(), type: "hasMany"})
      }

      if (!this._relationshipExists("currentTranslation")) {
        this._defineRelationship("currentTranslation", {
          klass: this.getTranslationClass(),
          scope: (query) => this.currentTranslationScope(query),
          type: "hasOne"
        })
      }
    }
  }

  /**
   * Runs current translation scope.
   * @param {ModelClassQuery} query - Translation query.
   * @returns {ModelClassQuery} - Scoped query.
   */
  static currentTranslationScope(query) {
    const configuration = this._getConfiguration()
    const locale = configuration.getLocale()
    const fallbacks = configuration.getLocaleFallbacks()
    const locales = locale ? (fallbacks?.[locale] || [locale]) : []

    if (locales.length === 0) return query.where("1=0")

    const driver = query.driver
    const translationClass = this.getTranslationClass()
    const relationship = this.getRelationshipByName("currentTranslation")
    const tableName = translationClass.tableName()
    const scopeTableReference = `${tableName}_current_translation_scope`
    const targetTableSql = driver.quoteTable(query.getTableReferenceForJoin())
    const scopeTableSql = driver.quoteTable(scopeTableReference)
    const scopeTableFromSql = `${driver.quoteTable(tableName)} AS ${scopeTableSql}`
    const primaryKeyColumn = translationClass.primaryKey()
    const foreignKeyColumn = relationship.getForeignKey()
    const targetPrimaryKeySql = `${targetTableSql}.${driver.quoteColumn(primaryKeyColumn)}`
    const targetForeignKeySql = `${targetTableSql}.${driver.quoteColumn(foreignKeyColumn)}`
    const scopePrimaryKeySql = `${scopeTableSql}.${driver.quoteColumn(primaryKeyColumn)}`
    const scopeForeignKeySql = `${scopeTableSql}.${driver.quoteColumn(foreignKeyColumn)}`
    const scopeLocaleSql = `${scopeTableSql}.${driver.quoteColumn("locale")}`
    const localeListSql = locales.map((fallbackLocale) => driver.quote(fallbackLocale)).join(", ")
    const localeOrderSql = locales.map((fallbackLocale, index) => `WHEN ${scopeLocaleSql} = ${driver.quote(fallbackLocale)} THEN ${driver.quote(index)}`).join(" ")
    const fallbackOrderSql = `CASE ${localeOrderSql} ELSE ${driver.quote(locales.length)} END`
    const selectedTranslationSql = driver.getType() == "mssql"
      ? `SELECT TOP 1 ${scopePrimaryKeySql} FROM ${scopeTableFromSql} WHERE ${scopeForeignKeySql} = ${targetForeignKeySql} AND ${scopeLocaleSql} IN (${localeListSql}) ORDER BY ${fallbackOrderSql}, ${scopePrimaryKeySql} ASC`
      : `SELECT ${scopePrimaryKeySql} FROM ${scopeTableFromSql} WHERE ${scopeForeignKeySql} = ${targetForeignKeySql} AND ${scopeLocaleSql} IN (${localeListSql}) ORDER BY ${fallbackOrderSql}, ${scopePrimaryKeySql} ASC LIMIT 1`

    return query.where(`${targetPrimaryKeySql} = (${selectedTranslationSql})`)
  }

  /**
   * Runs get translation class.
   * @returns {typeof VelociousDatabaseRecord} - The translation class.
   */
  static getTranslationClass() {
    if (this._translationClass) return this._translationClass
    if (this.tableName().endsWith("_translations")) throw new Error("Trying to define a translations class for a translation class")

    const className = `${this.getModelName()}Translation`
    const TranslationClass = class Translation extends VelociousDatabaseRecord {}
    const belongsTo = singularizeModelName(inflection.camelize(this.tableName(), true))

    Object.defineProperty(TranslationClass, "name", {value: className})
    TranslationClass.setTableName(this.getTranslationsTableName())
    TranslationClass.belongsTo(belongsTo)

    this._translationClass = TranslationClass

    return this._translationClass
  }

  /**
   * Runs get translations table name.
   * @returns {string} - The translations table name.
   */
  static getTranslationsTableName() {
    const tableNameParts = this.tableName().split("_")

    tableNameParts[tableNameParts.length - 1] = inflection.singularize(tableNameParts[tableNameParts.length - 1])

    return `${tableNameParts.join("_")}_translations`
  }

  /**
   * Runs has translations table.
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
   * @param {Record<string, boolean | Record<string, ?>>} validators The validators to add. Key is the validator name, value is the validator arguments.
   */
  static async validates(attributeName, validators) {
    for (const validatorName in validators) {
      /**
       * Defines validatorArgs.
        @type {Record<string, ?>} */
      let validatorArgs

      /**
       * Use validator.
        @type {boolean} */
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
   * Registers gap-less positional list callbacks for a column scoped by
   * another column. Inserts and moves shift surrounding positions so the
   * list stays compact (1,2,3,...). Destroys close the resulting gap.
   *
   * Callers must ensure a UNIQUE index on (scopeColumn, positionColumn)
   * exists in the database — use `Migration.addActsAsList()` for the
   * schema half.
   * @param {string} positionColumn - camelCase position attribute (e.g. "rowNumber").
   * @param {object} options - Options with a required scope attribute.
   * @param {string} options.scope - camelCase scope attribute (e.g. "boardColumnId").
   */
  static actsAsList(positionColumn, options) {
    const {scope} = options

    registerActsAsListCallbacks(this, positionColumn, {scope})
  }

  /**
   * Runs translations loaded.
   * @abstract
   * @returns {TranslationBase[]} - The translations loaded.
   */
  translationsLoaded() {
    throw new Error("'translationsLoaded' not implemented")
  }

  /**
   * Runs get translated attribute.
   * @param {string} name - Name.
   * @param {string} locale - Locale.
   * @returns {string | undefined} - The translated attribute, if found.
   */
  _getTranslatedAttribute(name, locale) {
    const translation = this.translationsLoaded().find((translation) => translation.locale() == locale)

    if (translation) {
      /**
       * Dict.
        @type {Record<string, ?>} */
      const dict = translation

      const attributeMethod = /**
                               * Narrows the runtime value to the documented type.
                                @type {function() : string | undefined} */ (dict[name])

      if (typeof attributeMethod == "function") {
        return attributeMethod.bind(translation)()
      } else {
        throw new Error(`No such translated method: ${name} (${typeof attributeMethod})`)
      }
    }

    return undefined
  }

  /**
   * Runs get translated attribute with fallback.
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
   * Runs set translated attribute.
   * @param {string} name - Name.
   * @param {string} locale - Locale.
   * @param {?} newValue - New value.
   * @returns {void} - No return value.
   */
  _setTranslatedAttribute(name, locale, newValue) {
    /**
     * Defines translation.
      @type {VelociousDatabaseRecord | TranslationBase | undefined} */
    let translation

    translation = this.translationsLoaded()?.find((translation) => translation.locale() == locale)

    if (!translation) {
      const instanceRelationship = this.getRelationshipByName("translations")

      translation = instanceRelationship.build({locale})
    }

    /**
     * Assignments.
      @type {Record<string, ?>} */
    const assignments = {}

    assignments[name] = newValue

    translation.assign(assignments)
  }

  /**
   * Runs new query.
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

  /**
   * Runs orderable column.
   * @returns {string} - The orderable column.
   */
  static orderableColumn() {
    // FIXME: Allow to change to 'created_at' if using UUID?

    return this.primaryKey()
  }

  /**
   * Runs all.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {ModelClassQuery<MC>} - The all.
   */
  static all() {
    return this._newQuery()
  }

  /**
   * Runs accessible for.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string} action - Ability action to scope by.
   * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
   * @returns {ModelClassQuery<MC>} - Authorized query.
   */
  static accessibleFor(action, ability) {
    const query = this._newQuery()
    const currentAbility = ability || Current.ability()

    if (!currentAbility) {
      throw new Error(`No ability in context for ${this.name}. Pass an ability or configure ability resolver on the request`)
    }

    return /** Narrows the runtime value to the documented type. @type {ModelClassQuery<MC>} */ (currentAbility.applyToQuery({
      action,
      modelClass: this,
      query
    }))
  }

  /**
   * Runs accessible.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
   * @returns {ModelClassQuery<MC>} - Authorized query.
   */
  static accessible(ability) {
    return this.accessibleFor("read", ability)
  }

  /**
   * Runs accessible by.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../../authorization/ability.js").default} ability - Ability instance.
   * @returns {ModelClassQuery<MC>} - Authorized query.
   */
  static accessibleBy(ability) {
    if (!ability) {
      throw new Error(`No ability passed to ${this.name}.accessibleBy(ability).`)
    }

    return this.accessible(ability)
  }

  /**
   * Runs count.
   * @returns {Promise<number>} - Resolves with the count.
   */
  static async count() {
    await this.ensureInitialized()

    return await this._newQuery().count()
  }

  /**
   * Runs group.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string} group - Group.
   * @returns {ModelClassQuery<MC>} - The group.
   */
  static group(group) {
    return this._newQuery().group(group)
  }

  static async destroyAll() {
    await this.ensureInitialized()

    return await this._newQuery().destroyAll()
  }

  /**
   * Runs pluck.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {...string|string[]} columns - Column names.
   * @returns {Promise<Array<?>>} - Resolves with the pluck.
   */
  static async pluck(...columns) {
    await this.ensureInitialized()

    return await this._newQuery().pluck(...columns)
  }

  /**
   * Runs find.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {number|string} recordId - Record id.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
   */
  static async find(recordId) {
    await this.ensureInitialized()

    return await this._newQuery().find(recordId)
  }

  /**
   * Runs find by.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
   */
  static async findBy(conditions) {
    await this.ensureInitialized()

    return await this._newQuery().findBy(conditions)
  }

  /**
   * Runs find by or fail.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
   */
  static async findByOrFail(conditions) {
    await this.ensureInitialized()

    return await this._newQuery().findByOrFail(conditions)
  }

  /**
   * Runs find or create by.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @param {function() : void} [callback] - Callback function.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
   */
  static async findOrCreateBy(conditions, callback) {
    await this.ensureInitialized()

    return await this._newQuery().findOrCreateBy(conditions, callback)
  }

  /**
   * Runs find or initialize by.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {Record<string, string | number>} conditions - Conditions.
   * @param {function(InstanceType<MC>) : void} [callback] - Callback function.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
   */
  static async findOrInitializeBy(conditions, callback) {
    await this.ensureInitialized()

    return await this._newQuery().findOrInitializeBy(conditions, callback)
  }

  /**
   * Runs first.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>>} - Resolves with the first.
   */
  static async first() {
    await this.ensureInitialized()

    const result = await this._newQuery().first()

    if (!result) throw new Error(`${this.name}.first() returned no records`)

    return result
  }

  /**
   * Runs joins.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {string | import("../query/join-object.js").JoinObject} join - Join clause or join descriptor.
   * @returns {ModelClassQuery<MC>} - The joins.
   */
  static joins(join) {
    return this._newQuery().joins(join)
  }

  /**
   * Runs last.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>>} - Resolves with the last.
   */
  static async last() {
    await this.ensureInitialized()

    const result = await this._newQuery().last()

    if (!result) throw new Error(`${this.name}.last() returned no records`)

    return result
  }

  /**
   * Runs limit.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {number} value - Value to use.
   * @returns {ModelClassQuery<MC>} - The limit.
   */
  static limit(value) {
    return this._newQuery().limit(value)
  }

  /**
   * Runs order.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").OrderArgumentType} order - Order.
   * @returns {ModelClassQuery<MC>} - The order.
   */
  static order(order) {
    return this._newQuery().order(order)
  }

  /**
   * Runs distinct.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {boolean} [value] - Value to use.
   * @returns {ModelClassQuery<MC>} - The distinct.
   */
  static distinct(value = true) {
    return this._newQuery().distinct(value)
  }

  /**
   * Runs preload.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>} preload - Preload.
   * @returns {ModelClassQuery<MC>} - The preload.
   */
  static preload(preload) {
    const query = /**
                   * Narrows the runtime value to the documented type.
                    @type {ModelClassQuery<MC>} */ (this._newQuery().preload(preload))

    return query
  }

  /**
   * Runs select.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").SelectArgumentType} select - Select.
   * @returns {ModelClassQuery<MC>} - The select.
   */
  static select(select) {
    return this._newQuery().select(select)
  }

  /**
   * Runs to array.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
   */
  static async toArray() {
    await this.ensureInitialized()

    return await this._newQuery().toArray()
  }

  /**
   * Runs load.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
   */
  static async load() {
    await this.ensureInitialized()

    return await this._newQuery().load()
  }

  /**
   * Runs where.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {import("../query/index.js").WhereArgumentType} where - Where.
   * @returns {ModelClassQuery<MC>} - The where.
   */
  static where(where) {
    return this._newQuery().where(where)
  }

  /**
   * Runs ransack.
   * @template {typeof VelociousDatabaseRecord} MC
   * @this {MC}
   * @param {Record<string, ?>} params - Ransack-style params hash.
   * @returns {ModelClassQuery<MC>} - Query with Ransack filters applied.
   */
  static ransack(params) {
    return this._newQuery().ransack(params)
  }

  /**
   * Runs constructor.
   * @param {Record<string, ?>} changes - Changes.
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
   * Runs load existing record.
   * @param {object} attributes - Attributes.
   * @returns {void} - No return value.
   */
  loadExistingRecord(attributes) {
    this._attributes = attributes
    this._isNewRecord = false
  }

  /**
   * Assigns the given attributes to the record.
   * @param {Record<string, ?>} attributesToAssign - Attributes to assign.
   * @returns {void} - No return value.
   */
  assign(attributesToAssign) {
    for (const attributeToAssign in attributesToAssign) {
      this.setAttribute(attributeToAssign, attributesToAssign[attributeToAssign])
    }
  }

  /**
   * Returns a the current attributes of the record (original attributes from database plus changes)
   * @returns {Record<string, ?>} - The attributes.
   */
  attributes() {
    const data = this.rawAttributes()
    const columnNameToAttributeName = this.getModelClass().getColumnNameToAttributeNameMap()
    /**
     * Attributes.
      @type {Record<string, ?>} */
    const attributes = {}

    for (const columnName in data) {
      const attributeName = columnNameToAttributeName[columnName] || columnName

      attributes[attributeName] = this.readAttribute(attributeName)
    }

    return attributes
  }

  /**
   * Returns column-name keyed data (original attributes from database plus changes)
   * @returns {Record<string, ?>} - The raw attributes.
   */
  rawAttributes() {
    return Object.assign({}, this._attributes, this._changes)
  }

  /**
   * Runs connection.
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
    await this._runLifecycleCallbacks("beforeDestroy")

    for (const relationship of this.getModelClass().getRelationships()) {
      if (relationship.getDependent() == "restrict") {
        const instanceRelationship = /**
                                      * Narrows the runtime value to the documented type.
                                       @type {?} */ (this.getRelationshipByName(relationship.getRelationshipName()))
        const count = await instanceRelationship.query().count()

        if (count > 0) {
          throw new Error(`Cannot delete record because dependent ${relationship.getRelationshipName()} exist`)
        }

        continue
      }

      if (relationship.getDependent() != "destroy") {
        continue
      }

      const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName())

      /**
       * Defines models.
        @type {VelociousDatabaseRecord[]} */
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

    /**
     * Conditions.
      @type {Record<string, ?>} */
    const conditions = {}

    conditions[this.getModelClass().primaryKey()] = this.id()

    const sql = this._connection().deleteSql({
      conditions,
      tableName: this._tableName()
    })

    await this._connection().query(sql, {logName: `${this.getModelClass().name} Destroy`})
    await this._runLifecycleCallbacks("afterDestroy")
  }

  /**
   * Runs run lifecycle callbacks.
   * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
   * @returns {Promise<void>}
   */
  async _runLifecycleCallbacks(callbackName) {
    const callbacks = this.getModelClass().getLifecycleCallbacksMap()[callbackName] || []
    let callbackNameRegisteredAsString = false

    for (const callback of callbacks) {
      if (typeof callback == "string") {
        if (callback == callbackName) {
          callbackNameRegisteredAsString = true
        }
        const dynamicThis = /**
                             * Narrows the runtime value to the documented type.
                              @type {Record<string, ?>} */ (/**
                                                             * Narrows the runtime value to the documented type.
                                                              @type {?} */ (this))
        const methodCallback = dynamicThis[callback]

        if (typeof methodCallback != "function") {
          throw new Error(`Lifecycle callback "${callback}" is not a function on ${this.getModelClass().name}`)
        }

        await methodCallback.call(this)
      } else {
        await callback(this)
      }
    }

    const dynamicThis = /**
                         * Narrows the runtime value to the documented type.
                          @type {Record<string, ?>} */ (/**
                                                         * Narrows the runtime value to the documented type.
                                                          @type {?} */ (this))
    const instanceCallback = dynamicThis[callbackName]

    if (!callbackNameRegisteredAsString && typeof instanceCallback === "function") {
      await instanceCallback.call(this)
    }
  }

  /**
   * Runs has changes.
   * @returns {boolean} - Whether changes.
   */
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
   * @returns {Record<string, Array<?>>} - The changes.
   */
  changes() {
    /**
     * Changes.
      @type {Record<string, Array<?>>} */
    const changes = {}

    for (const changeKey in this._changes) {
      const changeValue = this._changes[changeKey]

      changes[changeKey] = [this._attributes[changeKey], changeValue]
    }

    return changes
  }

  /**
   * Runs table name.
   * @returns {string} - The table name.
   */
  _tableName() {
    if (this.__tableName) return this.__tableName

    return this.getModelClass().tableName()
  }

  /**
   * Reads an attribute value from the record. Read dynamically by name, so the value can be any
   * column type and may be overridden by a user-defined getter on the model.
   * @template V
   * @param {string} attributeName The name of the attribute to read. This is the attribute name, not the column name.
   * @returns {V} The attribute value, typed by the caller's accessor contract.
   */
  readAttribute(attributeName) {
    this.getModelClass()._assertHasBeenInitialized()
    const columnName = this.getModelClass().getAttributeNameToColumnNameMap()[attributeName]

    if (!columnName) throw new Error(`Couldn't figure out column name for attribute: ${attributeName} from these mappings: ${Object.keys(this.getModelClass().getAttributeNameToColumnNameMap()).join(", ")}`)

    return /** @type {V} */ (this.readColumn(columnName))
  }

  /**
   * Read an association count attached by `.withCount(...)`. Counts are
   * stored on a separate map from the record's `_attributes` so a
   * virtual count like `tasksCount` cannot silently shadow a real
   * column of the same name. Returns the attached number, or 0 when
   * `.withCount(...)` wasn't requested for this attribute.
   * @param {string} attributeName - Attribute name, e.g. `"tasksCount"` or a custom `"activeMembersCount"` from `.withCount({activeMembersCount: {...}})`.
   * @returns {number}
   */
  readCount(attributeName) {
    return readPayloadAssociationCount(/**
                                        * Narrows the runtime value to the documented type.
                                         @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                                         * Narrows the runtime value to the documented type.
                                                                                                                          @type {?} */ (this)), attributeName)
  }

  /**
   * Attach an association count to this record. Internal helper used by
   * the `withCount` runner; outside code should not call this directly.
   * @param {string} attributeName - Attribute name.
   * @param {number} value - Count value.
   * @returns {void}
   */
  _setAssociationCount(attributeName, value) {
    setPayloadAssociationCount(/**
                                * Narrows the runtime value to the documented type.
                                 @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                                 * Narrows the runtime value to the documented type.
                                                                                                                  @type {?} */ (this)), attributeName, value)
  }

  /**
   * All attached association counts as a plain object. Used by the
   * frontend-model serializer to ship counts alongside the record
   * attributes on the wire.
   * @returns {Record<string, number>}
   */
  associationCounts() {
    /**
     * Result.
      @type {Record<string, number>} */
    const result = {}

    const target = /**
                    * Narrows the runtime value to the documented type.
                     @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                     * Narrows the runtime value to the documented type.
                                                                                                      @type {?} */ (this))

    if (!target._associationCounts) return result

    for (const [attributeName, value] of target._associationCounts) {
      result[attributeName] = value
    }

    return result
  }

  /**
   * Read a value attached by `.queryData(...)`. Stored on a dedicated
   * map rather than on `_attributes`, so a virtual queryData key like
   * `transportSecondsSum` cannot silently shadow a real column of the
   * same name. Returns `null` when the key wasn't produced by any
   * registered fn for this record (e.g. no child rows matched the
   * aggregate).
   * @param {string} name - queryData attribute name (matches a SELECT alias from the registered fn).
   * @returns {?}
   */
  queryData(name) {
    return readPayloadQueryData(/**
                                 * Narrows the runtime value to the documented type.
                                  @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                                  * Narrows the runtime value to the documented type.
                                                                                                                   @type {?} */ (this)), name)
  }

  /**
   * Attach a queryData value to this record. Internal helper used by
   * the `queryData` runner and by frontend-model hydration; outside
   * code should not call this directly.
   * @param {string} name - queryData attribute name.
   * @param {?} value - Value to attach.
   * @returns {void}
   */
  _setQueryData(name, value) {
    setPayloadQueryData(/**
                         * Narrows the runtime value to the documented type.
                          @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                          * Narrows the runtime value to the documented type.
                                                                                                           @type {?} */ (this)), name, value)
  }

  /**
   * All attached queryData values as a plain object. Used by the
   * frontend-model serializer to ship queryData alongside the record
   * attributes on the wire.
   * @returns {Record<string, ?>}
   */
  queryDataValues() {
    /**
     * Result.
      @type {Record<string, ?>} */
    const result = {}

    const target = /**
                    * Narrows the runtime value to the documented type.
                     @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                     * Narrows the runtime value to the documented type.
                                                                                                      @type {?} */ (this))

    if (!target._queryDataValues) return result

    for (const [name, value] of target._queryDataValues) {
      result[name] = value
    }

    return result
  }

  /**
   * Read a per-record ability result attached by `.abilities(...)`. The
   * backend evaluates each requested action against the current ability
   * for this record instance and ships the result alongside the
   * record's attributes. Returns `false` when the action wasn't
   * requested for this record — so UI code can safely branch on
   * `record.can("update")` without first checking whether the ability
   * was loaded.
   * @param {string} action - Ability action name, e.g. `"update"`.
   * @returns {boolean}
   */
  can(action) {
    return readPayloadComputedAbility(/**
                                       * Narrows the runtime value to the documented type.
                                        @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                                        * Narrows the runtime value to the documented type.
                                                                                                                         @type {?} */ (this)), action)
  }

  /**
   * Attach a per-record ability result to this record. Internal helper
   * used by the `abilities` runner and by frontend-model hydration;
   * outside code should not call this directly.
   * @param {string} action - Ability action name.
   * @param {boolean} value - Whether the current ability permits the action on this record.
   * @returns {void}
   */
  _setComputedAbility(action, value) {
    setPayloadComputedAbility(/**
                               * Narrows the runtime value to the documented type.
                                @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                                * Narrows the runtime value to the documented type.
                                                                                                                 @type {?} */ (this)), action, value)
  }

  /**
   * All attached per-record ability results as a plain object. Used
   * by the frontend-model serializer to ship results alongside the
   * record attributes on the wire.
   * @returns {Record<string, boolean>}
   */
  computedAbilities() {
    /**
     * Result.
      @type {Record<string, boolean>} */
    const result = {}

    const target = /**
                    * Narrows the runtime value to the documented type.
                     @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ (/**
                                                                                                     * Narrows the runtime value to the documented type.
                                                                                                      @type {?} */ (this))

    if (!target._computedAbilities) return result

    for (const [action, value] of target._computedAbilities) {
      result[action] = value
    }

    return result
  }

  /**
   * Reads a column value from the record.
   * @param {string} attributeName The name of the column to read. This is the column name, not the attribute name.
   * @returns {?} - The column.
   */
  readColumn(attributeName) {
    this.getModelClass()._assertHasBeenInitialized()
    const belongsToChanges = this._belongsToChanges()
    let result

    if (attributeName in belongsToChanges) {
      result = belongsToChanges[attributeName]
    } else if (attributeName in this._changes) {
      result = this._changes[attributeName]
    } else if (attributeName in this._attributes) {
      result = this._attributes[attributeName]
    } else if (this.isPersisted()) {
      throw new Error(`No such attribute or not selected ${this.constructor.name}#${attributeName}`)
    }

    const columnType = this.getModelClass().getColumnTypeByName(attributeName)

    if (columnType && this.getModelClass()._isDateLikeType(columnType)) {
      result = this._normalizeDateValueForRead(result)
    }

    result = this._normalizeBooleanValueForRead({columnName: attributeName, columnType, value: result})

    return result
  }

  /**
   * Resolves any declared per-attribute cast for a database column name.
   * @param {string} columnName - Database column name.
   * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
   */
  _declaredAttributeCastForColumn(columnName) {
    const attributeName = this.getModelClass().getColumnNameToAttributeNameMap()[columnName]

    if (!attributeName) return undefined

    return this.getModelClass().getAttributeCast(attributeName)
  }

  /**
   * Converts a stored value to a real boolean for a declared `"boolean"` cast.
   * Leaves null/undefined untouched; treats 1/true/"1" as true and 0/false/"0" as false.
   * @param {?} value - Stored database value.
   * @returns {?} - Converted boolean, or the original value when not recognized.
   */
  _castDeclaredBooleanForRead(value) {
    if (value === null || value === undefined) return value
    if (declaredBooleanTruthyValues.has(value)) return true
    if (declaredBooleanFalsyValues.has(value)) return false

    return value
  }

  /**
   * Whether a column value is currently loaded on this record (either as a
   * persisted attribute or a pending change). Used to decide whether a preload
   * can be skipped because the required columns are already present.
   * @param {string} columnName - The column name to check.
   * @returns {boolean} - Whether the column is loaded.
   */
  hasLoadedColumn(columnName) {
    return columnName in this._changes || columnName in this._attributes
  }

  /**
   * Runs normalize boolean value for read. A declared `"boolean"` attribute cast converts the
   * stored value (e.g. an MSSQL `bit` 0/1) to a real boolean; otherwise the existing
   * introspected-type normalization applies (no behaviour change for non-declared columns).
   * @param {object} args - Options object.
   * @param {string} args.columnName - Database column name being read.
   * @param {string | undefined} args.columnType - Column type.
   * @param {?} args.value - Value to normalize.
   * @returns {?} - Normalized value.
   */
  _normalizeBooleanValueForRead({columnName, columnType, value}) {
    if (this._declaredAttributeCastForColumn(columnName) === "boolean") {
      return this._castDeclaredBooleanForRead(value)
    }

    if (!columnType) return value
    if (columnType.toLowerCase() !== "boolean") return value
    if (value === 1) return true
    if (value === 0) return false

    return value
  }

  /**
   * Runs normalize date value for read.
   * @param {?} value - Value from database.
   * @returns {?} - Normalized value.
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
    /**
     * Belongs to changes.
      @type {Record<string, ?>} */
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

  /**
   * Runs create new record.
   * @returns {Promise<void>} - Resolves when complete.
   */
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
    const insertResult = await this._connection().query(sql, {logName: `${this.getModelClass().name} Create`})

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
   * Runs normalize date values for write.
   * @param {Record<string, ?>} data - Column-keyed data.
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

  /**
   * Runs update record with changes.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _updateRecordWithChanges() {
    /**
     * Conditions.
      @type {Record<string, ?>} */
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
      await this._connection().query(sql, {logName: `${this.getModelClass().name} Update`})
      await this._reloadWithId(this.id())
    }
  }

  /**
   * Runs id.
   * @returns {number|string} - The id.
   */
  id() {
    if (!this.getModelClass()._columnNameToAttributeName) {
      throw new Error(`Column names mapping hasn't been set on ${this.constructor.name}. Has the model been initialized?`)
    }

    const primaryKey = this.getModelClass().primaryKey()
    const attributeName = this.getModelClass().getColumnNameToAttributeNameMap()[primaryKey]

    if (attributeName === undefined) {
      throw new Error(`Primary key ${primaryKey} doesn't exist in columns: ${Object.keys(this.getModelClass().getColumnNameToAttributeNameMap()).join(", ")}`)
    }

    return /** Narrows the runtime value to the documented type. @type {number | string} */ (this.readAttribute(attributeName))
  }

  /**
   * Runs is persisted.
   * @returns {boolean} - Whether persisted.
   */
  isPersisted() { return !this._isNewRecord }

  /**
   * Runs is new record.
   * @returns {boolean} - Whether new record.
   */
  isNewRecord() { return this._isNewRecord }

  /**
   * Runs set is new record.
   * @param {boolean} newIsNewRecord - New is new record.
   * @returns {void} - No return value.
   */
  setIsNewRecord(newIsNewRecord) {
    this._isNewRecord = newIsNewRecord
  }

  /**
   * Runs reload with id.
   * @template {typeof VelociousDatabaseRecord} MC
   * @param {string | number} id - Record identifier.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _reloadWithId(id) {
    const primaryKey = this.getModelClass().primaryKey()

    /**
     * Where object.
      @type {Record<string, ?>} */
    const whereObject = {}

    whereObject[primaryKey] = id

    const query = /**
                   * Narrows the runtime value to the documented type.
                    @type {import("../query/model-class-query.js").default<MC>} */ (this.getModelClass().where(whereObject))
    const reloadedModel = await query.first()

    if (!reloadedModel) throw new Error(`${this.constructor.name}#${id} couldn't be reloaded - record didn't exist`)

    this._attributes = reloadedModel.rawAttributes()
    this._changes = {}
  }

  /**
   * Runs reload.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async reload() {
    const recordId = /**
                      * Narrows the runtime value to the documented type.
                       @type {string | number} */ (this.readAttribute("id"))
    await this._reloadWithId(recordId)
  }

  async _runValidations() {
    /**
     * Narrows the runtime value to the documented type.
      @type {Record<string, {type: string, message: string}>} */
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
      validationError.velocious = {type: "validation_error"}

      throw validationError
    }
  }

  /**
   * Runs full error messages.
   * @returns {string[]} - The full error messages.
   */
  fullErrorMessages() {
    /**
     * Validation error messages.
      @type {string[]} */
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
   * Runs locale.
   * @abstract
   * @returns {string} - The locale.
   */
  locale() {
    throw new Error("'locale' not implemented")
  }
}

VelociousDatabaseRecord.registerValidatorType("format", ValidatorsFormat)
VelociousDatabaseRecord.registerValidatorType("presence", ValidatorsPresence)
VelociousDatabaseRecord.registerValidatorType("uniqueness", ValidatorsUniqueness)

export {AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError, TenantDatabaseScopeError, ValidationError}
export default VelociousDatabaseRecord
