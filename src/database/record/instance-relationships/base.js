// @ts-check

export default class VelociousDatabaseRecordBaseInstanceRelationship {
  /** @type {boolean | undefined} */
  _autoSave = undefined

  /**
   * @param {object} args
   * @param {import("../index.js").default} args.model
   * @param {import("../relationships/base.js").default} args.relationship
   */
  constructor({model, relationship}) {
    this._dirty = false
    this.model = model
    this.relationship = relationship
  }

  /**
   * @abstract
   * @param {Record<string, any>} attributes
   * @returns {import("../index.js").default}
   */
  build(attributes) { // eslint-disable-line no-unused-vars
    throw new Error("'build' not implemented")
  }

  /** @returns {boolean | undefined} Whether the relationship should be auto-saved before saving the parent model */
  getAutoSave() { return this._autoSave }

  /**
   * @param {boolean} newAutoSaveValue Whether the relationship should be auto-saved before saving the parent model
   * @returns {void}
   */
  setAutoSave(newAutoSaveValue) { this._autoSave = newAutoSaveValue }

  /**
   * @param {boolean} newValue Whether the relationship is dirty (has been modified)
   * @returns {void}
   */
  setDirty(newValue) { this._dirty = newValue }

  /** @returns {boolean} Whether the relationship is dirty (has been modified) */
  getDirty() { return this._dirty }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  load() {
    throw new Error("'load' not implemented")
  }

  /**  @returns {boolean} Whether the relationship has been preloaded */
  isLoaded() { return Boolean(this._loaded) }

  /** @returns {import("../index.js").default | Array<import("../index.js").default> | undefined} The loaded model or models (depending on relationship type) */
  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  /** @param {import("../index.js").default|Array<import("../index.js").default>} model */
  setLoaded(model) { this._loaded = model }

  /** @returns {import("../index.js").default | import("../index.js").default[] | undefined} */
  getLoadedOrUndefined() { return this._loaded }

  /** @returns {boolean} The loaded model or models (depending on relationship type) */
  getPreloaded() { return this._preloaded || false }

  /** @param {boolean} isPreloaded */
  setPreloaded(isPreloaded) { this._preloaded = isPreloaded }

  /** @returns {string} The foreign key for this relationship */
  getForeignKey() { return this.getRelationship().getForeignKey() }

  /** @returns {import("../index.js").default} model */
  getModel() { return this.model }

  /** @returns {string} The primary key for this relationship's model */
  getPrimaryKey() { return this.getRelationship().getPrimaryKey() }

  /** @returns {import("../relationships/base.js").default} The relationship object that this instance relationship is based on */
  getRelationship() { return this.relationship }

  /** @returns {typeof import("../index.js").default | undefined} The model class that this instance relationship */
  getTargetModelClass() { return this.getRelationship().getTargetModelClass() }

  /** @returns {string} The type of relationship (e.g. "has_many", "belongs_to", etc.) */
  getType() { return this.getRelationship().getType() }
}
