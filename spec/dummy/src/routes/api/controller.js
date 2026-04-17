import Controller from "../../../../../src/controller.js"

export default class ApiController extends Controller {
  version() {
    this.renderJsonArg({
      version: "2.1"
    })
  }

  broadcastEvent() {
    const channel = this.getParams().channel
    const payload = this.getParams().payload

    this.getConfiguration().broadcastToChannel("test", {channel}, payload)
    this.renderJsonArg({status: "published"})
  }
}
