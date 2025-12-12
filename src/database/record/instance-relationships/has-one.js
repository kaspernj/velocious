// @ts-check

import BaseInstanceRelationship from "./base.js"

export default class VelociousDatabaseRecordHasOneInstanceRelationship extends BaseInstanceRelationship {
  /** @type {import("../index.js").default | undefined} */
  _loaded = undefined

  /**
   * @param {Record<string, any>} data
   * @returns {import("../index.js").default}
   */
  build(data) {
    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Can't build a new record without a target model class")

    const newInstance = new TargetModelClass(data)

    this._loaded = newInstance

    return newInstance
  }

  async load() {
    const foreignKey = this.getForeignKey()
    const primaryKey = this.getPrimaryKey()
    const primaryModelID = this.getModel().readColumn(primaryKey)
    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Can't load without a target model class")

    /** @type {Record<string, any>} */
    const whereArgs = {}

    whereArgs[foreignKey] = primaryModelID

    const foreignModel = await TargetModelClass.where(whereArgs).first()

    this.setLoaded(foreignModel)
    this.setDirty(false)
    this.setPreloaded(true)
  }

  /**
   * @returns {import("../index.js").default | Array<import("../index.js").default> | undefined} The loaded model or models (depending on relationship type)
   */
  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  getLoadedOrUndefined() { return this._loaded }

  /** @param {import("../index.js").default|Array<import("../index.js").default>} model */
  setLoaded(model) {
    if (Array.isArray(model)) throw new Error(`Argument given to setLoaded was an array: ${typeof model}`)

    this._loaded = model
  }

  getTargetModelClass() { return this.relationship.getTargetModelClass() }
}
