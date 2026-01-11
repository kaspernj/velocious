// @ts-check

import {incorporate} from "incorporator"
import * as inflection from "inflection"
import {isPlainObject} from "is-plain-object"
import {Logger} from "../../logger.js"
import Preloader from "./preloader.js"
import DatabaseQuery from "./index.js"
import JoinTracker from "./join-tracker.js"
import RecordNotFoundError from "../record/record-not-found-error.js"
import WhereModelClassHash from "./where-model-class-hash.js"
import WhereNot from "./where-not.js"

/**
 * @param {import("./index.js").NestedPreloadRecord | string | string[]} preload - Preload data in shorthand or nested form.
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
 * @template {typeof import("../record/index.js").default} MC
 */
/**
 * @template {typeof import("../record/index.js").default} MC
 * @typedef {import("./index.js").QueryArgsType & {modelClass: MC, joinBasePath?: string[], joinTracker?: import("./join-tracker.js").default, forceQualifyBaseTable?: boolean}} ModelClassQueryArgsType
 */

/**
 * A generic query over some model type.
 * @template {typeof import("../record/index.js").default} MC
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
      forceQualifyBaseTable: this._forceQualifyBaseTable
    }))

    // @ts-expect-error
    return newQuery
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
    let modelClass = this._joinTracker.getRootModelClass()

    if (path.length === 0) return modelClass.tableName()

    for (const relationshipName of path) {
      const relationship = modelClass.getRelationshipByName(relationshipName)
      const targetModelClass = relationship.getTargetModelClass()

      if (!targetModelClass) {
        throw new Error(`No target model class for ${modelClass.name}#${relationshipName}`)
      }

      modelClass = targetModelClass
    }

    return modelClass.tableName()
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
    /** @type {{[key: string]: number | string}} */
    const newConditions = {}

    for (const key in conditions) {
      const keyUnderscore = inflection.underscore(key)

      newConditions[keyUnderscore] = conditions[key]
    }

    const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone())

    newQuery.where(newConditions)

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
    /** @type {{[key: string]: number | string}} */
    const newConditions = {}

    for (const key in conditions) {
      const keyUnderscore = inflection.underscore(key)

      newConditions[keyUnderscore] = conditions[key]
    }

    const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone())

    newQuery.where(newConditions)

    const model = await newQuery.first()

    if (!model) {
      throw new Error("Record not found")
    }

    return model
  }

  /**
   * @param {object} conditions - Conditions.
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

  /** @returns {Promise<InstanceType<MC> | undefined>} - Resolves with the first.  */
  async first() {
    const newQuery = this.clone().limit(1).reorder(`${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().orderableColumn())}`)
    const results = await newQuery.toArray()

    return results[0]
  }

  /** @returns {Promise<InstanceType<MC> | undefined>} - Resolves with the last.  */
  async last() {
    const primaryKey = this.getModelClass().primaryKey()
    const tableName = this.getModelClass().tableName()
    const results = await this.clone().reorder(`${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(primaryKey)} DESC`).limit(1).toArray()

    return results[0]
  }

  /**
   * @param {import("./index.js").NestedPreloadRecord} data - Data payload.
   * @returns {this} - The preload.
   */
  preload(data) {
    const normalizedPreload = normalizePreloadRecord(data)
    incorporate(this._preload, normalizedPreload)
    return this
  }

  /**
   * Converts query results to array of model instances
   * @returns {Promise<Array<InstanceType<MC>>>} - Resolves with the array.
   */
  async toArray() {
    const models = []
    const results = await this.results()

    for (const result of results) {
      const ModelClass = this.getModelClass()
      const model = /** @type {InstanceType<MC>} */ (new ModelClass())

      model.loadExistingRecord(result)
      models.push(model)
    }

    if (Object.keys(this._preload).length > 0 && models.length > 0) {
      const preloader = new Preloader({
        modelClass: this.modelClass,
        models,
        preload: this._preload
      })

      await preloader.run()
    }

    return models
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
      return rows.map((row) => row[columnName])
    }

    return rows.map((row) => columnNames.map((columnName) => row[columnName]))
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
  const columnName = attributeMap[key]

  if (columnName) return columnName

  return undefined
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

    if (isNested) {
      const relationship = getRelationshipByName(modelClass, key)

      if (relationship) {
        const targetModelClass = relationship.getTargetModelClass()
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
    } else {
      const columnName = resolveColumnName(modelClass, key)

      if (columnName) {
        resolvedHash[key] = value
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

    if (!isPlainObject(value)) continue

    const relationship = getRelationshipByName(modelClass, key)

    if (!relationship) continue

    const targetModelClass = relationship.getTargetModelClass()
    const nestedJoinObject = buildJoinObjectFromWhereHash({hash: value, modelClass: targetModelClass})

    joinObject[key] = Object.keys(nestedJoinObject).length > 0 ? nestedJoinObject : true
  }

  return joinObject
}
