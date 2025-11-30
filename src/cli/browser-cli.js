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
   * @returns {void}
   */
  enable() {
    globalThis.velociousCLI = this
  }

  /**
   * @param {string} command
   * @returns {void}
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
