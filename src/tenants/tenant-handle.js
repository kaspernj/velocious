// @ts-check

/**
 * TenantDescriptorValue type.
 * @typedef {null | boolean | number | string | TenantDescriptorValue[] | {[key: string]: TenantDescriptorValue}} TenantDescriptorValue
 */
/** @typedef {{[key: string]: TenantDescriptorValue}} TenantDescriptor */

/**
 * Returns a readable path for a captured descriptor/configuration value.
 * @param {string} path - Parent path.
 * @param {string | number} key - Child key.
 * @returns {string} - Child path.
 */
function childPath(path, key) {
  if (typeof key === "number") return `${path}[${key}]`

  return path ? `${path}.${key}` : key
}

/**
 * Returns the runtime class label for an unsupported capture value.
 * @param {object} value - Unsupported value.
 * @returns {string} - Runtime class label.
 */
function valueClassName(value) {
  return value.constructor?.name || "object"
}

/**
 * Defines one captured key without invoking inherited setters such as
 * `Object.prototype.__proto__`.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} target - Captured object.
 * @param {string} key - Own key to define.
 * @param {ReturnType<typeof JSON.parse>} value - Captured value.
 */
function defineCapturedDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}

/**
 * Deeply copies and freezes a JSON-compatible tenant descriptor value.
 * @param {ReturnType<typeof JSON.parse>} value - Value to capture.
 * @param {string} path - Descriptor path.
 * @param {Set<object>} ancestors - Active ancestor objects used for cycle detection.
 * @returns {TenantDescriptorValue} - Immutable captured value.
 */
