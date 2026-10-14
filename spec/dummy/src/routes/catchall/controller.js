// @ts-check

import Controller from "../../../../../src/controller.js"

export default class CatchallController extends Controller {
  async missing() {
    await this.render({
      json: {
        error: "not_found",
        path: this.getRequest().path()
      },
      status: 404
    })
  }
}
