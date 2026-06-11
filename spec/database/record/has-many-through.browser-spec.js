// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Comment from "../../dummy/src/models/comment.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import Configuration from "../../../src/configuration.js"
import {hasManyThroughTargetForeignKey} from "../../../src/database/query/preloader/has-many.js"

describe("database - record - hasMany through - target foreign key resolution", {tags: ["dummy"]}, () => {
  it("honors an explicit foreign key even when the target has another belongs-to to the through model", () => {
    // Comment has two belongs-to to Task (task, doneTask); the explicit key must win over the first match.
    const relationship = /** @type {any} */ ({getExplicitForeignKey: () => "done_task_id", getForeignKey: () => "task_id"})

    expect(hasManyThroughTargetForeignKey(relationship, Task, Comment)).toEqual("done_task_id")
  })

  it("falls back to the target's belongs-to foreign key when no explicit key is given", () => {
    const relationship = /** @type {any} */ ({getExplicitForeignKey: () => undefined, getForeignKey: () => "fallback_id"})

    expect(hasManyThroughTargetForeignKey(relationship, Task, Comment)).toEqual("task_id")
  })
})

describe("database - record - hasMany through", {tags: ["dummy"]}, () => {
  it("loads comments through tasks", async () => {
    await Configuration.current().ensureConnections(async () => {
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

  it("uses the target belongs-to foreign key for default through relationships", async () => {
    await Configuration.current().ensureConnections(async () => {
        const project = await Project.create({creatingUserReference: "creator-2"})
        const task = await Task.create({projectId: project.id(), name: "Task C"})

        await Comment.create({taskId: task.id(), body: "third"})
        await project.getRelationshipByName("commentsThroughTasks").load()

        const comments = project.getRelationshipByName("commentsThroughTasks").loaded()

        expect(comments.length).toBe(1)
        expect(comments[0].body()).toEqual("third")
    })
  })
})
