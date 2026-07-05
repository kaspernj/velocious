// @ts-check

import {registerMagnitudeCounterCache} from "../../../src/database/record/counter-cache-magnitude.js"

/** The mock DB the parent counter UPDATEs are recorded against, set per test. */
let currentMockDb = /** @type {ReturnType<typeof createMockDb> | null} */ (null)

/** Mock parent model (the belongsTo target that holds the counter column). */
class MockParent {
  /** @returns {string} */
  static tableName() { return "docker_servers" }

  /** @returns {ReturnType<typeof createMockDb>} */
  static connection() { return /** @type {ReturnType<typeof createMockDb>} */ (currentMockDb) }
}

/** Mock belongsTo relationship pointing at {@link MockParent}. */
const mockRelationship = {
  getForeignKey: () => "docker_server_id",
  getPrimaryKey: () => "id",
  getTargetModelClass: () => MockParent
}

/** Creates a mock DB connection that records the UPDATE statements issued. */
function createMockDb() {
  /** @type {string[]} */
  const queries = []

  return {
    queries,
    /** @param {string} sql */
    query: async (sql) => { queries.push(sql.replace(/\s+/g, " ").trim()) },
    /** @param {string} table */
    quoteTable: (table) => `\`${table}\``,
    /** @param {string} column */
    quoteColumn: (column) => `\`${column}\``,
    /** @param {?} value */
    quote: (value) => `'${value}'`
  }
}

/**
 * Minimal mock record modelling Velocious's representation: `_attributes` holds
 * committed (old) column values, `_changes` holds pending (new) column values,
 * `changes()` derives `[old, new]`, and `readAttribute` reads change-over-committed
 * and casts declared boolean columns.
 */
class MockBuildBase {
  /** @type {Record<string, ?>} */
  _attributes = {}

  /** @type {Record<string, ?>} */
  _changes = {}

  /** @type {Array<{callback: Function, name: string}>} */
  static _registeredCallbacks = []

  /** @type {Set<string>} */
  static _booleanColumns = new Set()

  /** @returns {typeof MockBuildBase} */
  getModelClass() { return /** @type {typeof MockBuildBase} */ (this.constructor) }

  /** @returns {string} */
  static getModelName() { return "Build" }

  /** @param {string} attribute @returns {?} */
  readAttribute(attribute) {
    const column = this.getModelClass().getAttributeNameToColumnNameMap()[attribute] || attribute
    const raw = column in this._changes ? this._changes[column] : this._attributes[column]

    if (this.getModelClass()._booleanColumns.has(column)) {
      if (raw === 1) return true
      if (raw === 0) return false
    }

    return raw
  }

  /** @returns {Record<string, [?, ?]>} */
  changes() {
    /** @type {Record<string, [?, ?]>} */
    const result = {}

    for (const column in this._changes) {
      result[column] = [this._attributes[column], this._changes[column]]
    }

    return result
  }

  /** @returns {Record<string, string>} */
  static getAttributeNameToColumnNameMap() { return {active: "active", dockerServerId: "docker_server_id", status: "status"} }

  /** @returns {typeof mockRelationship} */
  static getRelationshipByName() { return mockRelationship }

  /** @param {Function} callback */
  static beforeSave(callback) { this._registeredCallbacks.push({callback, name: "beforeSave"}) }

  /** @param {Function} callback */
  static afterSave(callback) { this._registeredCallbacks.push({callback, name: "afterSave"}) }

  /** @param {Function} callback */
  static afterDestroy(callback) { this._registeredCallbacks.push({callback, name: "afterDestroy"}) }

  /** @param {string} name */
  async _runCallbacks(name) {
    for (const entry of this.getModelClass()._registeredCallbacks) {
      if (entry.name === name) await entry.callback(this)
    }
  }

  /** Simulates save(): beforeSave (changes visible) → commit (changes folded in) → afterSave. */
  async save() {
    await this._runCallbacks("beforeSave")
    this._attributes = {...this._attributes, ...this._changes, id: this._attributes.id || "mock-build-id"}
    this._changes = {}
    await this._runCallbacks("afterSave")
  }
}

