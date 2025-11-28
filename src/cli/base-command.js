import restArgsError from "../utils/rest-args-error.js"

export default class VelociousCliBaseCommand {
  constructor({args = {}, environmentHandler, ...restArgs}) {
    restArgsError(restArgs)

    this.args = args
    this._configuration = args.configuration
    this._environmentHandler = environmentHandler
    this.processArgs = args.processArgs
  }

  directory() { return this.getConfiguration().getDirectory() }
  getConfiguration() { return this._configuration }
  getEnvironmentHandler() { return this._environmentHandler }
}
