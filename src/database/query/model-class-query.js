// @ts-check

import {incorporate} from "incorporator"
import * as inflection from "inflection"
import {isPlainObject} from "is-plain-object"
import Logger from "../../logger.js"
import Preloader from "./preloader.js"
import {normalizeQueryDataSpec, runQueryData} from "./query-data.js"
import {normalizeWithCount, runWithCount} from "./with-count.js"
import DatabaseQuery from "./index.js"
import JoinObject from "./join-object.js"
import JoinPlain from "./join-plain.js"
import JoinTracker from "./join-tracker.js"
import RecordNotFoundError from "../record/record-not-found-error.js"
import {normalizeRansackParams, parseRansackSort} from "../../utils/ransack.js"
import {isModelScopeDescriptor} from "../../utils/model-scope.js"
import WhereModelClassHash from "./where-model-class-hash.js"
import WhereNot from "./where-not.js"
import JoinsParser from "../query-parser/joins-parser.js"
import WhereParser from "../query-parser/where-parser.js"

/**
 * @param {string} value - Potentially quoted SQL identifier.
 * @returns {string} - Unquoted identifier.
 */
function unquoteSqlIdentifier(value) {
  const trimmed = value.trim()

  if (trimmed.length >= 2 && ((trimmed.startsWith("`") && trimmed.endsWith("`")) || (trimmed.startsWith("\"") && trimmed.endsWith("\"")))) {
    return trimmed.slice(1, -1)
  }

  if (trimmed.length >= 2 && trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

/**
 * @param {string} fromPlain - FROM clause source.
 * @returns {string | null} - Parsed table reference or null when unsupported.
 */
function parseFromPlainTableReference(fromPlain) {
  const trimmed = fromPlain.trim()

  if (trimmed.length < 1) return null

  const aliasMatch = trimmed.match(/(?:^|\s)(?:AS\s+)?([`"]?[a-zA-Z_][a-zA-Z0-9_]*[`"]?|\[[a-zA-Z_][a-zA-Z0-9_]*\])\s*$/i)

  if (!aliasMatch || !aliasMatch[1]) return null

  return unquoteSqlIdentifier(aliasMatch[1])
}

/**
 * @param {string | string[]} path - Scope path input.
 * @returns {string[]} - Normalized path.
 */
function normalizeScopePath(path) {
  if (typeof path === "string") {
    if (path.length < 1) throw new Error("Scope path strings must be non-empty")

    return [path]
  }

  if (!Array.isArray(path)) {
    throw new Error(`Invalid scope path type: ${typeof path}`)
  }

  for (const entry of path) {
    if (typeof entry !== "string" || entry.length < 1) {
      throw new Error("Scope path entries must be non-empty strings")
    }
  }

  return [...path]
}

/**
 * @param {import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} preload - Preload data in shorthand or nested form.
 * @returns {import("./index.js").NestedPreloadRecord} - Normalized preload record.
 */
function normalizePreloadRecord(preload) {
  if (!preload) return {}

  if (typeof preload == "string") {
    return {[preload]: true}
  }

  if (Array.isArray(preload)) {
    /** @type {import("./index.js").NestedPreloadRecord} */
    const result = {}

    for (const entry of preload) {
      if (typeof entry == "string") {
        result[entry] = true
        continue
      }

      if (isPlainObject(entry)) {
        incorporate(result, normalizePreloadRecord(entry))
        continue
      }

      throw new Error(`Invalid preload entry type: ${typeof entry}`)
    }

    return result
  }

  if (!isPlainObject(preload)) {
    throw new Error(`Invalid preload type: ${typeof preload}`)
  }

  /** @type {import("./index.js").NestedPreloadRecord} */
  const result = {}

  for (const [key, value] of Object.entries(preload)) {
    if (value === true || value === false) {
      result[key] = value
      continue
    }

    if (typeof value == "string" || Array.isArray(value) || isPlainObject(value)) {
      result[key] = normalizePreloadRecord(value)
      continue
    }

    throw new Error(`Invalid preload value for ${key}: ${typeof value}`)
  }

  return result
}

/**
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 */
/**
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 * @typedef {import("./index.js").QueryArgsType & {modelClass: MC, joinBasePath?: string[], joinTracker?: import("./join-tracker.js").default, forceQualifyBaseTable?: boolean, withCount?: import("./with-count.js").WithCountEntry[], queryData?: import("./query-data.js").QueryDataEntry[]}} ModelClassQueryArgsType
 */

/**
 * A generic query over some model type.
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 */
export default class VelociousDatabaseQueryModelClassQuery extends DatabaseQuery {
  /** @param {ModelClassQueryArgsType<MC>} args - Query constructor arguments. */
  constructor(args) {
    const {modelClass} = args

    if (!modelClass) throw new Error(`No modelClass given in ${Object.keys(args).join(", ")}`)

    super(args)
    this.logger = new Logger(this)

    /** @type {MC} */
    this.modelClass = modelClass

    /** @type {string[]} */
    this._joinBasePath = args.joinBasePath || []
    this._joinTracker = args.joinTracker || new JoinTracker({modelClass: this.modelClass})
    this._forceQualifyBaseTable = Boolean(args.forceQualifyBaseTable)

    /** @type {import("./with-count.js").WithCountEntry[]} */
    this._withCount = args.withCount ? [...args.withCount] : []

    /** @type {import("./query-data.js").QueryDataEntry[]} */
    this._queryData = args.queryData ? [...args.queryData] : []
  }

  /** @returns {this} - The clone.  */
  clone() {
    const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (new VelociousDatabaseQueryModelClassQuery({
      driver: this._driverFn,
      froms: [...this._froms],
      handler: this.handler.clone(),
      groups: [...this._groups],
      joins: [...this._joins],
      limit: this._limit,
      modelClass: this.modelClass,
      offset: this._offset,
      orders: [...this._orders],
      page: this._page,
      perPage: this._perPage,
      preload: {...this._preload},
      distinct: this._distinct,
      selects: [...this._selects],
      wheres: [...this._wheres],
      joinBasePath: [...this._joinBasePath],
      joinTracker: this._joinTracker.clone(),
      forceQualifyBaseTable: this._forceQualifyBaseTable,
      withCount: [...this._withCount],
      queryData: [...this._queryData]
    }))

    // @ts-expect-error
    return newQuery
  }

  /**
   * Tell the query to attach one or more association counts onto every
   * loaded record. The counts land as regular attributes on each record;
   * read them with `model.readAttribute("<name>Count")`.
   *
   * @param {import("./with-count.js").WithCountSpec} spec - Count spec in shorthand or nested form.
   * @returns {this} - This query, for chaining.
   */
  withCount(spec) {
    for (const entry of normalizeWithCount(spec)) {
      this._withCount.push(entry)
    }

    return this
  }

  /**
   * Attach one or more consumer-defined, per-row computed values onto
   * every loaded root record. Leaf strings in the spec are names of
   * functions previously registered via `Model.queryData(name, fn)`.
   * Nested object keys are relationship names traced from the root to
   * the model that declares the fn. Every resulting SELECT alias is
   * attached to the **root** record (not to the intermediate joined
   * rows); read values with `record.queryData(aliasName)`.
   *
   * See also `src/database/query/query-data.js`.
   *
   * @param {import("./query-data.js").QueryDataSpec} spec - Spec in shorthand or nested form.
   * @returns {this} - This query, for chaining.
   */
  queryData(spec) {
    for (const entry of normalizeQueryDataSpec(spec)) {
      this._queryData.push(entry)
    }

    return this
  }

  /**
   * Return the table reference (alias or table name) registered for the
   * given relationship chain, relative to the query's current join base
   * path. Convenience wrapper around `getTableReferenceForJoin` for use
   * inside `queryData` callbacks where the writer's intent reads more
   * naturally as "give me the table name for 'tasks'".
   *
   * @param {...string} path - Relationship path segments.
   * @returns {string} - Unquoted table reference.
   */
  tableNameFor(...path) {
    return this.getTableReferenceForJoin(...path)
  }

  /** @returns {Promise<number>} - Resolves with the count.  */
  async count() {
    // Generate count SQL
    const primaryKey = `${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().primaryKey())}`
    const distinctPrefix = this._distinct ? "DISTINCT " : ""
    let sql = `COUNT(${distinctPrefix}${primaryKey})`

    if (this.driver.getType() == "pgsql") sql += "::int"

    sql += " AS count"


    // Clone query and execute count
    const countQuery = this.clone()

    countQuery._distinct = false
    countQuery._selects = []
    countQuery.select(sql)

    const results = /** @type {{count: number}[]} */ (await countQuery._executeQuery())

    // The query isn't grouped and a single result has been given
    if (results.length == 1) {
      return results[0].count
    }

    // The query may be grouped and a lot of different counts a given
    let countResult = 0

    for (const result of results) {
      if (!("count" in result)) {
        throw new Error("Invalid count result")
      }

      countResult += result.count
    }

    return countResult
  }

  /**
   * @param {import("./index.js").SelectArgumentType} select - Select.
   * @returns {this} - The select.
   */
  select(select) {
    if (Array.isArray(select)) {
      for (const selectEntry of select) {
        this.select(selectEntry)
      }

      return this
    }

    if (typeof select === "string") {
      const trimmedSelect = select.trim()

      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedSelect)) {
        const modelClass = this.getModelClass()
        const attributeMap = modelClass.getAttributeNameToColumnNameMap()
        const columnName = attributeMap[trimmedSelect] || trimmedSelect
        const tableReference = this.rootTableReference()
        const qualifiedColumn = `${this.driver.quoteTable(tableReference)}.${this.driver.quoteColumn(columnName)}`

        return super.select(qualifiedColumn)
      }
    }

    return super.select(select)
  }

  /**
   * @returns {string} - Root table reference for query select qualification.
   */
  rootTableReference() {
    const froms = this.getFroms()
    const lastFrom = froms[froms.length - 1]

    if (lastFrom && typeof /** @type {any} */ (lastFrom).tableName === "string") {
      return /** @type {any} */ (lastFrom).tableName
    }

    if (lastFrom && typeof /** @type {any} */ (lastFrom).plain === "string") {
      const parsedReference = parseFromPlainTableReference(/** @type {any} */ (lastFrom).plain)

      if (parsedReference) return parsedReference
    }

    return this.getTableReferenceForJoin()
  }

  /** @returns {MC} - The model class.  */
  getModelClass() {
    if (!this.modelClass) throw new Error("modelClass not set")

    return this.modelClass
  }

  /** @returns {string[]} - The join base path. */
  getJoinBasePath() {
    return this._joinBasePath
  }

  /** @returns {import("./join-tracker.js").default} - The join tracker. */
  getJoinTracker() {
    return this._joinTracker
  }

  /** @returns {boolean} - Whether to qualify base table. */
  getForceQualifyBaseTable() {
    return this._forceQualifyBaseTable
  }

  /**
   * @param {string[]} joinBasePath - Join base path.
   * @returns {this} - The query with updated base path.
   */
  setJoinBasePath(joinBasePath) {
    this._joinBasePath = joinBasePath
    return this
  }

  /**
   * @param {string[]} joinBasePath - Join base path.
   * @returns {VelociousDatabaseQueryModelClassQuery<MC>} - The scoped query.
   */
  withJoinPath(joinBasePath) {
    const scopedQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone())

    scopedQuery._joinBasePath = joinBasePath
    scopedQuery._joinTracker = this._joinTracker

    return scopedQuery
  }

  /**
   * @param {string[]} path - Join path.
   * @returns {string} - Table name for path.
   */
  _resolveTableNameForJoinPath(path) {
    return this._resolveModelClassForJoinPath(path).tableName()
  }

  /**
   * @param {string[]} path - Join path.
   * @returns {typeof import("../record/index.js").default} - Target model class.
   */
  _resolveModelClassForJoinPath(path) {
    let modelClass = this._joinTracker.getRootModelClass()

    for (const relationshipName of path) {
      const relationship = modelClass.getRelationshipByName(relationshipName)
      const targetModelClass = relationship.getTargetModelClass()

      if (!targetModelClass) {
        throw new Error(`No target model class for ${modelClass.name}#${relationshipName}`)
      }

      modelClass = targetModelClass
    }

    return modelClass
  }

  /**
   * @param {string[]} path - Join path.
   * @returns {{tableName: string, alias: string | undefined}} - The entry.
   */
  _registerJoinPath(path) {
    const tableName = this._resolveTableNameForJoinPath(path)

    return this._joinTracker.registerPath(path, tableName)
  }

  /**
   * @param {string[]} path - Join path.
   * @returns {string} - Unquoted table reference (alias or table name).
   */
  getJoinTableReference(path) {
    const entry = this._joinTracker.getEntry(path) || this._registerJoinPath(path)

    return entry.alias || entry.tableName
  }

  /**
   * @param {...string} path - Join path segments.
   * @returns {string} - Unquoted table reference (alias or table name).
   */
  getTableReferenceForJoin(...path) {
    const fullPath = this._joinBasePath.concat(path)

    return this.getJoinTableReference(fullPath)
  }

  /**
   * @param {...string} path - Join path segments.
   * @returns {string} - Quoted table name for join path.
   */
  getTableForJoin(...path) {
    return this.driver.quoteTable(this.getTableReferenceForJoin(...path))
  }

  /**
   * @param {import("../../utils/model-scope.js").ModelScopeDescriptor | string | string[]} pathOrScopeDescriptor - Scope descriptor or join path.
   * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} [maybeScopeDescriptor] - Scope descriptor when path is given.
   * @returns {this} - Scoped query.
   */
  scope(pathOrScopeDescriptor, maybeScopeDescriptor) {
    if (isModelScopeDescriptor(pathOrScopeDescriptor) && !maybeScopeDescriptor) {
      return this._applyRootScope(pathOrScopeDescriptor)
    }

    if (!maybeScopeDescriptor) {
      throw new Error("scope(path, descriptor) requires a scope descriptor")
    }

    return this._applyJoinPathScope({
      joinPath: normalizeScopePath(/** @type {string | string[]} */ (pathOrScopeDescriptor)),
      scopeDescriptor: maybeScopeDescriptor
    })
  }

  /**
   * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} scopeDescriptor - Scope descriptor.
   * @returns {this} - Scoped query.
   */
  _applyRootScope(scopeDescriptor) {
    if (!isModelScopeDescriptor(scopeDescriptor)) {
      throw new Error("scope() expects a descriptor returned by defineScope(...).scope(...)")
    }

    if (scopeDescriptor.modelClass !== this.getModelClass()) {
      throw new Error(`Cannot apply ${scopeDescriptor.modelClass.name} scope to ${this.getModelClass().name} query`)
    }

    const scopedQuery = /** @type {this | void} */ (scopeDescriptor.callback({
      driver: this.driver,
      modelClass: this.getModelClass(),
      query: this,
      table: this.rootTableReference()
    }, ...scopeDescriptor.scopeArgs))

    return scopedQuery || this
  }

  /**
   * @param {object} args - Join-path scope options.
   * @param {string[]} args.joinPath - Join path relative to the current query.
   * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} args.scopeDescriptor - Scope descriptor.
   * @returns {this} - Scoped query.
   */
  _applyJoinPathScope({joinPath, scopeDescriptor}) {
    if (!isModelScopeDescriptor(scopeDescriptor)) {
      throw new Error("scope() expects a descriptor returned by defineScope(...).scope(...)")
    }

    const fullJoinPath = this.getJoinBasePath().concat(joinPath)
    const targetModelClass = this._resolveModelClassForJoinPath(fullJoinPath)

    if (scopeDescriptor.modelClass !== targetModelClass) {
      throw new Error(`Cannot apply ${scopeDescriptor.modelClass.name} scope to join path ${fullJoinPath.join(".")} (${targetModelClass.name})`)
    }

    const scopedQuery = this.buildJoinScopeQuery(targetModelClass, fullJoinPath)
    const originalJoinCount = scopedQuery._joins.length
    const originalWhereCount = scopedQuery._wheres.length
    const appliedQuery = /** @type {typeof scopedQuery | void} */ (scopeDescriptor.callback({
      driver: scopedQuery.driver,
      modelClass: targetModelClass,
      path: [...fullJoinPath],
      query: scopedQuery,
      table: scopedQuery.getTableReferenceForJoin()
    }, ...scopeDescriptor.scopeArgs)) || scopedQuery

    if (appliedQuery.getFroms().length !== scopedQuery.getFroms().length ||
      appliedQuery.getGroups().length !== scopedQuery.getGroups().length ||
      appliedQuery.getSelects().length !== scopedQuery.getSelects().length ||
      appliedQuery._orders.length !== scopedQuery._orders.length ||
      appliedQuery._limit !== scopedQuery._limit ||
      appliedQuery._offset !== scopedQuery._offset ||
      appliedQuery._page !== scopedQuery._page ||
      appliedQuery._perPage !== scopedQuery._perPage ||
      appliedQuery._distinct !== scopedQuery._distinct ||
      Object.keys(appliedQuery._preload).length !== Object.keys(scopedQuery._preload).length) {
      throw new Error("Joined-path scopes may only add where(...) and joins(...) clauses")
    }

    if (appliedQuery._joins.length > originalJoinCount) {
      for (const join of appliedQuery._joins.slice(originalJoinCount)) {
        if (join instanceof JoinObject) {
          this._joins.push(new JoinObject(join.object, fullJoinPath))
        } else if (join instanceof JoinPlain) {
          this._joins.push(join)
        } else {
          this._joins.push(join)
        }
      }
    }

    if (appliedQuery._wheres.length > originalWhereCount) {
      this._wheres.push(...appliedQuery._wheres.slice(originalWhereCount))
    }

    return this
  }

  /**
   * @param {typeof import("../record/index.js").default} targetModelClass - Target model class.
   * @param {string[]} joinPath - Join path.
   * @returns {VelociousDatabaseQueryModelClassQuery<MC>} - The scoped join query.
   */
  buildJoinScopeQuery(targetModelClass, joinPath) {
    const scopedQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (targetModelClass._newQuery())

    scopedQuery._joinTracker = this._joinTracker
    scopedQuery._joinBasePath = joinPath
    scopedQuery._forceQualifyBaseTable = true

    return scopedQuery
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async destroyAll() {
    const records = await this.toArray()

    for (const record of records) {
      await record.destroy()
    }
  }

  /**
   * Executes a bulk UPDATE on all rows matching the query's WHERE
   * clause. Bypasses model lifecycle callbacks — use this for
   * efficient batch updates where per-row hooks aren't needed.
   * @param {Record<string, any>} data - camelCase attribute names → values.
   * @returns {Promise<void>} - Resolves when the update completes.
   */
  async updateAll(data) {
    const driver = this.driver
    const tableName = this.getModelClass().tableName()
    const entries = Object.entries(data)

    if (entries.length === 0) return

    const setCols = entries.map(([key, value]) => {
      const columnName = inflection.underscore(key)
      const quoted = value === null ? "NULL" : driver.quote(value)

      return `${driver.quoteColumn(columnName)} = ${quoted}`
    }).join(", ")

    const joinsSql = new JoinsParser({pretty: false, query: this}).toSql()
    const whereSql = new WhereParser({pretty: false, query: this}).toSql()
    let sql

    if (joinsSql.length > 0) {
      // Use a subquery for cross-driver compatibility (SQLite
      // doesn't support UPDATE ... JOIN).
      const pk = driver.quoteColumn(this.getModelClass().primaryKey())
      const qt = driver.quoteTable(tableName)

      sql = `UPDATE ${qt} SET ${setCols} WHERE ${pk} IN (SELECT ${qt}.${pk} FROM ${qt}${joinsSql}${whereSql})`
    } else {
      sql = `UPDATE ${driver.quoteTable(tableName)} SET ${setCols}${whereSql}`
    }

    await driver.query(sql)
  }

  /**
   * @param {number|string} recordId - Record id.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
   */
  async find(recordId) {
    /** @type {{[key: string]: number | string}} */
    const conditions = {}

    conditions[this.getModelClass().primaryKey()] = recordId

    const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone())

    newQuery.where(conditions)

    const record = (await newQuery.first())

    if (!record) {
      throw new RecordNotFoundError(`Couldn't find ${this.getModelClass().name} with '${this.getModelClass().primaryKey()}'=${recordId}`)
    }

    return record
  }

  /**
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
   */
  async findBy(conditions) {
    const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone())

    newQuery.where(conditions)

    return await newQuery.first()
  }

  /**
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @param {function(InstanceType<MC>) : void} [callback] - Callback function.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
   */
  async findOrCreateBy(conditions, callback) {
    const record = await this.findOrInitializeBy(conditions, callback)

    if (record.isNewRecord()) {
      await record.save()
    }

    return record
  }

  /**
   * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
   */
  async findByOrFail(conditions) {
    const record = await this.findBy(conditions)

    if (!record) {
      throw new Error("Record not found")
    }

    return record
  }

  /**
   * @param {Record<string, any>} conditions - Conditions.
   * @param {function(InstanceType<MC>) : void} [callback] - Callback function.
   * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
   */
  async findOrInitializeBy(conditions, callback) {
    const record = await this.findBy(conditions)

    if (record) return record

    const ModelClass = this.getModelClass()
    const newRecord = /** @type {InstanceType<MC>} */ (new ModelClass(conditions))

    if (callback) {
      callback(newRecord)
    }

    return newRecord
  }

  /** @returns {Promise<InstanceType<MC> | null>} - Resolves with the first.  */
  async first() {
    const newQuery = this.clone().limit(1).reorder(`${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().orderableColumn())}`)
    const results = await newQuery.toArray()

    return results[0] || null
  }

  /** @returns {Promise<InstanceType<MC> | null>} - Resolves with the last.  */
  async last() {
    const primaryKey = this.getModelClass().primaryKey()
    const tableName = this.getModelClass().tableName()
    const results = await this.clone().reorder(`${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(primaryKey)} DESC`).limit(1).toArray()

    return results[0] || null
  }

  /**
   * @param {import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} data - Data payload.
   * @returns {this} - The preload.
   */
  preload(data) {
    const normalizedPreload = normalizePreloadRecord(data)
    incorporate(this._preload, normalizedPreload)
    return this
  }

  /**
   * Loads query results into model instances.
   * @returns {Promise<Array<InstanceType<MC>>>} - Resolves with the array.
   */
  async load() {
    const models = []
    const results = await this.results()

    for (const result of results) {
      const ModelClass = this.getModelClass()
      const model = /** @type {InstanceType<MC>} */ (new ModelClass())

      model.loadExistingRecord(result)
      models.push(model)
    }

    // Share a single cohort reference across every sibling record so that
    // auto-preload can batch lazy relationship access later.
    for (const model of models) {
      model._loadCohort = models
    }

    if (Object.keys(this._preload).length > 0 && models.length > 0) {
      const preloader = new Preloader({
        modelClass: this.modelClass,
        models,
        preload: this._preload
      })

      await preloader.run()
    }

    if (this._withCount.length > 0 && models.length > 0) {
      await runWithCount({
        entries: this._withCount,
        modelClass: this.modelClass,
        models
      })
    }

    if (this._queryData.length > 0 && models.length > 0) {
      await runQueryData({
        entries: this._queryData,
        rootModelClass: this.modelClass,
        rootModels: models
      })
    }

    return models
  }

  /**
   * Converts query results to array of model instances
   * @returns {Promise<Array<InstanceType<MC>>>} - Resolves with the array.
   */
  async toArray() {
    return await this.load()
  }

  /**
   * Plucks one or more columns directly from the database without instantiating models.
   * @param {...string|string[]} columns - Column names.
   * @returns {Promise<any[]>} - Resolves with the pluck.
   */
  async pluck(...columns) {
    const flatColumns = columns.flat()

    if (flatColumns.length === 0) throw new Error("No columns given to pluck")

    const modelClass = this.getModelClass()
    const tableName = modelClass.tableName()
    const attributeMap = modelClass.getAttributeNameToColumnNameMap()
    const columnNames = flatColumns.map((column) => attributeMap[column] || column)

    const query = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone())

    query._preload = {}
    query._selects = []

    columnNames.forEach((columnName) => {
      const selectSql = `${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(columnName)}`

      query.select(selectSql)
    })

    const rows = await query._executeQuery()

    if (columnNames.length === 1) {
      const [columnName] = columnNames
      return rows.map((row) => /** @type {Record<string, any>} */ (row)[columnName])
    }

    return rows.map((row) => {
      const rowHash = /** @type {Record<string, any>} */ (row)

      return columnNames.map((columnName) => rowHash[columnName])
    })
  }

  /**
   * @param {import("./index.js").WhereArgumentType} where - Where.
   * @returns {this} This query instance
   */
  where(where) {
    if (typeof where == "string") {
      return super.where(where)
    }

    if (isPlainObject(where)) {
      const {resolvedHash, fallbackHash} = splitWhereHash({hash: where, modelClass: this.getModelClass()})
      const joinObject = buildJoinObjectFromWhereHash({hash: where, modelClass: this.getModelClass()})

      if (Object.keys(joinObject).length > 0) {
        this.joins(joinObject)
      }

      if (Object.keys(resolvedHash).length > 0) {
        const qualifyBaseTable = this.getForceQualifyBaseTable() || Object.keys(joinObject).length > 0
        this._wheres.push(new WhereModelClassHash({
          hash: resolvedHash,
          modelClass: this.getModelClass(),
          qualifyBaseTable,
          query: this
        }))
      }

      if (Object.keys(fallbackHash).length > 0) {
        super.where(fallbackHash)
      }

      return this
    }

    throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`)
  }

  /**
   * @param {Record<string, any>} params - Ransack-style params hash. Supports `s` key for sorting (e.g., `{s: "name asc"}`).
   * @returns {this} - Query with Ransack filters and sort applied.
   */
  ransack(params) {
    const {s, ...filterParams} = params
    const conditions = normalizeRansackParams(this.getModelClass(), filterParams)

    for (const condition of conditions) {
      applyRansackCondition({condition, query: this})
    }

    if (typeof s === "string" && s.trim().length > 0) {
      const sorts = parseRansackSort(this.getModelClass(), s)

      for (const sortDef of sorts) {
        this.order(`${sortDef.attribute} ${sortDef.direction}`)
      }
    }

    return this
  }

  /**
   * @param {import("./index.js").WhereArgumentType} where - Where.
   * @returns {this} This query instance
   */
  whereNot(where) {
    if (typeof where == "string") {
      return super.whereNot(where)
    }

    if (isPlainObject(where)) {
      const {resolvedHash, fallbackHash} = splitWhereHash({hash: where, modelClass: this.getModelClass()})
      const joinObject = buildJoinObjectFromWhereHash({hash: where, modelClass: this.getModelClass()})

      if (Object.keys(joinObject).length > 0) {
        this.joins(joinObject)
      }

      if (Object.keys(resolvedHash).length > 0) {
        const qualifyBaseTable = this.getForceQualifyBaseTable() || Object.keys(joinObject).length > 0
        this._wheres.push(new WhereNot(new WhereModelClassHash({
          hash: resolvedHash,
          modelClass: this.getModelClass(),
          qualifyBaseTable,
          query: this
        })))
      }

      if (Object.keys(fallbackHash).length > 0) {
        super.whereNot(fallbackHash)
      }

      return this
    }

    throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`)
  }
}

