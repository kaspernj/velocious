// @ts-check

import Base from "./base.js"
import * as inflection from "inflection"

export default class VelociousDatabaseRecordValidatorsUniqueness extends Base {
  /**
   * @param {object} args - Options object.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.attributeName - Attribute name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async validate({model, attributeName}) {
    const modelClass = /** @type {typeof import("../index.js").default} */ (model.constructor)

    const connection = modelClass.connection()
    const tableName = modelClass._getTable().getName()
    const attributeValue = /** @type {string | number} */ (model.readAttribute(attributeName))
    const attributeNameUnderscore = inflection.underscore(attributeName)

    /** @type {Record<string, string | number>} */
    const whereArgs = {}

    whereArgs[attributeNameUnderscore] = attributeValue

    // Rails parity: `validates :attr, uniqueness: {scope: :other}` adds
    // the scoped column(s) to the WHERE clause so uniqueness is checked
    // within the given scope (e.g. `role` unique per `userId`).
    const scopeColumns = this._normalizeScopeColumns()

    for (const scopeColumn of scopeColumns) {
      const scopeUnderscore = inflection.underscore(scopeColumn)
      const scopeValue = model.readAttribute(scopeColumn)

      // When the scope value is not yet available (e.g. a belongsTo FK
      // that hasn't been flushed from the relationship object onto the
      // attribute store), the uniqueness check cannot be evaluated — the
      // DB would receive `column = N'undefined'` and reject it. Bail
      // out and let the DB-level unique constraint catch it at INSERT
      // time instead.
      if (scopeValue == null || scopeValue === undefined) return

      whereArgs[scopeUnderscore] = /** @type {string | number} */ (scopeValue)
    }

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

  /**
   * Normalize the `scope` option into an array of attribute names.
   * Supports string (`"userId"`), array of strings (`["userId", "projectId"]`),
   * or absent (empty array — no scope, original single-column behavior).
   *
   * @returns {string[]}
   */
  _normalizeScopeColumns() {
    const scope = this.args?.scope

    if (!scope) return []
    if (Array.isArray(scope)) return scope

    return [String(scope)]
  }
}
