import BaseRelationship from "./base.mjs"
import * as inflection from "inflection"

export default class VelociousDatabaseRecordBelongsToRelationship extends BaseRelationship {
  getForeignKey() {
    if (!this.foreignKey) {
      this.foreignKey = `${inflection.underscore(this.getTargetModelClass().name)}_id`
    }

    return this.foreignKey
  }
}
