const {Controller} = require("../../index.cjs")

module.exports = class TasksController extends Controller {
  index() {
    this.templateParams["numbers"] = [1, 2, 3, 4, 5]
    this.render()
  }
}
