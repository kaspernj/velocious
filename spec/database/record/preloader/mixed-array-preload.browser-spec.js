import Comment from "../../../dummy/src/models/comment.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - preloader - mixed array preload", {tags: ["dummy"]}, () => {
  it("preloads with a mixed array of strings and nested objects", async () => {
    const project = await Project.create({})
    const task = await Task.create({projectId: project.id(), name: "Mixed preload task"})

    await Comment.create({taskId: task.id(), body: "mixed preload comment"})

    const foundTask = /** @type {Task} */ (await Task.preload(["project", {comments: true}]).find(task.id()))

    expect(foundTask.project().id()).toEqual(project.id())

    const comments = /** @type {Comment[]} */ (foundTask.getRelationshipByName("comments").loaded())

    expect(comments.length).toBe(1)
    expect(comments[0].body()).toEqual("mixed preload comment")
  })
})
