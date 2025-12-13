// @ts-check

import Base from "./base.js"
import * as inflection from "inflection"

export default class VelociousDatabaseRecordValidatorsUniqueness extends Base {
  /**
   * @param {object} args
   * @param {import("../index.js").default} args.model
   * @param {string} args.attributeName
   * @returns {Promise<void>}
   */
  async validate({model, attributeName}) {
    const modelClass = /** @type {typeof import("../index.js").default} */ (model.constructor)

    const connection = modelClass.connection()
    const tableName = modelClass._getTable().getName()
    const attributeValue = model.readAttribute(attributeName)
    const attributeNameUnderscore = inflection.underscore(attributeName)

    /** @type {Record<string, any>} */
    const whereArgs = {}

    whereArgs[attributeNameUnderscore] = attributeValue

    let existingRecordQuery = modelClass
      .select(modelClass.primaryKey())
      .where(whereArgs)

    if (model.isPersisted()) {
      existingRecordQuery.where(`${connection.quoteTable(tableName)}.${connection.quoteColumn(modelClass.primaryKey())} != ${connection.quote(model.id())}`)
    }

    const existingRecord = await existingRecordQuery.first()

    if (existingRecord) {
      if (!(attributeName in model._validationErrors)) model._validationErrors[attributeName] = []

      model._validationErrors[attributeName].push({type: "uniqueness", message: "has already been taken"})
    }
  }
}
