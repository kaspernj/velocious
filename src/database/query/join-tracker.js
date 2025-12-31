// @ts-check

export default class VelociousDatabaseQueryJoinTracker {
  /**
   * @param {object} args - Options object.
   * @param {typeof import("../record/index.js").default} args.modelClass - Root model class.
   */
  constructor({modelClass}) {
    if (!modelClass) throw new Error("No modelClass given to JoinTracker")

    this._rootModelClass = modelClass
    this._entries = new Map()
    this._tableUsage = new Map()

    this.registerPath([], modelClass.tableName())
  }

  /**
   * @returns {VelociousDatabaseQueryJoinTracker} - The clone.
   */
  clone() {
    const cloned = new VelociousDatabaseQueryJoinTracker({modelClass: this._rootModelClass})

    cloned._entries = new Map(this._entries)
    cloned._tableUsage = new Map(this._tableUsage)

    return cloned
  }

  /**
   * @returns {typeof import("../record/index.js").default} - Root model class.
   */
  getRootModelClass() {
    return this._rootModelClass
  }

  /**
   * @param {string[]} path - Join path.
   * @returns {string} - Path key.
   */
  pathKey(path) {
    return path.join(".")
  }

  /**
   * @param {string[]} path - Join path.
   * @returns {{tableName: string, alias: string | undefined} | undefined} - Entry.
   */
  getEntry(path) {
    return this._entries.get(this.pathKey(path))
  }

  /**
   * @param {string[]} path - Join path.
   * @param {string} tableName - Table name.
   * @returns {{tableName: string, alias: string | undefined}} - Entry.
   */
  registerPath(path, tableName) {
    const key = this.pathKey(path)
    const existing = this._entries.get(key)

    if (existing) return existing

    const usageCount = this._tableUsage.get(tableName) || 0
    const alias = usageCount > 0 ? this.buildAlias(tableName, path) : undefined

    this._tableUsage.set(tableName, usageCount + 1)

    const entry = {tableName, alias}

    this._entries.set(key, entry)

    return entry
  }

  /**
   * @param {string} tableName - Table name.
   * @param {string[]} path - Join path.
   * @returns {string} - Alias.
   */
  buildAlias(tableName, path) {
    if (path.length === 0) return tableName

    return `${tableName}__${path.join("__")}`
  }
}
