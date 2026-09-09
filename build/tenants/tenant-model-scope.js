// @ts-check

import TenantHandle from "./tenant-handle.js"

/**
 * Model query/create scope bound to one immutable tenant handle.
 * @template {typeof import("../database/record/index.js").default} MC
 */
export default class TenantModelScope {
  /**
   * Runs constructor.
   * @param {object} args - Scope arguments.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {MC} args.modelClass - Model class to bind.
   * @param {object} args.tenant - Ordinary or null-prototype JSON-compatible tenant descriptor.
   */
  constructor({configuration, modelClass, tenant}) {
    this._handle = new TenantHandle({configuration, tenant})
    this._modelClass = modelClass
    this._databaseIdentifier = modelClass.getDatabaseIdentifier({tenant})

    Object.freeze(this)
  }

  /**
   * Runs a general model query/write callback on the captured physical tenant.
   * The query and every record/association it loads are owned by the operation
   * and must be used inside the callback.
   * @template T
   * @param {(query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>} callback - Bound model callback.
   * @returns {Promise<T>} - Callback result.
   */
  async databaseOperation(callback) {
    return await this._handle.databaseOperation({
      databaseIdentifier: this._databaseIdentifier,
      name: `usingTenant: ${this._modelClass.getModelName()}`
    }, async (operation) => {
      await operation.ensureModelInitialized(this._modelClass)

      return await callback(operation.forModel(this._modelClass), operation)
    })
  }

  /**
   * Runs a model callback in a transaction on the captured physical tenant.
   * @template T
   * @param {(query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>} callback - Transaction callback.
   * @returns {Promise<T>} - Callback result.
   */
  async transaction(callback) {
    return await this._handle.transaction({
      databaseIdentifier: this._databaseIdentifier,
      name: `usingTenant transaction: ${this._modelClass.getModelName()}`
    }, async (operation) => {
      await operation.ensureModelInitialized(this._modelClass)

      return await callback(operation.forModel(this._modelClass), operation)
    })
  }

  /**
   * Creates a record on the captured tenant.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [attributes] - Create attributes.
   * @returns {Promise<InstanceType<MC>>} - Created record.
   */
  async create(attributes = {}) {
    return await this.databaseOperation(async (query, operation) => {
      const record = await query.create(attributes)

      return record.releaseDatabaseOperation(operation)
    })
  }

  /**
   * Counts records on the captured tenant.
   * @returns {Promise<number>} - Count on the captured tenant.
   */
  async count() {
    return await this.databaseOperation(async (query) => await query.count())
  }

  /**
   * Finds a record by primary key on the captured tenant.
   * @param {string | number} recordId - Record identifier.
   * @returns {Promise<InstanceType<MC> | null>} - Found record.
   */
  async find(recordId) {
    return await this.databaseOperation(async (query, operation) => {
      const record = await query.find(recordId)

      return record ? record.releaseDatabaseOperation(operation) : null
    })
  }

  /**
   * Finds a record by conditions on the captured tenant.
   * @param {Record<string, string | number>} conditions - Finder conditions.
   * @returns {Promise<InstanceType<MC> | null>} - Found record.
   */
  async findBy(conditions) {
    return await this.databaseOperation(async (query, operation) => {
      const record = await query.findBy(conditions)

      return record ? record.releaseDatabaseOperation(operation) : null
    })
  }

  /**
   * Finds a record by conditions or raises on the captured tenant.
   * @param {Record<string, string | number>} conditions - Finder conditions.
   * @returns {Promise<InstanceType<MC>>} - Found record.
   */
  async findByOrFail(conditions) {
    return await this.databaseOperation(async (query, operation) => {
      const record = await query.findByOrFail(conditions)

      return record.releaseDatabaseOperation(operation)
    })
  }

  /**
   * Loads all records on the captured tenant.
   * @returns {Promise<InstanceType<MC>[]>} - All records on the captured tenant.
   */
  async toArray() {
    return await this.databaseOperation(async (query, operation) => {
      const records = await query.toArray()

      return records.map((record) => record.releaseDatabaseOperation(operation))
    })
  }
}