/**
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackCondition} args.condition - Normalized Ransack condition.
 * @param {import("./model-class-query.js").default<any>} args.query - Query instance.
 * @returns {void}
 */
function applyRansackCondition({condition, query}) {
  if (condition.predicate === "eq" || condition.predicate === "in") {
    query.where(buildNestedRansackHash({condition, value: condition.value}))
    return
  }

  if (condition.predicate === "not_eq" || condition.predicate === "not_in") {
    query.whereNot(buildNestedRansackHash({condition, value: condition.value}))
    return
  }

  if (condition.predicate === "null") {
    if (condition.value) {
      query.where(buildNestedRansackHash({condition, value: null}))
    } else {
      query.whereNot(buildNestedRansackHash({condition, value: null}))
    }

    return
  }

  query.where(buildNestedRansackTupleHash({
    condition,
    operator: ransackTupleOperator(condition.predicate),
    value: ransackTupleValue(condition)
  }))
}

/**
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackCondition} args.condition - Normalized Ransack condition.
 * @param {any} args.value - Final value.
 * @returns {Record<string, any>} - Nested hash suitable for query.where/query.whereNot.
 */
function buildNestedRansackHash({condition, value}) {
  /** @type {Record<string, any>} */
  let hash = {[condition.attributeName]: value}

  for (let index = condition.path.length - 1; index >= 0; index -= 1) {
    hash = {[condition.path[index]]: hash}
  }

  return hash
}

