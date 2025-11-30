export default class VelociousDatabaseRecordBaseInstanceRelationship {
  constructor({model, relationship}) {
    this._autoSave = null
    this._dirty = false
    this.model = model
    this.relationship = relationship
  }

  /**
   * @returns {boolean} Whether the relationship should be auto-saved before saving the parent model
   */
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

  /**
   * @returns {boolean} Whether the relationship is dirty (has been modified)
   */
  getDirty() { return this._dirty }

  /**
   * @returns {boolean} Whether the relationship has been preloaded
   */
  isLoaded() { return Boolean(this._loaded) }

  /**
   * @template T extends import("../index.js").default
   * @returns {T|Array<T>} The loaded model or models (depending on relationship type)
   */
  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  /**
   * @template T extends import("../index.js").default
   * @param {T|Array<T>} model
   */
  setLoaded(model) { this._loaded = model }

  /**
   * @template T extends import("../index.js").default
   * @returns {T|Array<T>} The loaded model or models (depending on relationship type)
   */
  getPreloaded() { return this._preloaded }

  /**
   * @template T extends import("../index.js").default
   * @param {T|Array<T>} preloadedModelOrModels
   */
  setPreloaded(preloadedModelOrModels) { this._preloaded = preloadedModelOrModels }

  /**
   * @returns {string} The foreign key for this relationship
   */
  getForeignKey() { return this.getRelationship().getForeignKey() }

  /**
   * @template T extends import("../index.js").default
   * @param {T} model
   */
  getModel() { return this.model }

  /**
   * @returns {string} The primary key for this relationship's model
   */
  getPrimaryKey() { return this.getRelationship().getPrimaryKey() }

  /**
   * @template T extends import("../relationships/base.js").default
   * @returns {T} The relationship object that this instance relationship is based on
   */
  getRelationship() { return this.relationship }

  /**
   * @returns {typeof import("../index.js").default} The model class that this instance relationship
   */
  getTargetModelClass() { return this.getRelationship().getTargetModelClass() }

  /**
   * @returns {string} The type of relationship (e.g. "has_many", "belongs_to", etc.)
   */
  getType() { return this.getRelationship().getType() }
}
