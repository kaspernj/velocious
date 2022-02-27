module.exports = class VelociousDatabaseQueryInsert {
  constructor({tableName, data}) {
    this.data = data
    this.tableName = tableName
  }

  getOptions() {
    if (!this._options) throw new Error("Options hasn't been set")

    return this._options
  }

  setOptions(options) {
    this._options = options
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
