import Controller from "../../../../../src/controller.js"

export default class RootController extends Controller {
  async missingView() {
    await this.render()
  }

  ping() {
    this.render({
      json: {
        message: "Pong"
      }
    })
  }
}
