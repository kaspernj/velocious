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
   * @param {boolean} [args.enforceCurrentTenantReuseKey] - Whether ambient tenant changes invalidate this legacy operation.
   * @param {import("../configuration-types.js").DatabaseConfigurationType} [args.databaseConfiguration] - Captured resolved physical database configuration.
   * @param {string} args.configurationReuseKey - Physical database configuration key captured at checkout.
   * @param {import("./drivers/base.js").default} args.connection - Pinned physical connection.
   * @param {string} args.databaseIdentifier - Singular database identifier.
   * @param {symbol} args.owner - Opaque pool lease owner.
   * @param {string} [args.schemaGeneration] - Tenant schema generation owning record metadata.
   * @param {object | undefined} args.tenant - Tenant descriptor captured by the owning handle.
   */
  constructor({configuration, databaseConfiguration, configurationReuseKey, connection, databaseIdentifier, enforceCurrentTenantReuseKey = true, owner, schemaGeneration, tenant}) {
    this._active = true
    this._configuration = configuration
    this._databaseConfiguration = databaseConfiguration || configuration.resolveDatabaseConfiguration(databaseIdentifier, tenant)
    this._configurationReuseKey = configurationReuseKey
    this._databaseIdentifier = databaseIdentifier
    this._enforceCurrentTenantReuseKey = enforceCurrentTenantReuseKey
    this._physicalConnection = connection
    this._schemaGeneration = schemaGeneration
    this._tenant = tenant
    /** @type {WeakMap<typeof import("./record/index.js").default, typeof import("./record/index.js").default>} */
    this._boundModelClasses = new WeakMap()
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

    return this.modelClass(ModelClass)._newQuery({
      driver: this.connection(),
      operation: this
    })
  }

  /**
   * Returns a model-class view whose schema metadata is bound to this physical
   * database generation. Construction still produces the application's original
   * model class, so lifecycle callbacks and model registries retain class identity.
   * @template {typeof import("./record/index.js").default} MC
   * @param {MC} ModelClass - Canonical model class.
   * @returns {MC} - Operation-bound model class.
   */
  modelClass(ModelClass) {
    if (!this._schemaGeneration) return ModelClass

    const canonicalModelClass = /** @type {MC} */ (ModelClass._recordMetadataModelClass || ModelClass)

    const existing = this._boundModelClasses.get(canonicalModelClass)

    if (existing) return /** @type {MC} */ (existing)

    const databaseIdentity = this.databaseIdentity()
    const metadataKey = `${databaseIdentity.length}:${databaseIdentity}:${this._schemaGeneration}`
    const metadataProperties = canonicalModelClass.recordMetadataPropertyNames()
    const boundModelClass = new Proxy(canonicalModelClass, {
      construct: (target, args, newTarget) => Reflect.construct(target, args, newTarget),
      get: (target, property, receiver) => {
        if (property === "_recordMetadataModelClass") return target
        if (property === "_recordMetadataBinder") return (/** @type {typeof import("./record/index.js").default} */ targetModelClass) => this.modelClass(targetModelClass)
        if (property === "_recordMetadataOperation") return this
        if (typeof property === "string" && metadataProperties.has(property)) return target.recordMetadataValue(metadataKey, property)

        return Reflect.get(target, property, receiver)
      },
      set: (target, property, value, receiver) => {
        if (typeof property === "string" && metadataProperties.has(property)) {
          target.setRecordMetadataValue(metadataKey, property, value)
          return true
        }

        return Reflect.set(target, property, value, receiver)
      }
    })

    this._boundModelClasses.set(canonicalModelClass, boundModelClass)

    return /** @type {MC} */ (boundModelClass)
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

    const modelDatabaseIdentifier = ModelClass.getDatabaseIdentifier({tenant: this._tenant})

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
   * Registers a guard owned by the current transaction/savepoint frame.
   * @param {(context: {operation: VelociousDatabaseOperation}) => void | Promise<void>} callback - Guard callback.
   * @returns {Promise<void>} - Resolves after registration.
   */
  async beforeCommit(callback) {
    this.assertActive()
    await this.connection().beforeCommit(() => callback({operation: this}))
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
    const connectionFacade = /** @type {ReturnType<typeof JSON.parse>} */ (this._connection)

    return connectionFacade
  }

  /**
   * Returns the tenant descriptor captured by the immutable handle.
   * @returns {Record<string, unknown> | undefined} - Captured tenant descriptor.
   */
  tenant() {
    return /** @type {Record<string, unknown> | undefined} */ (this._tenant)
  }

  /**
   * Returns the logical database identifier owned by this operation.
   * @returns {string} - Database identifier.
   */
  databaseIdentifier() {
    return this._databaseIdentifier
  }

  /**
   * Returns a stable physical-database identity suitable for operation-aware caches.
   * @returns {string} - Physical database identity.
   */
  databaseIdentity() {
    return `${this._databaseIdentifier}:${this._configurationReuseKey}`
  }

  /**
   * Initializes a model through this operation's captured connection.
   * @param {typeof import("./record/index.js").default} ModelClass - Model class.
   * @returns {Promise<void>} - Resolves when initialized.
   */
  async ensureModelInitialized(ModelClass) {
    this.assertActive()

    const boundModelClass = this.modelClass(ModelClass)

    if (boundModelClass.isInitialized()) this.assertModel(ModelClass)

    await boundModelClass.ensureInitialized({
      configuration: this._configuration,
      connection: this.connection()
    })
    this.assertModel(ModelClass)
  }

  /**
   * Raises when an operation handle has left its callback.
   * @returns {void}
   */
  assertActive() {
    if (!this._active) throw new Error("Database operation has completed")

    const pool = this
      ._configuration
      .getDatabasePool(this._databaseIdentifier)
    const capturedReuseKey = pool.getConfigurationReuseKey(this._databaseConfiguration)
    const connectionReuseKey = pool.getConnectionConfigurationReuseKey(this._physicalConnection)

    if (capturedReuseKey !== this._configurationReuseKey || connectionReuseKey !== this._configurationReuseKey) {
      throw new Error(`Database operation for ${JSON.stringify(this._databaseIdentifier)} belongs to a different physical database than its captured tenant handle`)
    }

    if (this._enforceCurrentTenantReuseKey && pool.getConfigurationReuseKey() !== this._configurationReuseKey) {
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
