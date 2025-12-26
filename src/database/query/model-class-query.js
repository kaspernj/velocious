// @ts-check

import {incorporate} from "incorporator"
import * as inflection from "inflection"
import {Logger} from "../../logger.js"
import Preloader from "./preloader.js"
import DatabaseQuery from "./index.js"
import RecordNotFoundError from "../record/record-not-found-error.js"

/**
 * @template {typeof import("../record/index.js").default} MC
 */
/**
 * @template {typeof import("../record/index.js").default} MC
 * @typedef {import("./index.js").QueryArgsType & {modelClass: MC}} ModelClassQueryArgsType
 */

/**
 * A generic query over some model type.
 * @template {typeof import("../record/index.js").default} MC
 */
export default class VelociousDatabaseQueryModelClassQuery extends DatabaseQuery {
  /** @param {ModelClassQueryArgsType<MC>} args */
  constructor(args) {
    const {modelClass} = args

    if (!modelClass) throw new Error(`No modelClass given in ${Object.keys(args).join(", ")}`)

    super(args)
    this.logger = new Logger(this)

    /** @type {MC} */
    this.modelClass = modelClass
  }

  /** @returns {this} */
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
      wheres: [...this._wheres]
    }))

    // @ts-expect-error
    return newQuery
  }

  /** @returns {Promise<number>} */
  async count() {
    // Generate count SQL
    const primaryKey = `${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().primaryKey())}`
    const distinctPrefix = this._distinct ? "DISTINCT " : ""
    let sql = `COUNT(${distinctPrefix}${primaryKey})`

    if (this.driver.getType() == "pgsql") sql += "::int"

    sql += " AS count"


    // Clone query and execute count
    const countQuery = this.clone()

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

  /** @returns {MC} */
  getModelClass() {
    if (!this.modelClass) throw new Error("modelClass not set")

    return this.modelClass
  }

  /** @returns {Promise<void>} */
  async destroyAll() {
    const records = await this.toArray()

    for (const record of records) {
      await record.destroy()
    }
  }

  /**
   * @param {number|string} recordId
   * @returns {Promise<InstanceType<MC>>}
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
   * @param {{[key: string]: any}} conditions
   * @returns {Promise<InstanceType<MC> | null>}
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
   * @param {{[key: string]: any}} conditions
   * @param {function(InstanceType<MC>) : void} [callback]
   * @returns {Promise<InstanceType<MC>>}
   */
  async findOrCreateBy(conditions, callback) {
    const record = await this.findOrInitializeBy(conditions, callback)

    if (record.isNewRecord()) {
      await record.save()
    }

    return record
  }

  /**
   * @param {{[key: string]: any}} conditions
   * @returns {Promise<InstanceType<MC>>}
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
   * @param {object} conditions
   * @param {function(InstanceType<MC>) : void} [callback]
   * @returns {Promise<InstanceType<MC>>}
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

  /** @returns {Promise<InstanceType<MC> | undefined>} */
  async first() {
    const newQuery = this.clone().limit(1).reorder(`${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().orderableColumn())}`)
    const results = await newQuery.toArray()

    return results[0]
  }

  /** @returns {Promise<InstanceType<MC> | undefined>} */
  async last() {
    const primaryKey = this.getModelClass().primaryKey()
    const tableName = this.getModelClass().tableName()
    const results = await this.clone().reorder(`${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(primaryKey)} DESC`).limit(1).toArray()

    return results[0]
  }

  /**
   * @param {import("./index.js").NestedPreloadRecord} data
   * @returns {this}
   */
  preload(data) {
    incorporate(this._preload, data)
    return this
  }

  /**
   * Converts query results to array of model instances
   * @returns {Promise<Array<InstanceType<MC>>>}
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
   * @param {...string|string[]} columns
   * @returns {Promise<any[]>}
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
}
