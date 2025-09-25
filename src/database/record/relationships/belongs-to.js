import BaseRelationship from "./base.js"
import * as inflection from "inflection"

export default class VelociousDatabaseRecordBelongsToRelationship extends BaseRelationship {
  getForeignKey() {
    if (!this.foreignKey) {
      this.foreignKey = `${inflection.underscore(this.getTargetModelClass().name)}_id`
    }

    return this.foreignKey
  }

  getInverseOf() {
    if (this._inverseOf) {
      return this._inverseOf
    }

    return inflection.pluralize(`${this.modelClass.name.substring(0, 1).toLowerCase()}${this.modelClass.name.substring(1, this.modelClass.name.length)}`)
  }
}
