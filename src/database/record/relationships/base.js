// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"
import * as inflection from "inflection"

/**
 * RelationshipScopeCallback type.
 * @typedef {(query: import("../../query/model-class-query.js").default<?>) => (import("../../query/model-class-query.js").default<?> | void)} RelationshipScopeCallback
 */
/**
 * RelationshipBaseArgsType type.
 * @typedef {object} RelationshipBaseArgsType
 * @property {boolean} [autoload] - Whether to auto-batch-preload siblings when this relationship is lazy-loaded. Default true.
 * @property {string} [className] - Name of the related model class.
 * @property {boolean} [counterCache] - Auto-sync parent count column on create/update/destroy.
 * @property {string} [dependent] - Dependent action when parent is destroyed.
 * @property {string | undefined} [foreignKey] - Explicit foreign key column name.
 * @property {string} [inverseOf] - Inverse relationship name on the related model.
 * @property {typeof import("../index.js").default} [klass] - Related model class.
 * @property {typeof import("../index.js").default} modelClass - Owning model class.
 * @property {string} [primaryKey] - Primary key column on the owning model.
 * @property {boolean} [polymorphic] - Whether the relationship is polymorphic.
 * @property {string} relationshipName - Name of the relationship on the model.
 * @property {RelationshipScopeCallback} [scope] - Optional scope callback for the relationship.
 * @property {string} [through] - Name of the through association.
 * @property {string} type - Relationship type (e.g. "hasMany").
 */

export default class VelociousDatabaseRecordBaseRelationship {
  /**
   * Runs constructor.
   * @param {RelationshipBaseArgsType} args - Relationship definition arguments.
   */
  constructor({autoload, className, counterCache, dependent, foreignKey, inverseOf, klass, modelClass, primaryKey = "id", polymorphic, relationshipName, scope, through, type, ...restArgs}) {
    restArgsError(restArgs)

    if (!modelClass) throw new Error(`'modelClass' wasn't given for ${relationshipName}`)
    if (!className && !klass && !polymorphic) throw new Error(`Neither 'className' or 'klass' was given for ${modelClass.name}#${relationshipName}`)

    if (className == "EventSery") {
      throw new Error(`Invalid model name: ${className}`)
    }

    this._autoload = autoload !== false
    this.className = className
    this._counterCache = counterCache || false
    this._dependent = dependent
    this.foreignKey = foreignKey
    this._inverseOf = inverseOf
    this.klass = klass
    this.modelClass = modelClass
    this._polymorphic = polymorphic
    this._primaryKey = primaryKey
    this.relationshipName = relationshipName
    this._scope = scope
    this.through = through
    this.type = type
  }

  /**
   * Runs get autoload.
   * @returns {boolean} Whether this relationship auto-batch-preloads siblings on lazy access.
   */
  getAutoload() { return this._autoload }

  getConfiguration() { return this.modelClass._getConfiguration() }

  /**
   * Runs get counter cache.
   * @returns {boolean} Whether a counter cache column is synced on the parent.
   */
  getCounterCache() { return this._counterCache }

  /**
   * Runs get dependent.
   * @returns {string | undefined} What will be done when the parent record is destroyed. E.g. "destroy", "nullify", "restrict" etc.
   */
  getDependent() { return this._dependent }

  /**
   * Runs get foreign key.
   * @abstract
   * @returns {string} The name of the foreign key, e.g. "user_id", "post_id" etc.
   */
  getForeignKey() {
    throw new Error("getForeignKey not implemented")
  }

  /**
   * Runs get inverse of.
   * @abstract
   * @returns {string | undefined} The name of the inverse relationship, e.g. "posts", "comments" etc.
   */
  getInverseOf() {
    throw new Error("getInverseOf not implemented")
  }

  /**
   * Runs get model class.
   * @returns {typeof import("../index.js").default} - The model class.
   */
  getModelClass() { return this.modelClass }

  /**
   * Runs get relationship name.
   * @returns {string} The name of the relationship, e.g. "posts", "user", "comments" etc.
   */
  getRelationshipName() { return this.relationshipName }

  /**
   * Runs get scope.
   * @returns {RelationshipScopeCallback | undefined} - The scope callback.
   */
  getScope() { return this._scope }

  /**
   * Runs apply scope.
   * @template T
   * @param {T} query - Query instance.
   * @returns {T} - Scoped query.
   */
  applyScope(query) {
    const scope = this.getScope()

    if (!scope) return query

    const scopedQuery = /**
                         * Narrows the runtime value to the documented type.
                          @type {T | void} */ (scope.call(query, /**
                                                                  * Narrows the runtime value to the documented type.
                                                                   @type {import("../../query/model-class-query.js").default<?>} */ (query)))

    return scopedQuery || query
  }

  /**
   * Runs get polymorphic.
   * @returns {boolean} - Whether polymorphic.
   */
  getPolymorphic() {
    return this._polymorphic || false
  }

  /**
   * Runs get polymorphic type column.
   * @returns {string} - The polymorphic type column.
   */
  getPolymorphicTypeColumn() {
    if (!this.getPolymorphic()) {
      throw new Error(`${this.modelClass.name}#${this.relationshipName} isn't polymorphic`)
    }

    if (!this._polymorphicTypeColumn) {
      const foreignKey = this.getForeignKey()

      if (foreignKey && foreignKey.endsWith("_id")) {
        this._polymorphicTypeColumn = foreignKey.replace(/_id$/, "_type")
      } else {
        const underscoredName = inflection.underscore(this.getRelationshipName())

        this._polymorphicTypeColumn = `${underscoredName}_type`
      }
    }

    return this._polymorphicTypeColumn
  }

  /**
   * Runs get primary key.
   * @returns {string} The name of the foreign key, e.g. "id" etc.
   */
  getPrimaryKey() { return this._primaryKey }

  /**
   * Runs get type.
   * @returns {string} The type of the relationship, e.g. "has_many", "belongs_to", "has_one", "has_and_belongs_to_many" etc.
   */
  getType() { return this.type }

  /**
   * Runs get target model class.
   * @returns {typeof import("../index.js").default | undefined} The target model class for this relationship, e.g. if the relationship is "posts" then the target model class is the Post class.
   */
  getTargetModelClass() {
    if (this.getPolymorphic() && this.type == "belongsTo") {
      return undefined
    } else if (this.className) {
      return this.getConfiguration().getModelClass(this.className)
    } else if (this.klass) {
      return this.klass
    }

    throw new Error("Couldn't figure out the target model class")
  }
}
