export default class VelociousInitializer {
  constructor({configuration, type}) {
    this._configuration = configuration
    this._type = type
  }

  getConfiguration() { return this._configuration }
  getType() { return this._type }

  run() {
    throw new Error(`'run' hasn't been implemented on ${this.constructor.name})`)
  }
}
