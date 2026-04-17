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
      let scopeValue = model.readAttribute(scopeColumn)

      // When the FK hasn't been flushed from the relationship object
      // onto the attribute store yet (e.g. `new Task({project})` where
      // `projectId` is still undefined), try resolving it from the
      // loaded belongsTo relationship instead.
      if (scopeValue == null) {
        scopeValue = this._resolveScopeValueFromRelationship(model, scopeColumn)
      }

      if (scopeValue == null) return

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
   * Try to resolve a scope column value from a loaded belongsTo
   * relationship on the model. When a Task is created via
   * `new Task({project})`, the FK (`projectId`) is only flushed onto
   * the attribute store during save — but the relationship object is
   * already loaded and carries the id we need for the WHERE clause.
   *
   * @param {import("../index.js").default} model
   * @param {string} scopeColumn - camelCase attribute name (e.g. `"projectId"`).
   * @returns {string | number | null}
   */
  _resolveScopeValueFromRelationship(model, scopeColumn) {
    const modelClass = /** @type {typeof import("../index.js").default} */ (model.constructor)
    const relationships = modelClass.getRelationshipsMap()

    for (const relationshipName in relationships) {
      const relationship = relationships[relationshipName]

      if (relationship.getType?.() !== "belongsTo") continue

      const foreignKey = inflection.camelize(relationship.getForeignKey(), true)

      if (foreignKey !== scopeColumn) continue

      const instanceRelationship = model.getRelationshipByName(relationshipName)
      const loaded = instanceRelationship.loaded()

      if (loaded && !Array.isArray(loaded) && typeof loaded.id === "function") {
        return loaded.id()
      }
    }

    return null
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
