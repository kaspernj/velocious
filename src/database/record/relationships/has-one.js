import BaseRelationship from "./base.js"
import * as inflection from "inflection"

export default class VelociousDatabaseRecordHasOneRelationship extends BaseRelationship {
  getForeignKey() {
    if (!this.foreignKey) {
      this.foreignKey = `${inflection.underscore(this.modelClass.name)}_id`
    }

    return this.foreignKey
  }

  getInverseOf() {
    if (this._inverseOf) {
      return this._inverseOf
    }

    return `${this.modelClass.name.substring(0, 1).toLowerCase()}${this.modelClass.name.substring(1, this.modelClass.name.length)}`
  }
}
