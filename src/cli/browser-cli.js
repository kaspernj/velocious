import Cli from "./index.js"
import restArgsError from "../utils/rest-args-error.js"

export default class VelociousBrowserCli {
  /**
   * @param {object} args
   * @param {import("../configuration.js").default} args.configuration
   */
  constructor({configuration, ...restArgs}) {
    restArgsError(restArgs)

    this.configuration = configuration
  }

  /**
   * @description Enable the CLI in the global scope. This is useful for debugging and testing.
   * @returns {void}
   */
  enable() {
    globalThis.velociousCLI = this
  }

  /**
   * @description Run a command. This is useful for debugging and testing. This is a wrapper around the Cli class.
   * @param {string} command
   * @returns {Promise<void>}
   */
  async run(command) {
    const processArgs = command.split(/\s+/)
    const cli = new Cli({
      configuration: this.configuration,
      processArgs
    })

    await cli.execute()
  }
}