/**
 * @param {typeof MockBuildBase} ModelClass
 * @param {{attributes: Record<string, ?>, changes?: Record<string, ?>}} args
 * @returns {MockBuildBase}
 */
function buildRecord(ModelClass, {attributes, changes = {}}) {
  const record = new ModelClass()

  record._attributes = {...attributes}
  record._changes = {...changes}

  return record
}

/**
 * @param {{booleanColumns?: string[], magnitude?: (value: ?) => number, sourceAttribute?: string}} [options]
 * @returns {typeof MockBuildBase}
 */
function registeredModelClass(options = {}) {
  class TestBuild extends MockBuildBase {}

  TestBuild._registeredCallbacks = []
  TestBuild._booleanColumns = new Set(options.booleanColumns || [])
  currentMockDb = createMockDb()

  registerMagnitudeCounterCache(/** @type {?} */ (TestBuild), {
    belongsTo: "dockerServer",
    counterColumn: "running_builds_count",
    magnitude: options.magnitude || ((status) => status === "running" ? 1 : 0),
    sourceAttribute: options.sourceAttribute || "status"
  })

  return TestBuild
}

describe("magnitudeCounterCache", {databaseCleaning: {transaction: true}}, () => {
  it("increments the parent counter by 1 when a build enters running", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {
      attributes: {docker_server_id: "srv1", id: "b1", status: "queued"},
      changes: {status: "running"}
    })

    await build.save()

    expect(currentMockDb?.queries).toEqual([
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + 1 WHERE `id` = 'srv1'"
    ])
  })

  it("decrements the parent counter by 1 when a build leaves running (any terminal state)", async () => {
    for (const terminalStatus of ["passed", "failed", "timed_out", "cancelled", "restarted", "crashed"]) {
      const TestBuild = registeredModelClass()
      const build = buildRecord(TestBuild, {
        attributes: {docker_server_id: "srv1", id: "b1", status: "running"},
        changes: {status: terminalStatus}
      })

      await build.save()

      expect(currentMockDb?.queries).toEqual([
        "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + -1 WHERE `id` = 'srv1'"
      ])
    }
  })

  it("does not touch the counter when the status did not change", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {
      attributes: {docker_server_id: "srv1", id: "b1", status: "running"},
      changes: {duration_label: "11s"}
    })

    await build.save()

    expect(currentMockDb?.queries).toEqual([])
  })

  it("moves the count between parents when the foreign key changes while running", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {
      attributes: {docker_server_id: "srv1", id: "b1", status: "running"},
      changes: {docker_server_id: "srv2"}
    })

    await build.save()

    expect(currentMockDb?.queries).toEqual([
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + -1 WHERE `id` = 'srv1'",
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + 1 WHERE `id` = 'srv2'"
    ])
  })

  it("decrements the parent counter when a running build is destroyed", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {attributes: {docker_server_id: "srv1", id: "b1", status: "running"}})

    await build._runCallbacks("afterDestroy")

    expect(currentMockDb?.queries).toEqual([
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + -1 WHERE `id` = 'srv1'"
    ])
  })

  it("normalizes the old source value through the read cast (declared boolean 1 -> true)", async () => {
    // magnitude keys off the CAST value; the old value must be cast the same way,
    // otherwise the raw stored `1` reads as `!== true` and the decrement is missed.
    const TestBuild = registeredModelClass({
      booleanColumns: ["active"],
      magnitude: (active) => active === true ? 1 : 0,
      sourceAttribute: "active"
    })
    const build = buildRecord(TestBuild, {
      attributes: {active: 1, docker_server_id: "srv1", id: "b1"},
      changes: {active: 0}
    })

    await build.save()

    expect(currentMockDb?.queries).toEqual([
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + -1 WHERE `id` = 'srv1'"
    ])
  })
})
