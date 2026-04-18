// @ts-check

import BaseInstanceRelationship from "./base.js"

/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordBelongsToInstanceRelationship extends BaseInstanceRelationship {
  /**
   * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
   */
  constructor(args) {
    super(args)
  }

  /**
   * @param {Record<string, any>} data - Data payload.
   * @returns {InstanceType<TMC>} - The build.
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
    // Force-reload: discard the cached value and fetch fresh. When the parent
    // record was loaded as part of a batch, batch the belongs-to lookup across
    // cohort siblings that have not preloaded this relationship yet.
    this._preloaded = false
    this._loaded = undefined

    const batched = await this._tryCohortPreload()

    if (batched) return this.loaded()

    const foreignKey = this.getForeignKey()
    const foreignModelID = this.getModel().readColumn(foreignKey)
    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Can't load without a target model")

    const primaryKey = TargetModelClass.primaryKey()
    /** @type {Record<string, string | number | null | undefined>} */
    const whereArgs = {}

    whereArgs[primaryKey] = foreignModelID

    let query = TargetModelClass.where(whereArgs)

    query = this.applyScope(query)

    const foreignModel = await query.first()

    if (foreignModel) {
      this.setLoaded(foreignModel)
    } else {
      this.setLoaded(undefined)
    }
    this.setDirty(false)
    this.setPreloaded(true)

    return this.loaded()
  }
}
