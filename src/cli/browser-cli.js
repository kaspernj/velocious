import BrowserEnvironmentHandler from "../environment-handlers/browser.js"
import Cli from "./index.js"

export default class VelociousBrowserCli {
  enable() {
    globalThis.velociousCLI = this
  }

  async run(command) {
    const processArgs = command.split(/\s+/)
    const cli = new Cli({
      environmentHandler: BrowserEnvironmentHandler,
      processArgs
    })

    await cli.execute()
  }
}
