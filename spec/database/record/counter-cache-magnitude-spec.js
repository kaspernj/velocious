// @ts-check

import {registerMagnitudeCounterCache} from "../../../src/database/record/counter-cache-magnitude.js"

/** Mock parent model (the belongsTo target that holds the counter column). */
class MockParent {
  /** @returns {string} */
  static tableName() { return "docker_servers" }
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
 * Minimal mock record class wired for the magnitude counter-cache: attribute-keyed
 * `_attributes`, column-keyed `_changes`, plus the relationship/connection metadata
 * the feature reads.
 */
class MockBuildBase {
  /** @type {Record<string, ?>} */
  _attributes = {}

  /** @type {Record<string, [?, ?]>} */
  _changes = {}

  /** @type {Array<{callback: Function, name: string}>} */
  static _registeredCallbacks = []

  /** @type {ReturnType<typeof createMockDb>} */
  static _mockDb

  /** @returns {typeof MockBuildBase} */
  getModelClass() { return /** @type {typeof MockBuildBase} */ (this.constructor) }

  /** @returns {string} */
  static getModelName() { return "Build" }

  /** @param {string} name @returns {?} */
  readAttribute(name) { return this._attributes[name] }

  /** @returns {Record<string, [?, ?]>} */
  changes() { return this._changes }

  /** @returns {Record<string, string>} */
  static getAttributeNameToColumnNameMap() { return {dockerServerId: "docker_server_id", status: "status"} }

  /** @returns {typeof mockRelationship} */
  static getRelationshipByName() { return mockRelationship }

  /** @returns {ReturnType<typeof createMockDb>} */
  static connection() { return this._mockDb }

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

  /** Simulates save(): beforeSave (changes visible) → clear changes (reload) → afterSave. */
  async save() {
    await this._runCallbacks("beforeSave")
    this._attributes.id = this._attributes.id || "mock-build-id"
    this._changes = {}
    await this._runCallbacks("afterSave")
  }
}

/**
 * @param {typeof MockBuildBase} ModelClass
 * @param {{attributes: Record<string, ?>, changes?: Record<string, [?, ?]>}} args
 * @returns {MockBuildBase}
 */
function buildRecord(ModelClass, {attributes, changes = {}}) {
  const record = new ModelClass()

  record._attributes = {...attributes}
  record._changes = {...changes}

  return record
}

/** @returns {typeof MockBuildBase} */
function registeredModelClass() {
  class TestBuild extends MockBuildBase {}

  TestBuild._registeredCallbacks = []
  TestBuild._mockDb = createMockDb()

  registerMagnitudeCounterCache(/** @type {?} */ (TestBuild), {
    belongsTo: "dockerServer",
    counterColumn: "running_builds_count",
    magnitude: (status) => status === "running" ? 1 : 0,
    sourceAttribute: "status"
  })

  return TestBuild
}

describe("magnitudeCounterCache", {databaseCleaning: {transaction: true}}, () => {
  it("increments the parent counter by 1 when a build enters running", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {
      attributes: {dockerServerId: "srv1", id: "b1", status: "running"},
      changes: {status: ["queued", "running"]}
    })

    await build.save()

    expect(TestBuild._mockDb.queries).toEqual([
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + 1 WHERE `id` = 'srv1'"
    ])
  })

  it("decrements the parent counter by 1 when a build leaves running (any terminal state)", async () => {
    for (const terminalStatus of ["passed", "failed", "timed_out", "cancelled", "restarted", "crashed"]) {
      const TestBuild = registeredModelClass()
      const build = buildRecord(TestBuild, {
        attributes: {dockerServerId: "srv1", id: "b1", status: terminalStatus},
        changes: {status: ["running", terminalStatus]}
      })

      await build.save()

      expect(TestBuild._mockDb.queries).toEqual([
        "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + -1 WHERE `id` = 'srv1'"
      ])
    }
  })

  it("does not touch the counter when the status did not change", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {
      attributes: {dockerServerId: "srv1", id: "b1", status: "running"},
      changes: {duration_label: ["10s", "11s"]}
    })

    await build.save()

    expect(TestBuild._mockDb.queries).toEqual([])
  })

  it("moves the count between parents when the foreign key changes while running", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {
      attributes: {dockerServerId: "srv2", id: "b1", status: "running"},
      changes: {docker_server_id: ["srv1", "srv2"]}
    })

    await build.save()

    expect(TestBuild._mockDb.queries).toEqual([
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + -1 WHERE `id` = 'srv1'",
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + 1 WHERE `id` = 'srv2'"
    ])
  })

  it("decrements the parent counter when a running build is destroyed", async () => {
    const TestBuild = registeredModelClass()
    const build = buildRecord(TestBuild, {attributes: {dockerServerId: "srv1", id: "b1", status: "running"}})

    await build._runCallbacks("afterDestroy")

    expect(TestBuild._mockDb.queries).toEqual([
      "UPDATE `docker_servers` SET `running_builds_count` = COALESCE(`running_builds_count`, 0) + -1 WHERE `id` = 'srv1'"
    ])
  })
})
