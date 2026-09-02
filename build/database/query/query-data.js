// @ts-check

import {isPlainObject} from "is-plain-object"

/**
 * QueryDataEntry type.
 * @typedef {object} QueryDataEntry
 * @property {string[]} chain - Relationship chain from the root model to the model that declares the fn. Empty for a root-level entry.
 * @property {string} fnName - Identifier under which the fn is registered on the declaring model.
 */

/**
 * Defines this typedef.
 * @typedef {string | Array<string | Record<string, ReturnType<typeof JSON.parse>>> | {[key: string]: true | false | string | string[] | Record<string, ReturnType<typeof JSON.parse>>}} QueryDataSpec
 */

/**
 * QueryDataCallbackArgs type.
 * @typedef {object} QueryDataCallbackArgs
 * @property {string} attributeName - Name under which the fn was registered. Convenient when a fn is reused across aliases.
 * @property {import("../drivers/base.js").default} driver - Active database driver, for quoting helpers and type-specific SQL.
 * @property {typeof import("../record/index.js").default} modelClass - Model class the fn is registered on (the chain's target).
 * @property {Array<string | number>} parentIds - Primary-key values of the loaded root records.
 * @property {import("./model-class-query.js").default} query - Grouped query already joined down the chain, filtered by `parentIds`, with `parent_id` pre-selected.
 * @property {string} tableName - Unquoted table reference (alias or table name) for the chain's target, ready to paste into SQL.
 */

/**
 * QueryDataFn type.
 * @typedef {(args: QueryDataCallbackArgs) => void | import("./model-class-query.js").default} QueryDataFn
 */

/**
 * Normalize a user-supplied queryData spec into a flat list of entries
 * the runner can consume. The spec mirrors the shape of `preload`, with
 * the important distinction that **leaf strings are fn names**, not
 * further relationship segments. Nested keys are relationship names
 * along the join chain from the root model to the declaring model.
 *
 * Accepted shapes (all yield the same flat entries):
 *   "foo"                                      → [{chain: [], fnName: "foo"}]
 *   ["foo", "bar"]                             → [{chain: [], fnName: "foo"}, {chain: [], fnName: "bar"}]
 *   {foo: true}                                → [{chain: [], fnName: "foo"}]
 *   {projects: ["tasksCount"]}                 → [{chain: ["projects"], fnName: "tasksCount"}]
 *   {projects: {tasks: ["transportSecondsSum", {timelogs: ["timeSecondsSum"]}]}}
 *     → [{chain: ["projects","tasks"], fnName: "transportSecondsSum"},
 *        {chain: ["projects","tasks","timelogs"], fnName: "timeSecondsSum"}]
 * @param {QueryDataSpec} spec - User-supplied spec.
 * @param {string[]} [chain] - Current chain (internal recursion).
 * @returns {QueryDataEntry[]} - Flat list of entries.
 */
export function normalizeQueryDataSpec(spec, chain = []) {
  if (spec == null) return []

  if (typeof spec === "string") {
    return [{chain: [...chain], fnName: spec}]
  }

  if (Array.isArray(spec)) {
    /**
     * Entries.
     * @type {QueryDataEntry[]} */
    const entries = []

    for (const item of spec) {
      if (typeof item === "string") {
        entries.push({chain: [...chain], fnName: item})
        continue
      }

      if (isPlainObject(item)) {
        for (const nested of normalizeQueryDataSpec(/** @type {ReturnType<typeof JSON.parse>} */ (item), chain)) {
          entries.push(nested)
        }
        continue
      }

      throw new Error(`Invalid queryData array entry: ${typeof item}`)
    }

    return entries
  }

  if (isPlainObject(spec)) {
    /**
     * Entries.
     * @type {QueryDataEntry[]} */
    const entries = []

    for (const [key, value] of Object.entries(spec)) {
      if (value === true) {
        entries.push({chain: [...chain], fnName: key})
        continue
      }

      if (value === false) continue

      if (typeof value === "string" || Array.isArray(value) || isPlainObject(value)) {
        for (const nested of normalizeQueryDataSpec(/** @type {ReturnType<typeof JSON.parse>} */ (value), [...chain, key])) {
          entries.push(nested)
        }
        continue
      }

      throw new Error(`Invalid queryData value for "${key}": ${typeof value}`)
    }

    return entries
  }

  throw new Error(`Invalid queryData spec: ${typeof spec}`)
}

/**
 * Build the nested `joins(...)` descriptor for a chain of relationship names.
 * `["projects", "tasks"]` → `{projects: {tasks: true}}`. Used internally so
 * the runner can reuse the existing `joins` path-registration machinery
 * (JoinTracker, alias generation, scope application).
 * @param {string[]} chain - Relationship chain.
 * @returns {true | Record<string, ReturnType<typeof JSON.parse>>} - Nested join descriptor, or `true` when the chain is empty.
 */
