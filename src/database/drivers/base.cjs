module.exports = class VelociousDatabaseDriversBase {
  constructor(args) {
    this._args = args
  }

  getArgs() {
    return this._args
  }
}