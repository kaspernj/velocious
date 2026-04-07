import Comment from "../../../dummy/src/models/comment.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - preloader - has many through", {tags: ["dummy"]}, () => {
  it("preloads through-relationship models", async () => {
    const project = await Project.create({})
    const task1 = await Task.create({projectId: project.id(), name: "Task A"})
    const task2 = await Task.create({projectId: project.id(), name: "Task B"})

    await Comment.create({taskId: task1.id(), body: "first"})
    await Comment.create({taskId: task2.id(), body: "second"})

    const foundProject = /** @type {Project} */ (await Project.preload({comments: true}).find(project.id()))
    const comments = /** @type {Comment[]} */ (foundProject.getRelationshipByName("comments").loaded())

    expect(comments.length).toBe(2)

    const bodies = comments.map((comment) => comment.body()).sort()

    expect(bodies).toEqual(["first", "second"])
  })

  it("preloads an empty array when no through-relationship models exist", async () => {
    const project = await Project.create({})

    await Task.create({projectId: project.id(), name: "Task without comments"})

    const foundProject = /** @type {Project} */ (await Project.preload({comments: true}).find(project.id()))
    const comments = /** @type {Comment[]} */ (foundProject.getRelationshipByName("comments").loaded())

    expect(comments.length).toBe(0)
  })

  it("preloads through-relationship correctly for multiple parents", async () => {
    const project1 = await Project.create({})
    const project2 = await Project.create({})
    const task1 = await Task.create({projectId: project1.id(), name: "P1 Task"})
    const task2 = await Task.create({projectId: project2.id(), name: "P2 Task"})

    await Comment.create({taskId: task1.id(), body: "comment for project 1"})
    await Comment.create({taskId: task2.id(), body: "comment for project 2"})

    const projects = await Project.preload({comments: true}).where({id: [project1.id(), project2.id()]}).toArray()

    const p1 = projects.find((p) => p.id() === project1.id())
    const p2 = projects.find((p) => p.id() === project2.id())

    const p1Comments = /** @type {Comment[]} */ (p1.getRelationshipByName("comments").loaded())
    const p2Comments = /** @type {Comment[]} */ (p2.getRelationshipByName("comments").loaded())

    expect(p1Comments.length).toBe(1)
    expect(p1Comments[0].body()).toEqual("comment for project 1")
    expect(p2Comments.length).toBe(1)
    expect(p2Comments[0].body()).toEqual("comment for project 2")
  })
})
