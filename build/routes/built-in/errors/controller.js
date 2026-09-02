import Controller from "../../../controller.js"

export default class BuiltInErrorsController extends Controller {
  async notFound() {
    this.render({status: "not-found"})
  }
}
