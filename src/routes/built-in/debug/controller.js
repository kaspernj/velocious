import Controller from "../../../controller.js"

export default class BuiltInDebugController extends Controller {
  /** @returns {Promise<void>} - Resolves when the debug snapshot has been rendered. */
  async show() {
    this._response.setHeader("Content-Type", "application/json; charset=UTF-8")
    this._response.setBody(`${JSON.stringify(this.getConfiguration().getDebugSnapshot(), null, 2)}\n`)
  }
}
