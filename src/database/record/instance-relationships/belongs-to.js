import BaseInstanceRelationship from "./base.js"

export default class VelociousDatabaseRecordBelongsToInstanceRelationship extends BaseInstanceRelationship {
  build(data) {
    const targetModelClass = this.getTargetModelClass()
    const newInstance = new targetModelClass(data)

    this._loaded = newInstance

    return newInstance
  }

  getLoadedOrNull() { return this._loaded }

  async load() {
    const foreignKey = this.getForeignKey()
    const foreignModelID = this.getModel().readColumn(foreignKey)
    const TargetModelClass = this.getTargetModelClass()
    const foreignModel = await TargetModelClass.find(foreignModelID)

    this.setLoaded(foreignModel)
    this.setDirty(false)
    this.setPreloaded(true)
  }
}
