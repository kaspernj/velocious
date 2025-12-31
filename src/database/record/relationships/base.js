// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"
import * as inflection from "inflection"

/**
 * @typedef {(query: import("../../query/model-class-query.js").default) => (import("../../query/model-class-query.js").default | void)} RelationshipScopeCallback
 */
/**
 * @typedef {object} RelationshipBaseArgsType
 * @property {string} [className] - Name of the related model class.
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
  /** @param {RelationshipBaseArgsType} args - Relationship definition arguments. */
  constructor({className, dependent, foreignKey, inverseOf, klass, modelClass, primaryKey = "id", polymorphic, relationshipName, scope, through, type, ...restArgs}) {
    restArgsError(restArgs)

    if (!modelClass) throw new Error(`'modelClass' wasn't given for ${relationshipName}`)
    if (!className && !klass && !polymorphic) throw new Error(`Neither 'className' or 'klass' was given for ${modelClass.name}#${relationshipName}`)

    if (className == "EventSery") {
      throw new Error(`Invalid model name: ${className}`)
    }

    this.className = className
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

  getConfiguration() { return this.modelClass._getConfiguration() }

  /** @returns {string | undefined} What will be done when the parent record is destroyed. E.g. "destroy", "nullify", "restrict" etc. */
  getDependent() { return this._dependent }

  /**
   * @abstract
   * @returns {string} The name of the foreign key, e.g. "user_id", "post_id" etc.
   */
  getForeignKey() {
    throw new Error("getForeignKey not implemented")
  }

  /**
   * @abstract
   * @returns {string | undefined} The name of the inverse relationship, e.g. "posts", "comments" etc.
   */
  getInverseOf() {
    throw new Error("getInverseOf not implemented")
  }

  /** @returns {typeof import("../index.js").default} - The model class.  */
  getModelClass() { return this.modelClass }

  /** @returns {string} The name of the relationship, e.g. "posts", "user", "comments" etc. */
  getRelationshipName() { return this.relationshipName }

  /** @returns {RelationshipScopeCallback | undefined} - The scope callback. */
  getScope() { return this._scope }

  /**
   * @template T
   * @param {T} query - Query instance.
   * @returns {T} - Scoped query.
   */
  applyScope(query) {
    const scope = this.getScope()

    if (!scope) return query

    const scopedQuery = scope.call(query, query)

    return scopedQuery || query
  }

  /** @returns {boolean} - Whether polymorphic.  */
  getPolymorphic() {
    return this._polymorphic || false
  }

  /** @returns {string} - The polymorphic type column.  */
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

  /** @returns {string} The name of the foreign key, e.g. "id" etc. */
  getPrimaryKey() { return this._primaryKey }

  /** @returns {string} The type of the relationship, e.g. "has_many", "belongs_to", "has_one", "has_and_belongs_to_many" etc. */
  getType() { return this.type }

  /** @returns {typeof import("../index.js").default | undefined} The target model class for this relationship, e.g. if the relationship is "posts" then the target model class is the Post class. */
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