/**
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackCondition} args.condition - Normalized Ransack condition.
 * @param {"gt" | "gteq" | "lt" | "lteq" | "like"} args.operator - Tuple operator.
 * @param {any} args.value - Final value.
 * @returns {Record<string, any>} - Nested tuple hash suitable for query.where.
 */
function buildNestedRansackTupleHash({condition, operator, value}) {
  /** @type {Record<string, any>} */
  let hash = {
    [condition.attributeName]: [[condition.attributeName, operator, value]]
  }

  for (let index = condition.path.length - 1; index >= 0; index -= 1) {
    hash = {[condition.path[index]]: hash}
  }

  return hash
}

/**
 * @param {import("../../utils/ransack.js").RansackPredicate} predicate - Ransack predicate.
 * @returns {"gt" | "gteq" | "lt" | "lteq" | "like"} - Query tuple operator.
 */
function ransackTupleOperator(predicate) {
  if (predicate === "gt" || predicate === "gteq" || predicate === "lt" || predicate === "lteq") {
    return predicate
  }

  return "like"
}

/**
 * @param {import("../../utils/ransack.js").RansackCondition} condition - Ransack condition.
 * @returns {any} - Query tuple value.
 */
function ransackTupleValue(condition) {
  if (condition.predicate === "cont") return `%${condition.value}%`
  if (condition.predicate === "start") return `${condition.value}%`
  if (condition.predicate === "end") return `%${condition.value}`

  return condition.value
}

