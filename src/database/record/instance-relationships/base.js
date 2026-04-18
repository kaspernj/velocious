// @ts-check

import BelongsToPreloader from "../../query/preloader/belongs-to.js"
import HasManyPreloader from "../../query/preloader/has-many.js"
import HasOnePreloader from "../../query/preloader/has-one.js"

/**
 * @template {typeof import("../index.js").default} [MC=typeof import("../index.js").default]
 * @template {typeof import("../index.js").default} [TMC=typeof import("../index.js").default]
 * @typedef {object} InstanceRelationshipsBaseArgs
 * @property {InstanceType<MC>} model - Parent model instance.
 * @property {import("../relationships/base.js").default} relationship - Relationship metadata definition.
 */

/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} [MC=typeof import("../index.js").default]
 * @template {typeof import("../index.js").default} [TMC=typeof import("../index.js").default]
 */
export default class VelociousDatabaseRecordBaseInstanceRelationship {
  /** @type {boolean | undefined} */
  _autoSave = undefined
  /** @type {boolean | undefined} */
  _preloaded = undefined
  /** @type {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} */
  _loaded = undefined

  /**
   * @param {InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
   */
  constructor({model, relationship}) {
    this._dirty = false
    this.model = model
    this.relationship = relationship
  }

  /**
   * @abstract
   * @param {InstanceType<TMC>[] | InstanceType<TMC>} models - Model instances.
   * @returns {void} - No return value.
   */
  addToLoaded(models) { // eslint-disable-line no-unused-vars
    throw new Error("addToLoaded not implemented")
  }

  /**
   * @abstract
   * @param {Record<string, any>} attributes - Attributes.
   * @returns {InstanceType<TMC>} - The build.
   */
  build(attributes) { // eslint-disable-line no-unused-vars
    throw new Error("'build' not implemented")
  }

  /** @returns {boolean | undefined} Whether the relationship should be auto-saved before saving the parent model */
  getAutoSave() { return this._autoSave }

  /**
   * @param {boolean} newAutoSaveValue Whether the relationship should be auto-saved before saving the parent model
   * @returns {void} - No return value.
   */
  setAutoSave(newAutoSaveValue) { this._autoSave = newAutoSaveValue }

  /**
   * @param {boolean} newValue Whether the relationship is dirty (has been modified)
   * @returns {void} - No return value.
   */
  setDirty(newValue) { this._dirty = newValue }

  /** @returns {boolean} Whether the relationship is dirty (has been modified) */
  getDirty() { return this._dirty }

  /**
   * @abstract
   * @returns {Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>} - Resolves with loaded relationship value.
   */
  load() {
    throw new Error("'load' not implemented")
  }

  /**
   * Loads the relationship if not already loaded. When the parent record was
   * loaded as part of a batch (cohort) and autoload is enabled, siblings in
   * the cohort that share this relationship and have not preloaded it yet
   * are batched into a single query via the existing preloader path.
   * @returns {Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>} - Resolves with loaded relationship value.
   */
  async autoloadOrLoad() {
    if (this._loaded !== undefined) return this._loaded

    const batched = await this._tryCohortPreload()

    if (!batched) await this.load()

    return this._loaded
  }

  /**
   * Attempts to batch-load this relationship across cohort siblings via the
   * existing preloader path. Returns true when a batch ran (self is always
   * included because callers reset their own `_preloaded` state before
   * calling), false when autoload is off, there is no cohort, or no batch
   * candidates remain. Siblings that have already preloaded this relationship
   * are skipped so their cached value is preserved.
   * @returns {Promise<boolean>} - Whether a cohort batch preload ran.
   */
  async _tryCohortPreload() {
    const relationshipDef = this.getRelationship()
    const configuration = relationshipDef.getConfiguration()
    const cohort = /** @type {Array<import("../index.js").default> | undefined} */ (/** @type {any} */ (this.model)._loadCohort)

    if (!configuration.getAutoload() || !relationshipDef.getAutoload() || !cohort || cohort.length <= 1) {
      return false
    }

    const relationshipName = relationshipDef.getRelationshipName()
    const OwnerModelClass = /** @type {any} */ (this.model).constructor
    /** @type {Array<import("../index.js").default>} */
    const batch = []

    // Exact same class, persisted, relationship not yet preloaded for that sibling.
    for (const sibling of cohort) {
      if (sibling.constructor !== OwnerModelClass) continue
      if (!sibling.isPersisted()) continue

      const siblingInstanceRelationship = sibling.getRelationshipByName(relationshipName)

      if (siblingInstanceRelationship.getPreloaded()) continue

      batch.push(sibling)
    }

    if (batch.length === 0) return false

    const type = relationshipDef.getType()

    if (type == "belongsTo") {
      const belongsToRelationship = /** @type {import("../relationships/belongs-to.js").default} */ (relationshipDef)
      const preloader = new BelongsToPreloader({models: batch, relationship: belongsToRelationship})

      await preloader.run()
    } else if (type == "hasMany") {
      const hasManyRelationship = /** @type {import("../relationships/has-many.js").default} */ (relationshipDef)
      const preloader = new HasManyPreloader({models: batch, relationship: hasManyRelationship})

      await preloader.run()
    } else if (type == "hasOne") {
      const hasOneRelationship = /** @type {import("../relationships/has-one.js").default} */ (relationshipDef)
      const preloader = new HasOnePreloader({models: batch, relationship: hasOneRelationship})

      await preloader.run()
    } else {
      throw new Error(`Unknown relationship type: ${type}`)
    }

    return true
  }

  /**  @returns {boolean} Whether the relationship has been preloaded */
  isLoaded() { return Boolean(this._loaded) }

  /** @returns {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} The loaded model or models (depending on relationship type) */
  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  /** @param {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} model - Related model(s) to mark as loaded. */
  setLoaded(model) { this._loaded = model }

  /** @returns {InstanceType<TMC> | InstanceType<TMC>[] | undefined} - The loaded or undefined.  */
  getLoadedOrUndefined() { return this._loaded }

  /** @returns {boolean} The loaded model or models (depending on relationship type) */
  getPreloaded() { return this._preloaded || false }

  /** @param {boolean} isPreloaded - Whether the relationship is preloaded. */
  setPreloaded(isPreloaded) { this._preloaded = isPreloaded }

  /** @returns {string} The foreign key for this relationship */
  getForeignKey() { return this.getRelationship().getForeignKey() }

  /** @returns {InstanceType<MC>} - The model.  */
  getModel() { return this.model }

  /** @returns {string} The primary key for this relationship's model */
  getPrimaryKey() { return this.getRelationship().getPrimaryKey() }

  /** @returns {import("../relationships/base.js").default} The relationship object that this instance relationship is based on */
  getRelationship() { return this.relationship }

  /**
   * @template T
   * @param {T} query - Query instance.
   * @returns {T} - Scoped query.
   */
  applyScope(query) {
    return this.getRelationship().applyScope(query)
  }

  /** @returns {TMC | undefined} The model class that this instance relationship */
  getTargetModelClass() {
    const TargetModelClass = /** @type {TMC} */ (this.getRelationship().getTargetModelClass())

    return TargetModelClass
  }

  /** @returns {string} The type of relationship (e.g. "has_many", "belongs_to", etc.) */
  getType() { return this.getRelationship().getType() }
}
