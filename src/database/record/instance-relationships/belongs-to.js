// @ts-check

import BaseInstanceRelationship from "./base.js"

export default class VelociousDatabaseRecordBelongsToInstanceRelationship extends BaseInstanceRelationship {
  /**
   * @param {Record<string, any>} data
   * @returns {import("../index.js").default}
   */
  build(data) {
    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Can't build a new record without a target model")

    const newInstance = new TargetModelClass(data)

    this._loaded = newInstance

    return newInstance
  }

  getLoadedOrUndefined() { return this._loaded }

  async load() {
    const foreignKey = this.getForeignKey()
    const foreignModelID = this.getModel().readColumn(foreignKey)
    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Can't load without a target model")

    const foreignModel = await TargetModelClass.find(foreignModelID)

    this.setLoaded(foreignModel)
    this.setDirty(false)
    this.setPreloaded(true)
  }
}
