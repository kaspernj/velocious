import Controller from "../../../../../src/controller.mjs"
import {digg} from "diggerize"
import Task from "../../models/task.mjs"

export default class TasksController extends Controller {
  index() {
    this.viewParams.numbers = [1, 2, 3, 4, 5]
    this.render()
  }

  async show() {
    const taskId = digg(params, "id")
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
