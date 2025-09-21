export default class VelociousDatabaseRecordBaseRelationship {
  constructor({className, configuration, dependent, foreignKey, klass, modelClass, primaryKey = "id", relationshipName, through, type, ...restArgs}) {
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) throw new Error(`Unknown args given: ${restArgsKeys.join(", ")}`)
    if (!modelClass) throw new Error(`'modelClass' wasn't given for ${relationshipName}`)
    if (!className && !klass) throw new Error(`Neither 'className' or 'klass' was given for ${modelClass.name}#${relationshipName}`)

    this.className = className
    this.configuration = configuration
    this._dependent = dependent
    this.foreignKey = foreignKey
    this.klass = klass
    this.modelClass = modelClass
    this._primaryKey = primaryKey
    this.relationshipName = relationshipName
    this.through = through
    this.type = type
  }

  getDependent = () => this._dependent
  getRelationshipName = () => this.relationshipName
  getPrimaryKey = () => this._primarYKey
  getType = () => this.type

  getTargetModelClass() {
    if (this.className) {
      return this.modelClass._getConfiguration().getModelClass(this.className)
    } else if (this.klass) {
      return this.klass
    }

    throw new Error("Couldn't figure out the target model class")
  }
}
