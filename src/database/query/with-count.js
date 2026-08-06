// @ts-check

/**
 * WithCountEntry type.
 * @typedef {object} WithCountEntry
 * @property {string} attributeName - Attribute to set on each parent record holding the count.
 * @property {string} relationshipName - Has-many relationship whose rows are counted.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | undefined} where - Optional extra where clause applied to the count query.
 */

/**
 * Defines this typedef.
 * @typedef {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} WithCountSpec
 */

/**
 * Normalize the flexible user-facing `.withCount(...)` argument into the
 * strict internal list of {attributeName, relationshipName, where} entries
 * the runner consumes.
 *
 * Accepted shapes:
 *   "projects"                                         → one entry
 *   ["projects", "timelogs"]                           → one entry per name
 *   {projects: true}                                   → one entry (attr = "projectsCount")
 *   {activeMembersCount:                               → custom attribute name
 *     {relationship: "users", where: {active: true}}}
 * @param {WithCountSpec} spec - User-supplied spec.
 * @returns {WithCountEntry[]} - Normalized entries.
 */
export function normalizeWithCount(spec) {
  if (spec == null) return []

  if (typeof spec === "string") {
    return [entryFromName(spec)]
  }

  if (Array.isArray(spec)) {
    return spec.flatMap((item) => {
      if (typeof item !== "string") {
        throw new Error(`withCount array entries must be strings; got ${typeof item}`)
      }

      return entryFromName(item)
    })
  }

  if (typeof spec === "object") {
    /**
     * Entries.
     * @type {WithCountEntry[]} */
    const entries = []

    for (const [key, value] of Object.entries(spec)) {
      if (value === true) {
        entries.push(entryFromName(key))
        continue
      }

      if (value === false) {
        continue
      }

      if (typeof value === "object" && value !== null) {
        /**
         * Options.
         * @type {{relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}} */
        const options = value
        entries.push({
          attributeName: key,
          relationshipName: options.relationship || key,
          where: options.where
        })
        continue
      }

      throw new Error(`Invalid withCount value for ${key}: ${typeof value}`)
    }

    return entries
  }

  throw new Error(`Invalid withCount spec: ${typeof spec}`)
}

/**
 * Runs entry from name.
 * @param {string} name - Relationship name (attribute name is derived by appending "Count").
 * @returns {WithCountEntry} - Normalized association-count entry.
 */
function entryFromName(name) {
  return {
    attributeName: `${name}Count`,
    relationshipName: name,
    where: undefined
  }
}

/**
 * Run every withCount entry against the loaded parent records, attaching
 * the resulting counts as attributes on each record. Mirrors the
 * Preloader's data-flow shape — one grouped count query per entry, then
 * `setAttribute` on each parent.
 * @param {object} args - Options.
 * @param {import("../record/index.js").default[]} args.models - Loaded parent records.
 * @param {typeof import("../record/index.js").default} args.modelClass - Parent model class.
 * @param {WithCountEntry[]} args.entries - Normalized withCount entries.
 * @returns {Promise<void>}
 */
export async function runWithCount({models, modelClass, entries}) {
  if (models.length === 0 || entries.length === 0) return

  const primaryKey = modelClass.primaryKey()
  const parentIds = models.map((model) => /** @type {string | number} */ (model.readColumn(primaryKey)))
  const sourceModel = models[0]
  const queryGroups = new Map()

  for (const entry of entries) {
    const countQuery = queryForEntry({entry, modelClass, parentIds, sourceModel})
    const sql = countQuery.toSql()
    const existingGroup = queryGroups.get(sql)

    if (existingGroup) {
      existingGroup.entries.push(entry)
    } else {
      queryGroups.set(sql, {countQuery, entries: [entry]})
    }
  }

  for (const {countQuery, entries: groupedEntries} of queryGroups.values()) {
    const counts = await executeCountQuery(countQuery)

    for (const entry of groupedEntries) attachCounts({counts, entry, models, primaryKey})
  }
}

/**
 * Builds the grouped count query for an entry.
 * @param {object} args - Options.
 * @param {WithCountEntry} args.entry - Entry being evaluated.
 * @param {typeof import("../record/index.js").default} args.modelClass - Parent model class.
 * @param {Array<string | number>} args.parentIds - Primary keys of the loaded parents.
 * @param {import("../record/index.js").default} args.sourceModel - Loaded operation owner.
 * @returns {import("./model-class-query.js").default} - Prepared count query.
 */
