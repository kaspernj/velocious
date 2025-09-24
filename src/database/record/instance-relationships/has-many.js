import BaseInstanceRelationship from "./base.js"

export default class VelociousDatabaseRecordHasManyInstanceRelationship extends BaseInstanceRelationship {
  constructor(args) {
    super(args)
    this._loaded = null
  }

  build(data) {
    const targetModelClass = this.getTargetModelClass()
    const newInstance = new targetModelClass(data)

    this._loaded.push(newInstance)

    return newInstance
  }

  async load() {
    const foreignKey = this.getForeignKey()
    const primaryKey = this.getPrimaryKey()
    const primaryModelID = this.getModel().readColumn(primaryKey)
    const TargetModelClass = this.getTargetModelClass()
    const whereArgs = {}

    whereArgs[foreignKey] = primaryModelID

    const foreignModels = await TargetModelClass.where(whereArgs).toArray()

    this.setLoaded(foreignModels)
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

  addToLoaded(models) {
    if (Array.isArray(models)) {
      for (const model of models) {
        this._loaded.push(model)
      }
    } else {
      this._loaded.push(models)
    }
  }

  setLoaded(models) {
    if (!Array.isArray(models)) throw new Error(`Argument given to setLoaded wasn't an array: ${typeof models}`)

    this._loaded = models
  }

  getTargetModelClass = () => this.relationship.getTargetModelClass()
}
