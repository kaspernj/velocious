import Controller from "../../../../../src/controller.js"

export default class RootController extends Controller {
  ping() {
    this.render({
      json: {
        message: "Pong"
      }
    })
  }
}
