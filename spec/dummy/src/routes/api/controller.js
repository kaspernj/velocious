import Controller from "../../../../../src/controller.js"

export default class ApiController extends Controller {
  version() {
    this.renderJsonArg({
      version: "2.1"
    })
  }
}