function buildNestedJoinDescriptor(chain) {
  if (chain.length === 0) return true

  /**
   * Obj.
   * @type {Record<string, ReturnType<typeof JSON.parse>>} */
  const obj = {}
  let cursor = obj

  for (let i = 0; i < chain.length; i += 1) {
    const seg = chain[i]
    const isLast = i === chain.length - 1

    cursor[seg] = isLast ? true : {}

    if (!isLast) cursor = cursor[seg]
  }

  return obj
}

/**
 * Walk a relationship chain from the root model and return the model
 * class at its tail. Throws with a clear message when any segment is
 * unknown.
 * @param {typeof import("../record/index.js").default} rootModelClass - Root model class.
 * @param {string[]} chain - Relationship chain.
 * @returns {typeof import("../record/index.js").default} - Target model class.
 */
function resolveTargetModelClass(rootModelClass, chain) {
  let modelClass = rootModelClass

  for (const segment of chain) {
    const relationship = modelClass.getRelationshipByName(segment)
    const rawTarget = relationship.getTargetModelClass()

    if (!rawTarget) {
      throw new Error(`queryData: could not resolve target model for ${modelClass.name}#${segment}`)
    }

    modelClass = modelClass.bindRecordMetadataModelClass(rawTarget)
  }

  return modelClass
}

/**
 * Run every queryData entry against the loaded root records, attaching
 * the resulting values as queryData entries on each root record.
 *
 * One grouped query per entry: the runner builds a fresh query over the
 * root model, joins down the chain, groups by the root table's primary
 * key, and invokes the registered fn to add its own SELECT (and any
 * additional joins/where). Results are mapped back to root models by
 * primary key and attached via `_setQueryData(name, value)` for every
 * selected alias (except the reserved `parent_id`). Rows missing from
 * the result keep `null` — matches the feature's documented default.
 *
 * Mirrors the shape of `runWithCount`: one query per entry, a separate
 * storage map on the record, never touches `_attributes`.
 * @param {object} args - Options.
 * @param {typeof import("../record/index.js").default} args.rootModelClass - Root model class.
 * @param {import("../record/index.js").default[]} args.rootModels - Loaded root records.
 * @param {QueryDataEntry[]} args.entries - Normalized queryData entries.
 * @returns {Promise<void>}
 */
export async function runQueryData({rootModelClass, rootModels, entries}) {
  if (rootModels.length === 0 || entries.length === 0) return

  const primaryKey = rootModelClass.primaryKey()
  const rootIds = rootModels.map((model) => /** @type {string | number} */ (model.readColumn(primaryKey)))
  const sourceModel = rootModels[0]
  const preparedEntries = entries.map((entry, entryIndex) => prepareEntry({
    entry,
    entryIndex,
    primaryKey,
    rootIds,
    rootModelClass,
    sourceModel
  }))
  /**
   * Compatible query groups.
   * @type {Array<{aliases: Set<string>, query: import("./model-class-query.js").default, signature: string}>} */
  const queryGroups = []

  for (const preparedEntry of preparedEntries) {
    const compatibleGroup = queryGroups.find((group, groupIndex) => {
      if (group.signature !== preparedEntry.signature) return false
      if (queryGroups.slice(groupIndex + 1).some((interveningGroup) => (
        preparedEntry.aliases.some((alias) => interveningGroup.aliases.has(alias))
      ))) return false

      return preparedEntry.aliases.every((alias) => !group.aliases.has(alias))
    })

    if (compatibleGroup) {
      compatibleGroup.query.select(preparedEntry.query.getSelects().slice(1))
      for (const alias of preparedEntry.aliases) compatibleGroup.aliases.add(alias)
    } else {
      queryGroups.push({
        aliases: new Set(preparedEntry.aliases),
        query: preparedEntry.query,
        signature: preparedEntry.signature
      })
    }
  }

  for (const {query} of queryGroups) {
    await executeChunkedEntryQuery({primaryKey, query, rootIds, rootModels})
  }
}

/**
 * Prepares one queryData entry and its compatibility metadata.
 * @param {object} args - Options.
 * @param {QueryDataEntry} args.entry - Entry being evaluated.
 * @param {number} args.entryIndex - Stable position used to isolate opaque projections.
 * @param {string} args.primaryKey - Root model primary key column.
 * @param {Array<string | number>} args.rootIds - Root primary-key values.
 * @param {typeof import("../record/index.js").default} args.rootModelClass - Root model class.
 * @param {import("../record/index.js").default} args.sourceModel - Loaded operation owner.
 * @returns {{aliases: string[], query: import("./model-class-query.js").default, signature: string}} - Prepared entry.
 */