function captureTenantValue(value, path, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value

  if (!value || typeof value !== "object") {
    throw new TypeError(`Tenant descriptor contains an unsupported value at ${path}: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new TypeError(`Tenant descriptor contains a cycle at ${path}`)

  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      const capturedEntries = value.map((entry, index) => captureTenantValue(entry, childPath(path, index), ancestors))

      Object.freeze(capturedEntries)

      return capturedEntries
    }

    const prototype = Object.getPrototypeOf(value)

    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Tenant descriptor contains an unsupported value at ${path}: ${valueClassName(value)}`)
    }

    /** @type {TenantDescriptor} */
    const captured = {}

    for (const [key, entry] of Object.entries(value)) {
      defineCapturedDataProperty(captured, key, captureTenantValue(entry, childPath(path, key), ancestors))
    }

    return Object.freeze(captured)
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Captures a root application tenant descriptor.
 * @param {object} tenant - Ordinary or null-prototype JSON-compatible tenant descriptor.
 * @returns {TenantDescriptor} - Immutable descriptor snapshot.
 */
function captureTenant(tenant) {
  return /** @type {TenantDescriptor} */ (captureTenantValue(tenant, "", new Set()))
}

/**
 * Deeply captures configuration values while retaining function/class identities.
 * Mutable non-plain runtime objects are rejected because retaining them would let
 * callers redirect a handle after construction.
 * @param {ReturnType<typeof JSON.parse>} value - Configuration value.
 * @param {string} path - Configuration path.
 * @param {Set<object>} ancestors - Active ancestor objects.
 * @returns {ReturnType<typeof JSON.parse>} - Immutable captured value.
 */
function captureConfigurationValue(value, path, ancestors) {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean" || typeof value === "number" || typeof value === "function") {
    return value
  }
  if (typeof value !== "object") {
    throw new TypeError(`Tenant database configuration contains an unsupported value at ${path}: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new TypeError(`Tenant database configuration contains a cycle at ${path}`)

  const prototype = Object.getPrototypeOf(value)

  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    if (Object.isFrozen(value)) return value

    throw new TypeError(`Tenant database configuration contains an unsupported mutable value at ${path}: ${valueClassName(value)}`)
  }

  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry, index) => captureConfigurationValue(entry, childPath(path, index), ancestors)))
    }

    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const captured = {}

    for (const [key, entry] of Object.entries(value)) {
      defineCapturedDataProperty(captured, key, captureConfigurationValue(entry, childPath(path, key), ancestors))
    }

    return Object.freeze(captured)
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Copies and deeply freezes a resolved physical database configuration.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Resolved database configuration.
 * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured configuration.
 */
function captureDatabaseConfiguration(databaseConfiguration) {
  return /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ (
    captureConfigurationValue(databaseConfiguration, "databaseConfiguration", new Set())
  )
}

/**
 * Immutable tenant/database handle. Physical database configurations are
 * resolved and captured at construction, so later ambient tenant changes
 * cannot redirect work performed through this handle.
 */
export default class TenantHandle {
  /**
   * Runs constructor.
   * @param {object} args - Handle arguments.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {object} args.tenant - Ordinary or null-prototype JSON-compatible application tenant descriptor.
   */
  constructor({configuration, tenant}) {
    if (!configuration) throw new Error("TenantHandle requires a configuration")
    if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
      throw new TypeError("TenantHandle requires a tenant object")
    }

    const capturedTenant = captureTenant(tenant)
    /** @type {Record<string, import("../configuration-types.js").DatabaseConfigurationType>} */
    const databaseConfigurations = Object.create(null)
    const disabledIdentifiers = configuration.getDisabledDatabaseIdentifiers()

    for (const identifier of Object.keys(configuration.getDatabaseConfiguration())) {
      if (disabledIdentifiers.has(identifier)) continue
      if (!configuration.isDatabaseIdentifierActive(identifier, capturedTenant)) continue

      databaseConfigurations[identifier] = captureDatabaseConfiguration(
        configuration.resolveDatabaseConfiguration(identifier, capturedTenant)
      )
    }

    this._configuration = configuration
    this._databaseConfigurations = Object.freeze(databaseConfigurations)
    this._tenant = capturedTenant

    Object.freeze(this)
  }

  /**
   * Returns the captured tenant descriptor. Routing never re-resolves physical
   * identity from this value after handle construction.
   * @returns {TenantDescriptor} - Tenant descriptor.
   */
  tenant() {
    return this._tenant
  }

  /**
   * Returns the captured physical configuration for an active identifier.
   * @param {string} databaseIdentifier - Logical database identifier.
   * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured resolved configuration.
   */
  databaseConfiguration(databaseIdentifier) {
    const databaseConfiguration = this._databaseConfigurations[databaseIdentifier]

    if (!databaseConfiguration) {
      throw new Error(`Unknown or inactive database identifier for tenant handle: ${databaseIdentifier}`)
    }

    return databaseConfiguration
  }

  /**
   * Runs explicit ORM work on one pinned connection for this handle's captured
   * physical database. Use `operation.forModel(ModelClass)` for queries and
   * writes; loaded records and association/preload work retain that operation.
   * @template T
   * @param {{databaseIdentifier: string, name?: string}} options - Logical database and checkout name.
   * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Owned work callback.
   * @returns {Promise<T>} - Callback result.
   */
  async databaseOperation({databaseIdentifier, name = "TenantHandle.databaseOperation"}, callback) {
    return await this._configuration.withDatabaseOperation({
      databaseConfiguration: this.databaseConfiguration(databaseIdentifier),
      databaseIdentifier,
      name,
      tenant: this._tenant
    }, callback)
  }

  /**
   * Runs explicit ORM work in a transaction pinned to this handle's captured
   * physical database.
   * @template T
   * @param {{databaseIdentifier: string, name?: string}} options - Logical database and checkout name.
   * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Transaction callback.
   * @returns {Promise<T>} - Callback result.
   */
  async transaction({databaseIdentifier, name = "TenantHandle.transaction"}, callback) {
    return await this.databaseOperation({databaseIdentifier, name}, async (operation) => {
      return await operation.transaction(async () => await callback(operation))
    })
  }
}
