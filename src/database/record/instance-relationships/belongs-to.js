// @ts-check

import BaseInstanceRelationship from "./base.js"

/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 */
export default class VelociousDatabaseRecordBelongsToInstanceRelationship extends BaseInstanceRelationship {
  /**
   * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args
   */
  constructor(args) {
    super(args)
  }

  /**
   * @param {Record<string, any>} data
   * @returns {InstanceType<TMC>}
   */
  build(data) {
    const TargetModelClass = /** @type {TMC} */ (this.getTargetModelClass())

    if (!TargetModelClass) throw new Error("Can't build a new record without a target model")

    const newInstance = /** @type {InstanceType<TMC>} */ (new TargetModelClass(data))

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
