// @ts-check

import Controller from "../../../../../src/controller.js"

export default class CatchallProbeController extends Controller {
  async ping() {
    await this.render({json: {message: "pong"}})
  }
}
