export default class VelociousDatabaseRecordBaseInstanceRelationship {
  constructor({model, relationship}) {
    this._dirty = false
    this.model = model
    this.relationship = relationship
  }

  setDirty(newValue) {
    this._dirty = newValue
  }

  getDirty() { return this._dirty }

  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    return this._loaded
  }

  setLoaded(model) {
    this._loaded = model
  }

  setPreloaded(preloadedValue) {
    this._preloaded = preloadedValue
  }

  getForeignKey() { return this.getRelationship().getForeignKey() }
  getPrimaryKey() { return this.getRelationship().getPrimaryKey() }
  getRelationship() { return this.relationship }
  getTargetModelClass() { return this.getRelationship().getTargetModelClass() }
  getType() { return this.getRelationship().getType() }
}
