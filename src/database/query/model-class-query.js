// @ts-check

import {incorporate} from "incorporator"
import * as inflection from "inflection"
import {Logger} from "../../logger.js"
import Preloader from "./preloader.js"
import DatabaseQuery from "./index.js"
import RecordNotFoundError from "../record/record-not-found-error.js"
import SelectBase from "./select-base.js"
import SelectPlain from "./select-plain.js"

/**
 * @typedef {{[key: string]: boolean | NestedPreloadRecord }} NestedPreloadRecord
 * @typedef {string | string[] | import("./select-base.js").default | import("./select-base.js").default[]} SelectArgumentType
 * @typedef {object | string} WhereArgumentType
 */
/**
 * @template {typeof import("../record/index.js").default} MC
 * @typedef {InstanceType<MC>} ModelOf
 */
/**
 * @template {typeof import("../record/index.js").default} MC
 * @typedef {import("./index.js").QueryArgsType & object} ModelClassQueryArgsType
 * @property {MC} modelClass
 */

/**
 * A generic query over some model type.
 * @template {typeof import("../record/index.js").default} MC
 */
export default class VelociousDatabaseQueryModelClassQuery extends DatabaseQuery {
  /**
   * @param {ModelClassQueryArgsType<MC>} args
   */
  constructor(args) {
    const {modelClass} = args

    if (!modelClass) throw new Error(`No modelClass given in ${Object.keys(args).join(", ")}`)

    super(args)
    this.logger = new Logger(this)
    this.modelClass = modelClass
  }

  /** @returns {this} */
  clone() {
    // @ts-expect-error
    const newQuery = /** @type {new (args: ModelClassQueryArgsType<MC>) => this} */ (new VelociousDatabaseQueryModelClassQuery({
      driver: this.driver,
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
      selects: [...this._selects],
      wheres: [...this._wheres]
    }))

    // @ts-expect-error
    return newQuery
  }

  /** @returns {Promise<number>} */
  async count() {
    // Generate count SQL
    let sql = `COUNT(${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().primaryKey())})`

    if (this.driver.getType() == "pgsql") sql += "::int"

    sql += " AS count"


    // Clone query and execute count
    const countQuery = this.clone()

    countQuery._selects = []
    countQuery.select(sql)

    const results = /** @type {{ count: number }[]} */ (await countQuery._executeQuery())


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
   * @param {function() : void} callback
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
   * @param {function(import("../record/index.js").default) : void} callback
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

  /**
   * @returns {Promise<InstanceType<MC>>}
   */
  async first() {
    const newQuery = this.clone().limit(1).reorder(`${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().orderableColumn())}`)
    const results = await newQuery.toArray()

    return results[0]
  }

  /**
   * @returns {Promise<InstanceType<MC>>}
   */
  async last() {
    const primaryKey = this.getModelClass().primaryKey()
    const tableName = this.getModelClass().tableName()
    const results = await this.clone().reorder(`${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(primaryKey)} DESC`).limit(1).toArray()

    return results[0]
  }

  /**
   * @param {NestedPreloadRecord} data
   * @returns {this}
   */
  preload(data) {
    incorporate(this._preload, data)
    return this
  }

  /**
   * @param {SelectArgumentType} select
   * @returns {this}
   */
  select(select) {
    if (Array.isArray(select)) {
      for (const selectInArray of select) {
        this.select(selectInArray)
      }

      return this
    }

    if (typeof select == "string") {
      this._selects.push(new SelectPlain(select))
    } else if (select instanceof SelectBase) {
      this._selects.push(select)
    } else {
      throw new Error(`Invalid select type: ${typeof select}`)
    }

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
}
