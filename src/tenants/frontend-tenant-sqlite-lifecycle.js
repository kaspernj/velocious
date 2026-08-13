// @ts-check

/** @typedef {"closed" | "closing" | "deleting" | "open" | "opening"} LifecycleState */
/**
 * @typedef {object} LifecycleEntry
 * @property {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
 * @property {string} databaseIdentifier - Logical database identifier.
 * @property {boolean} dirty - Whether delayed writes remain.
 * @property {number} lastUsed - Monotonic recency sequence.
 * @property {number} pinCount - Active scoped pins.
 * @property {Promise<void> | undefined} readinessPromise - In-progress schema readiness.
 * @property {boolean} ready - Whether migrations and model metadata are ready.
 * @property {string | undefined} schemaGeneration - Ready or in-progress schema generation.
 * @property {LifecycleState} state - Current lifecycle state.
 */

const DEFAULT_MAX_OPEN_HANDLES = 10

export default class FrontendTenantSqliteLifecycle {
  /**
   * Creates a lifecycle owner.
   * @param {{configuration: import("../configuration.js").default, maxOpenHandles?: number}} args - Lifecycle arguments.
   */
  constructor({configuration, maxOpenHandles = DEFAULT_MAX_OPEN_HANDLES}) {
    if (!Number.isSafeInteger(maxOpenHandles) || maxOpenHandles < 1) {
      throw new TypeError("frontendTenantSqlite.maxOpenHandles must be a positive safe integer")
    }

    this.configuration = configuration
    this.maxOpenHandles = maxOpenHandles
    /** @type {Map<string, LifecycleEntry>} */
    this.entries = new Map()
    this.sequence = 0
    this.queue = Promise.resolve()
  }

  key(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    return `${databaseIdentifier}:${this.configuration.getDatabasePool(databaseIdentifier).getConfigurationReuseKey(databaseConfiguration)}`
  }

  assertSqlite(/** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    if (databaseConfiguration.type !== "sqlite") throw new Error("Frontend tenant lifecycle only supports SQLite databases")
  }

  async serialize(/** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ callback) {
    const previous = this.queue
    let release = () => {}
    this.queue = new Promise((resolve) => { release = () => resolve(undefined) })
    await previous
    try {
      return await callback()
    } finally {
      release()
    }
  }

  entry(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    const key = this.key(databaseIdentifier, databaseConfiguration)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        databaseConfiguration,
        databaseIdentifier,
        dirty: false,
        lastUsed: 0,
        pinCount: 0,
        readinessPromise: undefined,
        ready: false,
        schemaGeneration: undefined,
        state: "closed"
      }
      this.entries.set(key, entry)
    }
    return entry
  }

  snapshot(/** @type {LifecycleEntry} */ entry) {
    return Object.freeze({
      databaseIdentifier: entry.databaseIdentifier,
      dirty: entry.dirty,
      lastUsed: entry.lastUsed,
      pinCount: entry.pinCount,
      ready: entry.ready,
      schemaGeneration: entry.schemaGeneration,
      state: entry.state
    })
  }

  async open(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    this.assertSqlite(databaseConfiguration)
    return await this.serialize(async () => {
      const entry = this.entry(databaseIdentifier, databaseConfiguration)
      if (entry.state === "open") {
        entry.lastUsed = ++this.sequence
        return this.snapshot(entry)
      }

      await this.evictFor(entry)
      entry.state = "opening"
      try {
        await this.configuration.getDatabasePool(databaseIdentifier).openCapturedConnection(databaseConfiguration)
        entry.state = "open"
        entry.lastUsed = ++this.sequence
        return this.snapshot(entry)
      } catch (error) {
        entry.state = "closed"
        throw error
      }
    })
  }

