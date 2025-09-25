export default class VelociousDatabaseRecordBaseInstanceRelationship {
  constructor({model, relationship}) {
    this._autoSave = null
    this._dirty = false
    this.model = model
    this.relationship = relationship
  }

  getAutoSave() { return this._autoSave }
  setAutoSave(newAutoSaveValue) { this._autoSave = newAutoSaveValue }
  setDirty(newValue) { this._dirty = newValue }
  getDirty() { return this._dirty }
  isLoaded() { return Boolean(this._loaded) }

  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  setLoaded(model) { this._loaded = model }
  getPreloaded() { return this._preloaded }
  setPreloaded(preloadedValue) { this._preloaded = preloadedValue }
  getForeignKey() { return this.getRelationship().getForeignKey() }
  getModel() { return this.model }
  getPrimaryKey() { return this.getRelationship().getPrimaryKey() }
  getRelationship() { return this.relationship }
  getTargetModelClass() { return this.getRelationship().getTargetModelClass() }
  getType() { return this.getRelationship().getType() }
}