/**
 * @param {typeof import("../record/index.js").default} modelClass - Model class.
 * @param {string} relationshipName - Relationship name.
 * @returns {import("../record/relationships/base.js").default | undefined} - The relationship.
 */
function getRelationshipByName(modelClass, relationshipName) {
  return modelClass.getRelationshipsMap()[relationshipName]
}

/**
 * @param {typeof import("../record/index.js").default} modelClass - Model class.
 * @param {string} key - Attribute or column name.
 * @returns {string | undefined} - The resolved column name.
 */
function resolveColumnName(modelClass, key) {
  const attributeMap = modelClass.getAttributeNameToColumnNameMap()

  if (attributeMap[key]) return attributeMap[key]

  const columnMap = modelClass.getColumnNameToAttributeNameMap()
  const underscored = inflection.underscore(key)

  return columnMap[key] || columnMap[underscored] || undefined
}

/**
 * @param {object} args - Options.
 * @param {Record<string, any>} args.hash - Where hash.
 * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
 * @returns {{resolvedHash: Record<string, any>, fallbackHash: Record<string, any>}} - Split hashes.
 */
function splitWhereHash({hash, modelClass}) {
  /** @type {Record<string, any>} */
  const resolvedHash = {}
  /** @type {Record<string, any>} */
  const fallbackHash = {}

  for (const key in hash) {
    const value = hash[key]
    const isNested = isPlainObject(value)
    const relationship = getRelationshipByName(modelClass, key)

    if (isNested) {
      if (relationship) {
        const targetModelClass = relationship.getTargetModelClass()
        if (!targetModelClass) {
          fallbackHash[key] = value
          continue
        }
        const nestedResult = splitWhereHash({hash: value, modelClass: targetModelClass})
        const nestedResolvedKeys = Object.keys(nestedResult.resolvedHash)
        const nestedFallbackKeys = Object.keys(nestedResult.fallbackHash)

        if (nestedResolvedKeys.length > 0) {
          resolvedHash[key] = nestedResult.resolvedHash
        }

        if (nestedFallbackKeys.length > 0) {
          const tableName = targetModelClass.tableName()

          if (!fallbackHash[tableName]) fallbackHash[tableName] = {}
          Object.assign(fallbackHash[tableName], nestedResult.fallbackHash)
        }
      } else {
        fallbackHash[key] = value
      }
    } else if (relationship && hasRelationshipWhereOperatorTuples(value)) {
      resolvedHash[key] = normalizeRelationshipWhereOperatorTuples(value)
    } else {
      const columnName = resolveColumnName(modelClass, key)

      if (columnName) {
        resolvedHash[columnName] = value
      } else {
        fallbackHash[key] = value
      }
    }
  }

  return {resolvedHash, fallbackHash}
}

