// @ts-check

import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import Comment from "../../dummy/src/models/comment.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("database - record - hasMany through", () => {
  it("loads comments through tasks", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async () => {
        const project = await Project.create({creatingUserReference: "creator-1"})
        const task1 = await Task.create({projectId: project.id(), name: "Task A"})
        const task2 = await Task.create({projectId: project.id(), name: "Task B"})

        await Comment.create({taskId: task1.id(), body: "first"})
        await Comment.create({taskId: task2.id(), body: "second"})

        await project.comments().load()

        const comments = project.commentsLoaded()

        expect(comments.length).toBe(2)
        expect(comments.map((comment) => comment.body())).toEqual(["first", "second"])
      })
    })
  })
})
