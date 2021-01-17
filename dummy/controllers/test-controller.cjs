const VelociousBaseController = require("../../../src/base-controller")

module.exports = class TestController extends VelociousBaseController {
  show() {
    this.renderText("Hello world")
  }
}
