export default class VelociousDatabaseRecordBaseInstanceRelationship {
  constructor({model, relationship}) {
    this.model = model
    this.relationship = relationship
  }

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

  getForeignKey = () => this.getRelationship().getForeignKey()
  getPrimaryKey = () => this.getRelationship().getPrimaryKey()
  getRelationship = () => this.relationship
  getTargetModelClass = () => this.getRelationship().getTargetModelClass()
  getType = () => this.getRelationship().getType()
}
