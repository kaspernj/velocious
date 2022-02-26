module.exports = class VelociousDatabaseRecord {
  static connection() {
    throw new Error("connection")
  }

  static find(recordId) {
    throw new Error("stub")
  }

  async save() {
    if (this.isPersisted()) {
      return await this._updateRecordWithChanges()
    } else {
      return await this._createNewRecord()
    }
  }

  constructor(recordData = {}) {
    this._recordData = recordData
  }

  async _createNewRecord() {
    let sql = `INSERT INTO ${this.constructor.connection().options().quoteTableName(this.constructor.getTableName())} (asd) VALUES ('asd')`

    await this.databaseDriver.execute(sql)
    await this.reload()
  }

  async _updateRecordWithChanges() {
    throw new Error("Update record not implemented")
  }

  id() {
    if (this._recordData["id"]) return true

    return false
  }

  isPersisted() {
    if (this.id()) return true

    return false
  }

  isNewRecord() {
    return !this.isPersisted()
  }
}
