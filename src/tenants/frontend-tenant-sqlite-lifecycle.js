// @ts-check

/** @typedef {"closed" | "closing" | "deleting" | "open" | "opening"} LifecycleState */
/**
 * @typedef {object} LifecycleEntry
 * @property {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
 * @property {string} databaseIdentifier - Logical database identifier.
 * @property {boolean} dirty - Whether delayed writes remain.
 * @property {number} lastUsed - Monotonic recency sequence.
 * @property {number} pinCount - Active scoped pins.
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
      entry = {databaseConfiguration, databaseIdentifier, dirty: false, lastUsed: 0, pinCount: 0, state: "closed"}
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
        entry.dirty = false
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
        entry.dirty = false
        entry.state = "closed"
        this.entries.delete(this.key(databaseIdentifier, databaseConfiguration))
        return this.snapshot(entry)
      } catch (error) {
        entry.state = "closed"
        throw error
      }
    })
  }

  inspect(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    this.assertSqlite(databaseConfiguration)
    const entry = this.entries.get(this.key(databaseIdentifier, databaseConfiguration))
    return entry ? this.snapshot(entry) : Object.freeze({databaseIdentifier, dirty: false, lastUsed: 0, pinCount: 0, state: "closed"})
  }

  inspectAll() {
    const handles = [...this.entries.values()].map((entry) => this.snapshot(entry))
    return Object.freeze({handles: Object.freeze(handles), maxOpenHandles: this.maxOpenHandles, openCount: handles.filter(({state}) => state === "open").length})
  }

  reset() { this.entries.clear() }

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

  async databaseOperation(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration, /** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ callback) {
    if (!this.entries.has(this.key(databaseIdentifier, databaseConfiguration))) return await callback()

    return await this.withPin(databaseIdentifier, databaseConfiguration, async () => {
      try {
        return await callback()
      } finally {
        const dirty = this.configuration.getDatabasePool(databaseIdentifier).capturedConnectionHasPendingWrites(databaseConfiguration)
        await this.serialize(async () => {
          const entry = this.entry(databaseIdentifier, databaseConfiguration)
          entry.dirty ||= dirty
          entry.lastUsed = ++this.sequence
        })
      }
    })
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
    victim.state = "closed"
    this.entries.delete(this.key(victim.databaseIdentifier, victim.databaseConfiguration))
  }
}
