import Dummy from "../../../dummy/index.js"
import Comment from "../../../dummy/src/models/comment.js"
import Project from "../../../dummy/src/models/project.js"
import ProjectDetail from "../../../dummy/src/models/project-detail.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - instance relationships - scoped relationships", () => {
  it("applies scope callbacks for hasMany", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Scoped Project"})
      const doneTask = await Task.create({name: "Done", isDone: true, project})
      await Task.create({name: "Todo", isDone: false, project})

      const foundProject = await Project.find(project.id())
      await foundProject.loadDoneTasks()

      const doneTaskIds = foundProject.doneTasksLoaded().map((task) => task.id())

      expect(doneTaskIds).toEqual([doneTask.id()])
    })
  })

  it("applies scope callbacks for hasOne", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Active Project"})
      const activeDetail = await ProjectDetail.create({note: "Active", isActive: true, project})
      const inactiveProject = await Project.create({name: "Inactive Project"})
      await ProjectDetail.create({note: "Inactive", isActive: false, project: inactiveProject})

      const activeProject = await Project.find(project.id())
      await activeProject.loadActiveProjectDetail()
      expect(activeProject.activeProjectDetail().id()).toBe(activeDetail.id())

      const inactiveProjectFound = await Project.find(inactiveProject.id())
      await inactiveProjectFound.loadActiveProjectDetail()
      expect(inactiveProjectFound.activeProjectDetail()).toBe(undefined)
    })
  })

  it("applies scope callbacks for belongsTo", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Project"})
      const doneTask = await Task.create({name: "Done", isDone: true, project})
      const undoneTask = await Task.create({name: "Not done", isDone: false, project})
      const doneComment = await Comment.create({body: "done", task: doneTask})
      const undoneComment = await Comment.create({body: "undone", task: undoneTask})

      const foundDoneComment = await Comment.find(doneComment.id())
      await foundDoneComment.loadDoneTask()
      expect(foundDoneComment.doneTask().id()).toBe(doneTask.id())

      const foundUndoneComment = await Comment.find(undoneComment.id())
      await foundUndoneComment.loadDoneTask()
      expect(foundUndoneComment.doneTask()).toBe(undefined)
    })
  })
})