function prepareEntry({entry, entryIndex, primaryKey, rootIds, rootModelClass, sourceModel}) {
  const targetModelClass = resolveTargetModelClass(rootModelClass, entry.chain)
  const fn = targetModelClass.getQueryDataByName(entry.fnName)

  if (!fn) {
    throw new Error(`queryData: ${targetModelClass.name} has no entry registered as ${JSON.stringify(entry.fnName)}. ` +
      `Declare it with ${targetModelClass.name}.queryData(${JSON.stringify(entry.fnName)}, ({query, tableName}) => query.select(...))`)
  }

  const query = sourceModel.queryForModel(rootModelClass)

  // Empty out any defaults the query factory added — queryData runs
  // a bare aggregate, not a full model load.
  query.reselect()
  query._preload = {}

  // Force the root WHERE to qualify by table name so it survives the
  // joins the fn may add later (otherwise a child table sharing the
  // root PK column name, e.g. `id`, makes the clause ambiguous).
  query._forceQualifyBaseTable = true

  const driver = query.driver
  const rootTable = rootModelClass.tableName()
  const rootPkSql = `${driver.quoteTable(rootTable)}.${driver.quoteColumn(primaryKey)}`

  const joinDescriptor = buildNestedJoinDescriptor(entry.chain)

  if (joinDescriptor !== true) {
    query.joins(joinDescriptor)
  }

  query.group(rootPkSql)
  query.select(`${rootPkSql} AS parent_id`)

  const targetTableRef = entry.chain.length === 0
    ? rootTable
    : query.getTableReferenceForJoin(...entry.chain)

  // NB: we intentionally leave `_joinBasePath` at [] so the outer chain
  // joins continue to resolve from the root model at render time. The
  // fn gets `tableName` for self-reference; additional joins from
  // nested levels should use full paths from the root.
  fn({
    attributeName: entry.fnName,
    driver,
    modelClass: targetModelClass,
    parentIds: rootIds,
    query,
    tableName: targetTableRef
  })

  const aliases = selectedAliases(query)
  const signatureQuery = query.clone()
  signatureQuery.reselect(signatureQuery.getSelects().slice(0, 1))

  return {
    aliases: aliases || [],
    query,
    signature: aliases ? signatureQuery.toSql() : `opaque:${entryIndex}`
  }
}

/**
 * Returns explicit aliases selected after the reserved parent id.
 * Entries with an opaque select stay isolated by receiving a unique compatibility alias.
 * @param {import("./model-class-query.js").default} query - Prepared queryData query.
 * @returns {string[] | null} - Selected aliases, or null for an opaque projection.
 */
function selectedAliases(query) {
  const aliases = []

  for (const select of query.getSelects().slice(1)) {
    const sql = select.toSql()
    const match = sql.match(/\sAS\s+([^\s]+)\s*$/iu)

    if (!match) return null

    aliases.push(match[1].replace(/^["[`]|["`\]]$/gu, ""))
  }

  return aliases
}

/**
 * Executes one compatible queryData group and attaches every selected alias.
 * @param {object} args - Options.
 * @param {string} args.primaryKey - Root model primary key column.
 * @param {import("./model-class-query.js").default} args.query - Prepared grouped query.
 * @param {import("../record/index.js").default[]} args.rootModels - Loaded root records.
 * @returns {Promise<void>}
 */
async function executeEntryQuery({primaryKey, query, rootModels}) {
  const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await query._executeQuery())
  const byParent = new Map()

  for (const row of rows) {
    const parentId = row.parent_id

    if (parentId == null) continue

    byParent.set(parentId, row)
  }

  for (const model of rootModels) {
    const modelId = /** @type {string | number} */ (model.readColumn(primaryKey))
    // Driver-type tolerance: MySQL can return PKs as strings even when
    // the column is numeric. Fall back to a string lookup so results
    // still land on the right model.
    const row = byParent.has(modelId)
      ? byParent.get(modelId)
      : byParent.get(String(modelId))

    if (!row) continue

    for (const [columnName, value] of Object.entries(row)) {
      if (columnName === "parent_id") continue

      model._setQueryData(columnName, value)
    }
  }
}

/**
 * Executes one compatible queryData group in cohorts so the root ID IN-list
 * stays within driver limits, attaching each selected alias to the matching
 * root record.
 * @param {object} args - Options.
 * @param {string} args.primaryKey - Root model primary key column.
 * @param {import("./model-class-query.js").default} args.query - Prepared grouped query.
 * @param {Array<string | number>} args.rootIds - Root primary-key values.
 * @param {import("../record/index.js").default[]} args.rootModels - Loaded root records.
 * @returns {Promise<void>}
 */
async function executeChunkedEntryQuery({primaryKey, query, rootIds, rootModels}) {
  const driver = query.driver
  const cohorts = driver.chunkValues(rootIds, (chunk) => query.clone().where({[primaryKey]: chunk}).toSql())

  for (const cohort of cohorts) {
    const cohortQuery = query.clone().where({[primaryKey]: cohort})

    await executeEntryQuery({primaryKey, query: cohortQuery, rootModels})
  }
}
