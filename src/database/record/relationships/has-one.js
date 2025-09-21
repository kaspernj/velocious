import BaseRelationship from "./base.js"
import * as inflection from "inflection"

export default class VelociousDatabaseRecordHasOneRelationship extends BaseRelationship {
  getForeignKey() {
    if (!this.foreignKey) {
      this.foreignKey = `${inflection.underscore(this.modelClass.name)}_id`
    }

    return this.foreignKey
  }
}
