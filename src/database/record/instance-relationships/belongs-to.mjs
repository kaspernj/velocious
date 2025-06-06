import BaseInstanceRelationship from "./base.mjs"

export default class VelociousDatabaseRecordBelongsToInstanceRelationship extends BaseInstanceRelationship {
  constructor(args) {
    super(args)
  }

  build(data) {
    const targetModelClass = this.getTargetModelClass()
    const newInstance = new targetModelClass(data)

    this._loaded = newInstance

    return newInstance
  }

  setLoaded(models) {
    this._loaded = models
  }
}
