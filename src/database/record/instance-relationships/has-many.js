import BaseInstanceRelationship from "./base.js"

export default class VelociousDatabaseRecordHasManyInstanceRelationship extends BaseInstanceRelationship {
  constructor(args) {
    super(args)
    this._loaded = null
  }

  build(data) {
    // Spawn new model of the targeted class
    const targetModelClass = this.getTargetModelClass()
    const newInstance = new targetModelClass(data)


    // Add it to the loaded models of this relationship
    if (this._loaded === null) this._loaded = []

    this._loaded.push(newInstance)


    // Set loaded on the models inversed relationship
    const inverseOf = this.getRelationship().getInverseOf()

    if (inverseOf) {
      const inverseInstanceRelationship = newInstance.getRelationshipByName(inverseOf)

      inverseInstanceRelationship.setAutoSave(false)
      inverseInstanceRelationship.setLoaded(this.getModel())
    }


    // Return the new contructed model
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

    if (this._loaded === null && this.model.isNewRecord()) {
      return []
    }

    return this._loaded
  }

  getLoadedOrNull() { return this._loaded }

  addToLoaded(models) {
    if (Array.isArray(models)) {
      for (const model of models) {
        if (this._loaded === null) this._loaded = []

        this._loaded.push(model)
      }
    } else {
      if (this._loaded === null) this._loaded = []

      this._loaded.push(models)
    }
  }

  setLoaded(models) {
    if (!Array.isArray(models)) throw new Error(`Argument given to setLoaded wasn't an array: ${typeof models}`)

    this._loaded = models
  }

  setPreloaded(preloaded) {
    if (preloaded && !Array.isArray(this._loaded)) {
      throw new Error("Trying to set preloaded without a loaded value")
    }

    this._preloaded = preloaded
  }

  getTargetModelClass() { return this.relationship.getTargetModelClass() }
}