function queryForEntry({entry, modelClass, parentIds, sourceModel}) {
  const relationship = modelClass.getRelationshipByName(entry.relationshipName)

  if (!relationship) {
    throw new Error(`${modelClass.name} has no relationship named ${JSON.stringify(entry.relationshipName)} (withCount attribute ${JSON.stringify(entry.attributeName)})`)
  }

  if (relationship.type !== "hasMany") {
    throw new Error(`withCount currently supports only hasMany relationships; ${modelClass.name}#${entry.relationshipName} is ${relationship.type}`)
  }

  const targetModelClass = relationship.getTargetModelClass()

  if (!targetModelClass) {
    throw new Error(`withCount: could not resolve target model for ${modelClass.name}#${entry.relationshipName}`)
  }

  const foreignKey = relationship.getForeignKey()
  /**
   * Mandatory cohort conditions.
   * @type {Record<string, ReturnType<typeof JSON.parse>>} */
  const mandatoryWhereConditions = {[foreignKey]: parentIds}

  if (relationship.getPolymorphic && relationship.getPolymorphic()) {
    const typeColumn = relationship.getPolymorphicTypeColumn()
    mandatoryWhereConditions[typeColumn] = modelClass.getModelName()
  }

  const baseQuery = sourceModel.queryForModel(targetModelClass)
  baseQuery._forceQualifyBaseTable = true
  baseQuery.where(mandatoryWhereConditions)

  if (entry.where) {
    baseQuery.where(entry.where)
  }

  const countQuery = relationship.applyScope(baseQuery)

  countQuery._preload = {}
  countQuery.reselect()

  const driver = countQuery.driver
  const quotedTable = driver.quoteTable(countQuery.rootTableReference())
  const quotedFk = driver.quoteColumn(foreignKey)
  const qualifiedForeignKey = `${quotedTable}.${quotedFk}`

  countQuery.group(qualifiedForeignKey)
  countQuery.select(`${qualifiedForeignKey} AS parent_id`)
  countQuery.select("COUNT(*) AS count_value")

  return countQuery
}

/**
 * Executes a prepared grouped count query.
 * @param {import("./model-class-query.js").default} countQuery - Prepared count query.
 * @returns {Promise<Map<string | number, number>>} - Map of parent pk → count.
 */
async function executeCountQuery(countQuery) {
  const rows = /** @type {Array<{parent_id: string | number, count_value: string | number}>} */ (
    await countQuery._executeQuery()
  )

  /**
   * Counts.
   * @type {Map<string | number, number>} */
  const counts = new Map()

  for (const row of rows) {
    const parentId = /** @type {string | number} */ (row.parent_id)
    const countValue = Number(row.count_value) || 0
    counts.set(parentId, countValue)
  }

  return counts
}

/**
 * Attaches one entry's resolved counts to the loaded models.
 * @param {object} args - Options.
 * @param {Map<string | number, number>} args.counts - Counts keyed by parent primary key.
 * @param {WithCountEntry} args.entry - Entry whose alias receives the counts.
 * @param {import("../record/index.js").default[]} args.models - Loaded parent records.
 * @param {string} args.primaryKey - Parent primary key column.
 * @returns {void}
 */
function attachCounts({counts, entry, models, primaryKey}) {
  for (const model of models) {
    const modelPrimaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey))
    // Tolerate driver differences in numeric return types: SQLite
    // returns integers as JS numbers, but MySQL's raw driver can
    // return count primary keys as strings. Try both.
    const resolvedCount = counts.has(modelPrimaryKeyValue)
      ? /** @type {number} */ (counts.get(modelPrimaryKeyValue))
      : Number(counts.get(String(modelPrimaryKeyValue)) ?? 0)

    // Counts go on the record's dedicated association-count map,
    // NOT on `_attributes`, so a virtual `tasksCount` can't shadow a
    // real `tasks_count` column (e.g. a counter_cache) nor leak into
    // attribute-level serialization / change tracking.
    model._setAssociationCount(entry.attributeName, resolvedCount)
  }
}
