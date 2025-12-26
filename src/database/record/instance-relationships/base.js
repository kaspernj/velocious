// @ts-check

/**
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @typedef {object} InstanceRelationshipsBaseArgs
 * @property {InstanceType<MC>} model - Parent model instance.
 * @property {import("../relationships/base.js").default} relationship - Relationship metadata definition.
 */

/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 */
export default class VelociousDatabaseRecordBaseInstanceRelationship {
  /** @type {boolean | undefined} */
  _autoSave = undefined

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
   * @param {Record<string, unknown>} attributes - Attributes.
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
   * @returns {Promise<void>} - Resolves when complete.
   */
  load() {
    throw new Error("'load' not implemented")
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

  /** @returns {TMC | undefined} The model class that this instance relationship */
  getTargetModelClass() {
    const TargetModelClass = /** @type {TMC} */ (this.getRelationship().getTargetModelClass())

    return TargetModelClass
  }

  /** @returns {string} The type of relationship (e.g. "has_many", "belongs_to", etc.) */
  getType() { return this.getRelationship().getType() }
}
