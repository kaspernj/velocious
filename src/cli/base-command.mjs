import {digg} from "diggerize"

export default class VelociousCliBaseCommand {
  constructor(args) {
    this.args = args
    this.configuration = this.args.configuration
    this.processArgs = args.processArgs
  }

  directory = () => digg(this, "configuration", "directory")
}
