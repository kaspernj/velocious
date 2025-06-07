import BaseInstanceRelationship from "./base.js"

export default class VelociousDatabaseRecordHasManyInstanceRelationship extends BaseInstanceRelationship {
  constructor(args) {
    super(args)
    this._loaded = []
  }

  build(data) {
    const targetModelClass = this.getTargetModelClass()
    const newInstance = new targetModelClass(data)

    this._loaded.push(newInstance)

    return newInstance
  }

  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

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

  setPreloaded(preloadedValue) {
    this._preloaded = preloadedValue
  }

  getTargetModelClass = () => this.relationship.getTargetModelClass()
}
