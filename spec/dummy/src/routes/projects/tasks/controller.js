import {digg} from "diggerize"

import Controller from "../../../../../../src/controller.js"
import Project from "../../../models/project.js"

export default class ProjectsController extends Controller {
  async custom() {
    const projectID = digg(this.params(), "projectId")
    const taskID = digg(this.params(), "taskId")

    const project = await Project.preload({translations: true}).find(projectID)
    const task = await project.tasks().find(taskID)

    this.render({
      json: {
        project: {
          name: project.name()
        },
        task: {
          name: task.name()
        }
      }
    })
  }
}
