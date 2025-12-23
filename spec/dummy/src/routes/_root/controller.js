import Controller from "../../../../../src/controller.js"

export default class RootController extends Controller {
  async missingView() {
    await this.render()
  }

  async ping() {
    await this.render({
      json: {
        message: "Pong"
      }
    })
  }

  async params() {
    this.viewParams.response = {
      params: this.params(),
      getParams: this.getParams(),
      queryParameters: this.queryParameters()
    }

    await this.render()
  }
}
