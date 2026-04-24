// @ts-check

/**
 * @typedef {Object} WithCountEntry
 * @property {string} attributeName - Attribute to set on each parent record holding the count.
 * @property {string} relationshipName - Has-many relationship whose rows are counted.
 * @property {Record<string, unknown> | undefined} where - Optional extra where clause applied to the count query.
 */

/**
 * @typedef {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, unknown>}>} WithCountSpec
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
 *
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
    /** @type {WithCountEntry[]} */
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
        /** @type {{relationship?: string, where?: Record<string, unknown>}} */
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
 * @param {string} name - Relationship name (attribute name is derived by appending "Count").
 * @returns {WithCountEntry}
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
 *
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

  for (const entry of entries) {
    const counts = await countForEntry({entries, entry, modelClass, parentIds})

    for (const model of models) {
      const modelPrimaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey))
      // Tolerate driver differences in numeric return types: SQLite
      // returns integers as JS numbers, but MySQL's raw driver can
      // return count primary keys as strings. Try both.
      const resolvedCount = counts.has(modelPrimaryKeyValue)
        ? counts.get(modelPrimaryKeyValue)
        : (counts.get(String(modelPrimaryKeyValue)) ?? 0)

      // Write directly into the record's attribute map rather than going
      // through `setAttribute`: these are computed counts rather than
      // mapped columns, so no generated setter exists (`setAttribute`
      // requires one) and there's nothing to typecoerce as with columns.
      model._attributes[entry.attributeName] = resolvedCount
    }
  }
}

/**
 * @param {object} args - Options.
 * @param {WithCountEntry[]} args.entries - All entries, used for error context only.
 * @param {WithCountEntry} args.entry - Entry being evaluated.
 * @param {typeof import("../record/index.js").default} args.modelClass - Parent model class.
 * @param {Array<string | number>} args.parentIds - Primary keys of the loaded parents.
 * @returns {Promise<Map<string | number, number>>} - Map of parent pk → count.
 */
async function countForEntry({entries, entry, modelClass, parentIds}) {
  void entries

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
  /** @type {Record<string, unknown>} */
  const whereConditions = {[foreignKey]: parentIds}

  if (relationship.getPolymorphic && relationship.getPolymorphic()) {
    const typeColumn = relationship.getPolymorphicTypeColumn()
    whereConditions[typeColumn] = modelClass.getModelName()
  }

  if (entry.where) {
    Object.assign(whereConditions, entry.where)
  }

  const countQuery = targetModelClass
    .where(whereConditions)
    .group(foreignKey)

  countQuery._preload = {}
  countQuery._selects = []

  const driver = countQuery.driver
  const quotedTable = driver.quoteTable(targetModelClass.tableName())
  const quotedFk = driver.quoteColumn(foreignKey)

  countQuery.select(`${quotedTable}.${quotedFk} AS parent_id`)
  countQuery.select("COUNT(*) AS count_value")

  const rows = /** @type {Array<{parent_id: string | number, count_value: string | number}>} */ (
    await countQuery._executeQuery()
  )

  /** @type {Map<string | number, number>} */
  const counts = new Map()

  for (const row of rows) {
    const parentId = /** @type {string | number} */ (row.parent_id)
    const countValue = Number(row.count_value) || 0
    counts.set(parentId, countValue)
  }

  return counts
}