/**
 * @param {object} args - Options.
 * @param {Record<string, any>} args.hash - Where hash.
 * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
 * @returns {Record<string, any>} - Join object.
 */
function buildJoinObjectFromWhereHash({hash, modelClass}) {
  /** @type {Record<string, any>} */
  const joinObject = {}

  for (const key in hash) {
    const value = hash[key]
    const relationship = getRelationshipByName(modelClass, key)

    if (!relationship) continue

    if (isPlainObject(value)) {
      const targetModelClass = relationship.getTargetModelClass()
      if (!targetModelClass) continue
      const nestedJoinObject = buildJoinObjectFromWhereHash({hash: value, modelClass: targetModelClass})

      joinObject[key] = Object.keys(nestedJoinObject).length > 0 ? nestedJoinObject : true
      continue
    }

    if (hasRelationshipWhereOperatorTuples(value)) {
      joinObject[key] = true
    }
  }

  return joinObject
}

const relationshipWhereOperators = new Set(["eq", "notEq", "gt", "gteq", "lt", "lteq", "like", ">", ">=", "<", "<="])

/**
 * @param {string} operator - Raw relationship where operator.
 * @returns {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like"} - Normalized operator.
 */
function normalizeRelationshipWhereOperator(operator) {
  const operatorAliases = {
    "<": "lt",
    "<=": "lteq",
    ">": "gt",
    ">=": "gteq"
  }

  return /** @type {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like"} */ (
    operatorAliases[/** @type {"<" | "<=" | ">" | ">="} */ (operator)] || operator
  )
}

