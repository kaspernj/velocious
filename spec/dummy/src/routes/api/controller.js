import Controller from "../../../../../src/controller.js"

export default class ApiController extends Controller {
  version() {
    this.renderJsonArg({
      version: "2.1"
    })
  }

  async broadcastEvent() {
    const channel = this.getParams().channel
    const payload = this.getParams().payload

    this.getConfiguration().broadcastToChannel("test", {channel}, payload)
    await this.getConfiguration().awaitPendingBroadcasts()
    this.renderJsonArg({status: "published"})
  }

  metadata() {
    this.renderJsonArg({metadata: this.getRequest().metadata()})
  }
}
