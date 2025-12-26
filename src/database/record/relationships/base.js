// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"
import * as inflection from "inflection"

/**
 * @typedef {object} RelationshipBaseArgsType
 * @property {string} [className] - Description.
 * @property {string} [dependent] - Description.
 * @property {string | undefined} [foreignKey] - Description.
 * @property {string} [inverseOf] - Description.
 * @property {typeof import("../index.js").default} [klass] - Description.
 * @property {typeof import("../index.js").default} modelClass - Description.
 * @property {string} [primaryKey] - Description.
 * @property {boolean} [polymorphic] - Description.
 * @property {string} relationshipName - Description.
 * @property {string} [through] - Description.
 * @property {string} type - Description.
 */

export default class VelociousDatabaseRecordBaseRelationship {
  /** @param {RelationshipBaseArgsType} args */
  constructor({className, dependent, foreignKey, inverseOf, klass, modelClass, primaryKey = "id", polymorphic, relationshipName, through, type, ...restArgs}) {
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

  /** @returns {typeof import("../index.js").default} - Result.  */
  getModelClass() { return this.modelClass }

  /** @returns {string} The name of the relationship, e.g. "posts", "user", "comments" etc. */
  getRelationshipName() { return this.relationshipName }

  /** @returns {boolean} - Result.  */
  getPolymorphic() {
    return this._polymorphic || false
  }

  /** @returns {string} - Result.  */
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
