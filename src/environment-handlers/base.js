export default class VelociousEnvironmentHandlerBase {
  /**
   * @interface
   */
  async findCommands() { throw new Error("findCommands not implemented") }

  /**
   * @interface
   */
  async findMigrations() { throw new Error("findMigrations not implemneted") }

  /**
   * @interface
   */
  async getVelociousPath() { throw new Error("getVelociousPath not implemented") }

  /**
   * @interface
   */
  async importApplicationRoutes() { throw new Error("importApplicationRoutes not implemented") }

  /**
   * @interface
   */
  async requireCommand({commandParts}) { throw new Error("requireCommand not implemented") } // eslint-disable-line no-unused-vars

  setArgs(newArgs) { this.args = newArgs }

  /**
   * @param {import("../configuration.js").default} newConfiguration
   * @returns {void}
   */
  setConfiguration(newConfiguration) { this.configuration = newConfiguration }

  /**
   * @returns {import("../configuration.js").default}
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    return this.configuration
  }

  setProcessArgs(newProcessArgs) { this.processArgs = newProcessArgs }
}
