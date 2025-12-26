// @ts-check

import BaseInstanceRelationship from "./base.js"

/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 */
export default class VelociousDatabaseRecordHasOneInstanceRelationship extends BaseInstanceRelationship {
  /**
   * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
   */
  constructor(args) {
    super(args)
  }

  /** @type {InstanceType<TMC> | undefined} */
  _loaded = undefined

  /**
   * @param {Record<string, unknown>} data - Data payload.
   * @returns {InstanceType<TMC>} - The build.
   */
  build(data) {
    const TargetModelClass = /** @type {TMC} */ (this.getTargetModelClass())

    if (!TargetModelClass) throw new Error("Can't build a new record without a target model class")

    const newInstance = /** @type {InstanceType<TMC>} */ (new TargetModelClass(data))

    this._loaded = newInstance

    return newInstance
  }

  async load() {
    const foreignKey = this.getForeignKey()
    const primaryKey = this.getPrimaryKey()
    const primaryModelID = /** @type {string | number} */ (this.getModel().readColumn(primaryKey))
    const TargetModelClass = /** @type {TMC} */ (this.getTargetModelClass())

    if (!TargetModelClass) throw new Error("Can't load without a target model class")

    /** @type {Record<string, string | number>} */
    const whereArgs = {}

    whereArgs[foreignKey] = primaryModelID

    const foreignModel = /** @type {InstanceType<TMC>} */ (await TargetModelClass.where(whereArgs).first())

    this.setLoaded(foreignModel)
    this.setDirty(false)
    this.setPreloaded(true)
  }

  /**
   * @returns {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} The loaded model or models (depending on relationship type)
   */
  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  getLoadedOrUndefined() { return this._loaded }

  /** @param {InstanceType<TMC> | Array<InstanceType<TMC>>} model - Related model(s). */
  setLoaded(model) {
    if (Array.isArray(model)) throw new Error(`Argument given to setLoaded was an array: ${typeof model}`)

    this._loaded = model
  }

  getTargetModelClass() { return this.relationship.getTargetModelClass() }
}
