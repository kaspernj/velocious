import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseRecordBaseRelationship {
  /**
   * @param {object} args
   * @param {string} args.className
   * @param {import("../../../configuration.js").default} args.configuration
   * @param {string} args.dependent
   * @param {boolean|object} args.foreignKey
   * @param {string} args.inverseOf
   * @param {typeof import("../index.js").default} args.klass
   * @param {typeof import("../index.js").default} args.modelClass
   * @param {string} args.primaryKey
   * @param {boolean} args.polymorphic
   * @param {string} args.relationshipName
   * @param {string} args.through
   * @param {string} args.type
   */
  constructor({className, configuration, dependent, foreignKey, inverseOf, klass, modelClass, primaryKey = "id", polymorphic, relationshipName, through, type, ...restArgs}) { // eslint-disable-line no-unused-vars
    restArgsError(restArgs)

    if (!modelClass) throw new Error(`'modelClass' wasn't given for ${relationshipName}`)
    if (!className && !klass) throw new Error(`Neither 'className' or 'klass' was given for ${modelClass.name}#${relationshipName}`)

    this.className = className
    this.configuration = configuration
    this._dependent = dependent
    this.foreignKey = foreignKey
    this._inverseOf
    this.klass = klass
    this.modelClass = modelClass
    this._polymorphic = polymorphic
    this._primaryKey = primaryKey
    this.relationshipName = relationshipName
    this.through = through
    this.type = type
  }

  /**
   * @returns {string} What will be done when the parent record is destroyed. E.g. "destroy", "nullify", "restrict" etc.
   */
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
   * @returns {string} The name of the inverse relationship, e.g. "posts", "comments" etc.
   */
  getInverseOf() {
    throw new Error("getInverseOf not implemented")
  }

  /**
   * @returns {typeof import("../index.js").default}
   */
  getModelClass() { return this.modelClass }

  /**
   * @returns {string} The name of the relationship, e.g. "posts", "user", "comments" etc.
   */
  getRelationshipName() { return this.relationshipName }

  /**
   * @returns {boolean}
   */
  getPolymorphic() {
    return this._polymorphic
  }

  /**
   * @returns {string} The name of the foreign key, e.g. "id" etc.
   */
  getPrimaryKey() { return this._primaryKey }

  /**
   * @returns {string} The type of the relationship, e.g. "has_many", "belongs_to", "has_one", "has_and_belongs_to_many" etc.
   */
  getType() { return this.type }

  /**
   * @returns {typeof import("../index.js").default} The target model class for this relationship, e.g. if the relationship is "posts" then the target model class is the Post class.
   */
  getTargetModelClass() {
    if (this.getPolymorphic()) {
      return null
    } else if (this.className) {
      return this.modelClass._getConfiguration().getModelClass(this.className)
    } else if (this.klass) {
      return this.klass
    }

    throw new Error("Couldn't figure out the target model class")
  }
}
