import Base from "./base.js"
import * as inflection from "inflection"

export default class VelociousDatabaseRecordValidatorsUniqueness extends Base {
  async validate({model, attributeName}) {
    const attributeValue = model.readAttribute(attributeName)
    const attributeNameUnderscore = inflection.underscore(attributeName)
    const whereArgs = {}

    whereArgs[attributeNameUnderscore] = attributeValue

    const existingRecord = await model.constructor
      .select(model.constructor.primaryKey())
      .where(whereArgs)
      .first()

    if (existingRecord) {
      if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

      model._validationErrors[attributeName].push({type: "uniqueness", message: "has already been taken"})
    }
  }
}