  /**
   * Opens and prepares one captured physical tenant database generation. The
   * readiness callback runs outside the lifecycle bookkeeping lock, so distinct
   * tenant databases can migrate concurrently while matching callers share one
   * promise.
   * @param {string} databaseIdentifier - Logical database identifier.
   * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
   * @param {string} schemaGeneration - Application schema generation.
   * @param {() => Promise<void>} callback - Migration and metadata initialization.
   * @returns {Promise<Readonly<ReturnType<FrontendTenantSqliteLifecycle["snapshot"]>>>} - Ready lifecycle snapshot.
   */
  async initialize(databaseIdentifier, databaseConfiguration, schemaGeneration, callback) {
    this.assertSqlite(databaseConfiguration)
    if (!databaseConfiguration.tenantOnly) throw new Error("Frontend tenant database initialization requires a tenant-only SQLite database")
    if (typeof schemaGeneration !== "string" || schemaGeneration.length === 0) {
      throw new TypeError("Frontend tenant database initialization requires a non-empty schemaGeneration")
    }

    const readiness = await this.serialize(async () => {
      const entry = this.entry(databaseIdentifier, databaseConfiguration)

      if (entry.readinessPromise) {
        if (entry.schemaGeneration !== schemaGeneration) {
          throw new Error(`Frontend tenant database is already initializing schema generation ${JSON.stringify(entry.schemaGeneration)}; cannot initialize mismatched generation ${JSON.stringify(schemaGeneration)}`)
        }

        return {entry, promise: entry.readinessPromise}
      }
      if (entry.ready && entry.schemaGeneration === schemaGeneration) {
        return {entry, promise: Promise.resolve()}
      }
      if (entry.schemaGeneration && entry.schemaGeneration !== schemaGeneration && (entry.pinCount > 0 || this.configuration.getDatabasePool(databaseIdentifier).capturedConnectionInUse(databaseConfiguration))) {
        throw new Error(`Cannot replace frontend tenant schema generation ${JSON.stringify(entry.schemaGeneration)} while its physical database is in use`)
      }
      if (entry.state !== "open") await this.openUnlocked(entry)
      if (entry.schemaGeneration && entry.schemaGeneration !== schemaGeneration) {
        this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration))
      }

      entry.ready = false
      entry.schemaGeneration = schemaGeneration
      entry.pinCount++
      const promise = Promise.resolve().then(callback)

      entry.readinessPromise = promise

      return {entry, promise}
    })

    try {
      await readiness.promise
      await this.serialize(async () => {
        if (readiness.entry.readinessPromise === readiness.promise) {
          readiness.entry.readinessPromise = undefined
          readiness.entry.ready = true
          readiness.entry.pinCount--
        }
      })
    } catch (error) {
      await this.serialize(async () => {
        if (readiness.entry.readinessPromise === readiness.promise) {
          readiness.entry.readinessPromise = undefined
          readiness.entry.ready = false
          readiness.entry.pinCount--
        }
      })
      throw error
    }

    return this.snapshot(readiness.entry)
  }

  async flush(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    this.assertSqlite(databaseConfiguration)
    return await this.serialize(async () => {
      const entry = this.entry(databaseIdentifier, databaseConfiguration)
      if (entry.state !== "open") await this.openUnlocked(entry)
      await this.configuration.getDatabasePool(databaseIdentifier).flushCapturedConnection(databaseConfiguration)
      entry.dirty = false
      entry.lastUsed = ++this.sequence
      return this.snapshot(entry)
    })
  }

  async close(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration, {flush = false} = {}) {
    this.assertSqlite(databaseConfiguration)
    return await this.serialize(async () => {
      const entry = this.entry(databaseIdentifier, databaseConfiguration)
      if (entry.state === "closed") return this.snapshot(entry)
      await this.assertClosable(entry)
      if (entry.dirty && !flush) throw new Error("Cannot close a dirty frontend tenant SQLite handle without flush: true")
      entry.state = "closing"
      try {
        if (flush) await this.configuration.getDatabasePool(databaseIdentifier).flushCapturedConnection(databaseConfiguration)
        await this.configuration.getDatabasePool(databaseIdentifier).closeCapturedConnection(databaseConfiguration)
        this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration))
        entry.dirty = false
        entry.ready = false
        entry.schemaGeneration = undefined
        entry.state = "closed"
        this.entries.delete(this.key(databaseIdentifier, databaseConfiguration))
        return this.snapshot(entry)
      } catch (error) {
        entry.state = "open"
        throw error
      }
    })
  }

  async delete(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    this.assertSqlite(databaseConfiguration)
    return await this.serialize(async () => {
      const entry = this.entry(databaseIdentifier, databaseConfiguration)
      await this.assertClosable(entry)
      entry.state = "deleting"
      try {
        await this.configuration.getDatabasePool(databaseIdentifier).deleteCapturedDatabase(databaseConfiguration)
        this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration))
        entry.dirty = false
        entry.ready = false
        entry.schemaGeneration = undefined
        entry.state = "closed"
        this.entries.delete(this.key(databaseIdentifier, databaseConfiguration))
        return this.snapshot(entry)
      } catch (error) {
        this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration))
        entry.ready = false
        entry.state = "closed"
        throw error
      }
    })
  }

  inspect(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    this.assertSqlite(databaseConfiguration)
    const entry = this.entries.get(this.key(databaseIdentifier, databaseConfiguration))
    return entry ? this.snapshot(entry) : Object.freeze({databaseIdentifier, dirty: false, lastUsed: 0, pinCount: 0, ready: false, schemaGeneration: undefined, state: "closed"})
  }

  inspectAll() {
    const handles = [...this.entries.values()].map((entry) => this.snapshot(entry))
    return Object.freeze({handles: Object.freeze(handles), maxOpenHandles: this.maxOpenHandles, openCount: handles.filter(({state}) => state === "open").length})
  }

  reset() {
    for (const entry of this.entries.values()) {
      this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(entry.databaseIdentifier, entry.databaseConfiguration))
    }

    this.entries.clear()
  }

  async withPin(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration, /** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ callback) {
    this.assertSqlite(databaseConfiguration)
    const entry = await this.serialize(async () => {
      const pinnedEntry = this.entry(databaseIdentifier, databaseConfiguration)
      if (pinnedEntry.state !== "open") await this.openUnlocked(pinnedEntry)
      pinnedEntry.pinCount++
      pinnedEntry.lastUsed = ++this.sequence
      return pinnedEntry
    })
    try {
      return await callback()
    } finally {
      await this.serialize(async () => { entry.pinCount-- })
    }
  }

  /**
   * Atomically validates readiness, captures the schema generation, and pins
   * one lifecycle entry before starting database work.
   * @param {string} databaseIdentifier - Logical database identifier.
   * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
   * @param {{requireReady: boolean, schemaGeneration?: string}} options - Operation readiness requirements.
   * @param {(schemaGeneration: string | undefined) => Promise<ReturnType<typeof JSON.parse>>} callback - Pinned operation callback.
   * @returns {Promise<ReturnType<typeof JSON.parse>>} - Operation result.
   */
  async databaseOperation(databaseIdentifier, databaseConfiguration, {requireReady, schemaGeneration}, callback) {
    if (databaseConfiguration.type !== "sqlite") return await callback(schemaGeneration)

    const entry = await this.serialize(async () => {
      const operationEntry = this.entries.get(this.key(databaseIdentifier, databaseConfiguration))

      if (requireReady && databaseConfiguration.tenantOnly && databaseConfiguration.migrations && !operationEntry?.ready) {
        const generation = operationEntry?.schemaGeneration ? ` for schema generation ${JSON.stringify(operationEntry.schemaGeneration)}` : ""

        throw new Error(`Frontend tenant database ${JSON.stringify(databaseIdentifier)} is not ready${generation}`)
      }
      if (!operationEntry) return undefined
      if (schemaGeneration && operationEntry.schemaGeneration && schemaGeneration !== operationEntry.schemaGeneration) {
        throw new Error(`Frontend tenant database ${JSON.stringify(databaseIdentifier)} is on schema generation ${JSON.stringify(operationEntry.schemaGeneration)}, not ${JSON.stringify(schemaGeneration)}`)
      }
      if (operationEntry.state !== "open") await this.openUnlocked(operationEntry)

      operationEntry.pinCount++
      operationEntry.lastUsed = ++this.sequence

      return operationEntry
    })
    const operationSchemaGeneration = schemaGeneration || entry?.schemaGeneration

    if (!entry) return await callback(operationSchemaGeneration)

    try {
      return await callback(operationSchemaGeneration)
    } finally {
      const dirty = this.configuration.getDatabasePool(databaseIdentifier).capturedConnectionHasPendingWrites(databaseConfiguration)

      await this.serialize(async () => {
        entry.dirty ||= dirty
        entry.lastUsed = ++this.sequence
        entry.pinCount--
      })
    }
  }

  async openUnlocked(/** @type {LifecycleEntry} */ entry) {
    await this.evictFor(entry)
    entry.state = "opening"
    try {
      await this.configuration.getDatabasePool(entry.databaseIdentifier).openCapturedConnection(entry.databaseConfiguration)
      entry.state = "open"
      entry.lastUsed = ++this.sequence
    } catch (error) {
      entry.state = "closed"
      throw error
    }
  }

  async assertClosable(/** @type {LifecycleEntry} */ entry) {
    if (entry.pinCount > 0) throw new Error("Cannot close a pinned frontend tenant SQLite handle")
    if (this.configuration.getDatabasePool(entry.databaseIdentifier).capturedConnectionInUse(entry.databaseConfiguration)) {
      throw new Error("Cannot close an in-use frontend tenant SQLite handle")
    }
  }

  async evictFor(/** @type {LifecycleEntry} */ openingEntry) {
    const openEntries = [...this.entries.values()].filter((entry) => entry !== openingEntry && entry.state === "open")
    if (openEntries.length < this.maxOpenHandles) return
    const candidates = openEntries
      .filter((entry) => !entry.dirty && entry.pinCount === 0 && !this.configuration.getDatabasePool(entry.databaseIdentifier).capturedConnectionInUse(entry.databaseConfiguration))
      .sort((left, right) => left.lastUsed - right.lastUsed)
    const victim = candidates[0]
    if (!victim) throw new Error(`Frontend tenant SQLite handle capacity ${this.maxOpenHandles} reached; every handle is dirty, pinned, or in use`)
    await this.configuration.getDatabasePool(victim.databaseIdentifier).closeCapturedConnection(victim.databaseConfiguration)
    this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(victim.databaseIdentifier, victim.databaseConfiguration))
    victim.ready = false
    victim.schemaGeneration = undefined
    victim.state = "closed"
    this.entries.delete(this.key(victim.databaseIdentifier, victim.databaseConfiguration))
  }
}
