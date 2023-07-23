export default class CliBaseCommand {
  constructor(givenArgs) {
    const {processArgs, ...args} = givenArgs

    this.args = args
    this.processArgs = processArgs
  }
}
