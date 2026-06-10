// @ts-check

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Encapsulates the column selection and idempotency rules for preloading.
 *
 * Two per-target-model-name maps drive the behaviour, both keyed by the target
 * model name (e.g. `"Account"`):
 *
 * - `preloadSelects` (from `.select({Account: ["id"]})`) narrows the columns
 *   loaded for that target to the listed attributes (plus the primary/foreign
 *   keys needed to map results back to their parents).
 * - `preloadSelectsExtra` (from `.selectsExtra({Account: ["..."]})`) keeps the
 *   default `SELECT *` columns and loads the listed extra selects in addition.
 *
 * `force` re-loads relationships even when they are already preloaded.
 */
export default class VelociousDatabaseQueryPreloaderSelection {
  /**
 * Runs constructor.
   * @param {object} [args] - Options object.
   * @param {Record<string, string[]>} [args.preloadSelects] - Narrowing selects keyed by target model name.
   * @param {Record<string, string[]>} [args.preloadSelectsExtra] - Extra selects keyed by target model name.
   * @param {boolean} [args.force] - Whether to re-load already-preloaded relationships.
   */
  constructor({preloadSelects = {}, preloadSelectsExtra = {}, force = false} = {}) {
    this.preloadSelects = preloadSelects
    this.preloadSelectsExtra = preloadSelectsExtra
    this.force = force
  }

  /**
 * Runs get force.
 * @returns {boolean} - Whether already-preloaded relationships should still be re-loaded. */
  getForce() { return this.force }

  /**
 * Runs narrowing for.
   * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
   * @returns {string[] | undefined} - Narrowing select attributes for the class, if any.
   */
  _narrowingFor(targetModelClass) {
    return this.preloadSelects[targetModelClass.getModelName()]
  }

  /**
 * Runs extra for.
   * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
   * @returns {string[] | undefined} - Extra select attributes/expressions for the class, if any.
   */
  _extraFor(targetModelClass) {
    return this.preloadSelectsExtra[targetModelClass.getModelName()]
  }

  /**
   * Apply the configured select clauses to a target query.
   * @template {import("../model-class-query.js").default} T
   * @param {object} args - Options object.
   * @param {T} args.query - Target query to apply selects to.
   * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
   * @param {string[]} args.mappingColumns - Columns that must always be loaded so results can be mapped back to parents (primary/foreign keys).
   * @returns {T} - The query, with selects applied when a selection is configured.
   */
  applyToQuery({query, targetModelClass, mappingColumns}) {
    const narrowing = this._narrowingFor(targetModelClass)
    const extra = this._extraFor(targetModelClass)

    if (narrowing) {
      const selects = [...new Set([...narrowing, ...mappingColumns, ...(extra || [])])]

      return /** Documents this API. @type {T} */ (query.select(selects))
    }

    if (extra) {
      const allColumns = `${query.driver.quoteTable(targetModelClass.tableName())}.*`

      return /** Documents this API. @type {T} */ (query.select([allColumns, ...extra]))
    }

    return query
  }

  /**
   * Whether an already-preloaded relationship's loaded target(s) satisfy the
   * configured selection, so the relationship can be skipped. Returns false
   * when `force` is set, when the relationship hasn't been preloaded, or when a
   * required column is missing from a loaded target.
   * @param {object} args - Options object.
   * @param {import("../../record/instance-relationships/base.js").default} args.instanceRelationship - The source model's instance relationship.
   * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
   * @param {string[]} args.mappingColumns - Primary/foreign key columns required for mapping.
   * @returns {boolean} - Whether the relationship is already satisfied.
   */
  isSatisfied({instanceRelationship, targetModelClass, mappingColumns}) {
    if (this.force) return false
    if (!instanceRelationship.getPreloaded()) return false

    const required = this._requiredColumnsFor({targetModelClass, mappingColumns})

    if (!required) return false

    const loaded = instanceRelationship.getLoadedOrUndefined()
    const targets = loaded === undefined ? [] : (Array.isArray(loaded) ? loaded : [loaded])

    for (const target of targets) {
      for (const column of required) {
        if (!target.hasLoadedColumn(column)) return false
      }
    }

    return true
  }

  /**
   * The set of columns that must be present on a loaded target for it to count
   * as satisfied. Returns null when satisfaction can't be verified (an extra
   * select is a raw SQL expression whose resulting column can't be derived), in
   * which case the relationship is always re-loaded.
   * @param {object} args - Options object.
   * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
   * @param {string[]} args.mappingColumns - Primary/foreign key columns required for mapping.
   * @returns {string[] | null} - Required column names, or null when unverifiable.
   */
  _requiredColumnsFor({targetModelClass, mappingColumns}) {
    const attributeMap = targetModelClass.getAttributeNameToColumnNameMap()
    const narrowing = this._narrowingFor(targetModelClass)
    const extra = this._extraFor(targetModelClass)
    /**
 * Columns.
 * @type {string[]} */
    const columns = []

    if (narrowing) {
      for (const attribute of narrowing) columns.push(attributeMap[attribute] || attribute)
      for (const column of mappingColumns) columns.push(column)
    } else {
      for (const column of targetModelClass.getColumnNames()) columns.push(column)
    }

    if (extra) {
      for (const entry of extra) {
        if (!IDENTIFIER_REGEX.test(entry)) return null

        columns.push(attributeMap[entry] || entry)
      }
    }

    return columns
  }
}
