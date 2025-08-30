import {digg} from "diggerize"

import Controller from "../../../../../src/controller.js"
import Project from "../../models/project.js"

export default class ProjectsController extends Controller {
  index() {
    this.viewParams.numbers = [1, 2, 3, 4, 5]
    this.render()
  }

  async show() {
    const projectId = digg(params, "id")
    const project = await Project.find(projectId)

    this.viewParams.project = project
    this.render()
  }

  async create() {
    const project = new Project(this.params().project)

    await project.save()

    this.render({json: {status: "success"}})
  }
}
