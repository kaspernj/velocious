import {digg} from "diggerize"

export default class VelociousCliBaseCommand {
  constructor(args) {
    this.args = args
    this.configuration = digg(this.args, "configuration")
    this.processArgs = args.processArgs
  }
}
