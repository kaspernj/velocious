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
   * Runs constructor.
   * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
   */
  constructor(args) {
    super(args)
  }

  /**
   * Runs build.
   * @param {Record<string, ?>} data - Data payload.
   * @returns {InstanceType<TMC>} - The build.
   */
  build(data) {
    const TargetModelClass = /**
                              * Narrows the runtime value to the documented type.
                               @type {TMC} */ (this.getTargetModelClass())

    if (!TargetModelClass) throw new Error("Can't build a new record without a target model")

    const newInstance = /**
                         * Narrows the runtime value to the documented type.
                          @type {InstanceType<TMC>} */ (new TargetModelClass(data))

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

    await this._loadForeignModelOrBlank()
    this.setDirty(false)
    this.setPreloaded(true)

    return this.loaded()
  }

  /**
   * Loads the foreign model, or marks the relationship blank for empty keys.
   * @returns {Promise<void>} - Resolves after the loaded value is assigned.
   */
  async _loadForeignModelOrBlank() {
    const TargetModelClass = this._getTargetModelClassOrFail()
    const foreignModelID = this._readForeignModelID()

    if (foreignModelID === null || foreignModelID === undefined || foreignModelID === "") {
      this.setLoaded(undefined)
    } else {
      this.setLoaded(await this._loadForeignModel({foreignModelID, TargetModelClass}))
    }
  }

  /**
   * Loads the related model from the foreign key value.
   * @param {object} args - Options.
   * @param {string | number | null | undefined} args.foreignModelID - Foreign model ID.
   * @param {TMC} args.TargetModelClass - Target model class.
   * @returns {Promise<InstanceType<TMC> | undefined>} - Loaded foreign model.
   */
  async _loadForeignModel({foreignModelID, TargetModelClass}) {
    const primaryKey = TargetModelClass.primaryKey()
    /**
     * Where args.
      @type {Record<string, string | number | null | undefined>} */
    const whereArgs = {}

    whereArgs[primaryKey] = foreignModelID

    const query = this.applyScope(TargetModelClass.where(whereArgs))

    return /** Narrows the runtime value to the documented type. @type {Promise<InstanceType<TMC> | undefined>} */ (query.first())
  }

  /**
   * Gets the required target model class.
   * @returns {TMC} - Target model class.
   */
  _getTargetModelClassOrFail() {
    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Can't load without a target model")

    return TargetModelClass
  }

  /**
   * Reads the current foreign key value from the parent record.
   * @returns {string | number | null | undefined} - Foreign model ID.
   */
  _readForeignModelID() {
    return this.getModel().readColumn(this.getForeignKey())
  }

}