/**
 * @param {unknown} tupleValue - Candidate tuple.
 * @returns {boolean} - Whether this is a relationship where tuple.
 */
function isRelationshipWhereOperatorTuple(tupleValue) {
  if (!Array.isArray(tupleValue) || tupleValue.length < 3) {
    return false
  }

  return typeof tupleValue[0] === "string" &&
    typeof tupleValue[1] === "string" &&
    relationshipWhereOperators.has(tupleValue[1])
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", any]>} - Normalized tuples.
 */
function normalizeRelationshipWhereOperatorTuples(value) {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid relationship where tuple container type: ${typeof value}`)
  }

  /** @type {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", any]>} */
  const normalized = []
    /** @param {unknown} conditionValue - Candidate nested condition. */
    const addCondition = (conditionValue) => {
      if (isRelationshipWhereOperatorTuple(conditionValue)) {
        const tuple = /** @type {[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like" | ">" | ">=" | "<" | "<=", any, ...unknown[]]} */ (conditionValue)
        const normalizedOperator = normalizeRelationshipWhereOperator(tuple[1])

        normalized.push([
          tuple[0],
          normalizedOperator,
          tuple[2]
        ])

        if (tuple.length > 3) {
          for (let index = 3; index < tuple.length; index += 1) {
            addCondition(tuple[index])
          }
      }

      return
    }

    if (!Array.isArray(conditionValue)) {
      throw new Error("Relationship where conditions must be tuples")
    }

    /** @type {unknown[]} */ (conditionValue).forEach((nestedConditionValue) => {
      addCondition(nestedConditionValue)
    })
  }

  addCondition(value)

  if (normalized.length < 1) {
    throw new Error("Relationship where tuple container cannot be empty")
  }

  return normalized
}

/**
 * @param {unknown} value - Candidate relationship where value.
 * @returns {boolean} - Whether value can be normalized to relationship tuples.
 */
function hasRelationshipWhereOperatorTuples(value) {
  try {
    normalizeRelationshipWhereOperatorTuples(value)

    return true
  } catch {
    return false
  }
}
