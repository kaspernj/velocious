const {Controller} = require("../../index.cjs")
const {digg} = require("@kaspernj/object-digger")
const Task = require("../../models/task.cjs")

module.exports = class TasksController extends Controller {
  index() {
    this.templateParams.numbers = [1, 2, 3, 4, 5]
    this.render()
  }

  async show() {
    const taskId = digg(params, "id")
    const task = await Task.find(taskId)

    this.templateParams.task = task
    this.render()
  }
}
