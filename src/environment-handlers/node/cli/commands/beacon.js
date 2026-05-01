import BaseCommand from "../../../../cli/base-command.js"
import BeaconServer from "../../../../beacon/server.js"

export default class BeaconCommand extends BaseCommand {
  async execute() {
    const beacon = new BeaconServer({configuration: this.getConfiguration()})
    await beacon.start()

    console.log(`Beacon listening on ${beacon.host}:${beacon.getPort()}`)

    await new Promise((resolve) => {
      const shutdown = async () => {
        await beacon.stop()
        resolve(undefined)
      }

      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    })
  }
}
