import BaseInstanceRelationship from "./base.js"

export default class VelociousDatabaseRecordHasOneInstanceRelationship extends BaseInstanceRelationship {
  constructor(args) {
    super(args)
    this._loaded = null
  }

  build(data) {
    const targetModelClass = this.getTargetModelClass()
    const newInstance = new targetModelClass(data)

    this._loaded = newInstance

    return newInstance
  }

  async load() {
    const foreignKey = this.getForeignKey()
    const primaryKey = this.getPrimaryKey()
    const primaryModelID = this.getModel().readColumn(primaryKey)
    const TargetModelClass = this.getTargetModelClass()
    const whereArgs = {}

    whereArgs[foreignKey] = primaryModelID

    const foreignModel = await TargetModelClass.where(whereArgs).first()

    this.setLoaded(foreignModel)
    this.setDirty(false)
    this.setPreloaded(true)
  }

  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  getLoadedOrNull() {
    return this._loaded
  }

  setLoaded(model) {
    if (Array.isArray(model)) throw new Error(`Argument given to setLoaded was an array: ${typeof model}`)

    this._loaded = model
  }

  getTargetModelClass = () => this.relationship.getTargetModelClass()
}
