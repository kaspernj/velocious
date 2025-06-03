export default class VelociousDatabaseRecordHasManyRelationship {
  constructor({klass, model, relationshipName}) {
    if (!klass) throw new Error(`'klass' wasn't set for ${this.model.constructor.name}#${this.relationshipName}`)

    this.collection = []
    this.klass = klass
    this.model = model
    this.relationshipName = relationshipName
  }

  build(data) {
    const newInstance = new this.klass(data)

    this.collection.push(newInstance)

    return newInstance
  }

  loaded = () => this.collection

  setLoaded(collection) {
    this.collection = collection
  }
}
