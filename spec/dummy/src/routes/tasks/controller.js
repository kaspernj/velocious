import Controller from "../../../../../src/controller.js"
import Task from "../../models/task.js"

export default class TasksController extends Controller {
  index() {
    this.viewParams.numbers = [1, 2, 3, 4, 5]
    this.render()
  }

  async show() {
    const taskId = this.params().id
    const task = await Task.find(taskId)

    this.viewParams.task = task
    this.render()
  }

  async create() {
    const task = new Task(this.params().task)

    await task.save()

    this.render({json: {status: "success"}})
  }
}
