// @ts-check

import OperationConnection from "./operation-connection.js"

/**
 * Explicit owner for model work performed on one pinned transactional
 * connection.
 */
export default class VelociousDatabaseOperation {
  /**
   * Runs constructor.
   * @param {object} args - Operation ownership.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {string} args.configurationReuseKey - Physical database configuration key captured at checkout.
   * @param {import("./drivers/base.js").default} args.connection - Pinned physical connection.
   * @param {string} args.databaseIdentifier - Singular database identifier.
   * @param {symbol} args.owner - Opaque pool lease owner.
   */
  constructor({configuration, configurationReuseKey, connection, databaseIdentifier, owner}) {
    this._active = true
    this._configuration = configuration
    this._configurationReuseKey = configurationReuseKey
    this._databaseIdentifier = databaseIdentifier
    this._connection = new OperationConnection({
      connection,
      operation: this,
      owner
    })
  }

  /**
   * Returns an operation-bound model query/create scope.
   * @template {typeof import("./record/index.js").default} MC
   * @param {MC} ModelClass - Model class to bind.
   * @returns {import("./query/model-class-query.js").default<MC>} - Operation-bound scope.
   */
  forModel(ModelClass) {
    this.assertActive()
    this.assertModel(ModelClass)

    return ModelClass._newQuery({
      driver: this.connection(),
      operation: this
    })
  }

  /**
   * Verifies that a model belongs to this operation's configuration and database.
   * @param {typeof import("./record/index.js").default} ModelClass - Model class to verify.
   * @returns {void}
   */
  assertModel(ModelClass) {
    if (ModelClass._getConfiguration() !== this._configuration) {
      throw new Error(`${ModelClass.getModelName()} belongs to another Velocious configuration`)
    }

    const modelDatabaseIdentifier = ModelClass.getDatabaseIdentifier()

    if (modelDatabaseIdentifier !== this._databaseIdentifier) {
      throw new Error(`${ModelClass.getModelName()} uses database ${JSON.stringify(modelDatabaseIdentifier)}, not operation database ${JSON.stringify(this._databaseIdentifier)}`)
    }
  }

  /**
   * Binds a loaded or built record to this operation.
   * @template {import("./record/index.js").default} Model
   * @param {Model} record - Record to bind.
   * @returns {Model} - Bound record.
   */
  bindRecord(record) {
    this.assertActive()
    this.assertModel(record.getModelClass())
    record.bindDatabaseOperation(this)

    return record
  }

  /**
   * Registers a callback owned by the current operation transaction frame.
   * @param {() => void | Promise<void>} callback - Callback.
   * @returns {Promise<void>} - Resolves after registration or execution.
   */
  async afterCommit(callback) {
    this.assertActive()
    await this.connection().afterCommit(callback)
  }

  /**
   * Runs a nested operation transaction/savepoint.
   * @template T
   * @param {() => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async transaction(callback) {
    this.assertActive()

    return await this.connection().transaction(callback)
  }

  /**
   * Returns the deliberately exposed operation connection facade for raw SQL.
   * @returns {import("./drivers/base.js").default} - Operation-bound connection.
   */
  connection() {
    this.assertActive()

    /**
     * Narrows the Proxy facade to the complete driver surface that it forwards.
     * @type {import("./drivers/base.js").default}
     */
    const connectionFacade = /** @type {?} */ (this._connection)

    return connectionFacade
  }

  /**
   * Raises when an operation handle has left its callback.
   * @returns {void}
   */
  assertActive() {
    if (!this._active) throw new Error("Database operation has completed")

    const currentReuseKey = this
      ._configuration
      .getDatabasePool(this._databaseIdentifier)
      .getConfigurationReuseKey()

    if (currentReuseKey !== this._configurationReuseKey) {
      throw new Error(`Database operation for ${JSON.stringify(this._databaseIdentifier)} belongs to a different physical database than the current tenant context`)
    }
  }

  /**
   * Expires the operation and all scopes/records bound to it.
   * @returns {void}
   */
  complete() {
    this._active = false
  }
}
