import Cli from "./index.js"
import commandsFinderBrowser from "./commands-finder-browser.js"

export default class VelociousBrowserCli {
  enable() {
    globalThis.velociousCLI = this
  }

  async run(command) {
    const commands = commandsFinderBrowser()
    const processArgs = command.split(/\s+/)
    const cli = new Cli({
      commands,
      processArgs
    })

    await cli.execute()
  }
}
