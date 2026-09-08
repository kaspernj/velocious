import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import UuidItem from "../../dummy/src/models/uuid-item.js"

/**
 * @param {import("../../../src/database/query/model-class-query.js").default<typeof Task>} query - Task selection.
 * @param {Task[]} expected - Exact expected records.
 * @returns {Promise<void>} - Resolves after comparing identifiers.
 */
async function expectTasks(query, expected) {
  const records = await query.toArray()

  expect(records.map((record) => record.id()).sort()).toEqual(expected.map((record) => record.id()).sort())
}

describe("Database - query - explicit IN", {tags: ["dummy"]}, () => {
  let project, nullTask, manualTask, githubTask

  beforeEach(async () => {
    project = await Project.create({nameEn: "Membership project"})
    nullTask = await Task.create({project, name: "Null", description: null, isDone: false})
    manualTask = await Task.create({project, name: "Manual", description: "manual", isDone: true})
    githubTask = await Task.create({project, name: "Github", description: "github", isDone: null})
    const otherProject = await Project.create({nameEn: "Other membership project"})

    await Task.create({project: otherProject, name: "Outside null", description: null})
    await Task.create({project: otherProject, name: "Outside manual", description: "manual"})
    await Task.create({project: otherProject, name: "Outside github", description: "github"})
  })

  it("keeps sibling scope constraints in either key order", async () => {
    const projectId = project.id()

    await expectTasks(Task.where({projectId, description: {in: [null, "manual"]}}), [nullTask, manualTask])
    await expectTasks(Task.where({description: {in: ["manual", null]}, projectId}), [nullTask, manualTask])
  })

  it("keeps chained scopes in either order", async () => {
    await expectTasks(Task
      .where({projectId: project.id()})
      .where({description: {in: [null, "manual"]}}), [nullTask, manualTask])
    await expectTasks(Task
      .where({description: {in: [null, "manual"]}})
      .where({projectId: project.id()}), [nullTask, manualTask])
  })

  it("handles non-null, all-null, repeated-null and empty lists", async () => {
    for (const [members, expected] of [
      [["manual", "github"], [manualTask, githubTask]],
      [[null], [nullTask]],
      [[null, null], [nullTask]],
      [[null, "manual", null], [nullTask, manualTask]],
      [[], []]
    ]) {
      await expectTasks(Task.where({projectId: project.id(), description: {in: members}}), expected)
    }
  })

  it("maps attribute and physical column names and normalizes booleans", async () => {
    await expectTasks(Task.where({projectId: {in: [project.id()]}, isDone: {in: [false]}}), [nullTask])
    await expectTasks(Task.where({project_id: {in: [project.id()]}, is_done: {in: [true, null]}}), [manualTask, githubTask])
    await expectTasks(Task.where({projectId: {in: [0]}}), [])
  })

  it("preserves empty strings, quoted text and numeric text normalization with frozen inputs", async () => {
    await nullTask.update({description: ""})
    await manualTask.update({description: "it's manual"})
    await githubTask.update({description: "0"})
    const members = Object.freeze(["", "it's manual", 0, null])
    const conditions = Object.freeze({projectId: project.id(), description: Object.freeze({in: members})})

    await expectTasks(Task.where(conditions), [nullTask, manualTask, githubTask])
    await expectTasks(Task.where(conditions), [nullTask, manualTask, githubTask])
    expect(members).toEqual(["", "it's manual", 0, null])
  })

  it("resolves nested relationship leaves and distinct aliases", async () => {
    await expectTasks(Task.where({
      project: {id: {in: [project.id()]}, creatingUserReference: {in: [null]}},
      reviewProject: {id: {in: [0]}}
    }), [])
    await expectTasks(Task.where({
      project: {id: {in: [project.id()]}, creatingUserReference: {in: [null]}},
      reviewProject: {id: {in: [project.id()]}}
    }), [nullTask, manualTask, githubTask])
  })

  it("supports qualified column leaves without weakening sibling constraints", async () => {
    await expectTasks(Task.where({tasks: {project_id: project.id(), name: {in: [null, "Manual"]}}}), [manualTask])
    await expectTasks(Task.where({tasks: {name: {in: [null, "Manual"]}, project_id: project.id()}}), [manualTask])
  })

  it("negates the complete membership predicate through both APIs", async () => {
    for (const [members, expected] of [
      [[null, "manual"], [githubTask]],
      [[null], [manualTask, githubTask]],
      [[], [nullTask, manualTask, githubTask]],
      [["manual"], [githubTask]]
    ]) {
      await expectTasks(Task
        .where({projectId: project.id()})
        .whereNot({description: {in: members}}), expected)
      await expectTasks(Task
        .where({projectId: project.id()})
        .where.not({description: {in: members}}), expected)
    }
  })

  it("leaves direct arrays and their SQL NULL behavior unchanged", async () => {
    await expectTasks(Task.where({projectId: project.id(), name: [null, "Manual"]}), [manualTask])
    await expectTasks(Task.where({projectId: project.id(), name: ["Manual", "Github"]}), [manualTask, githubTask])
    await expectTasks(Task.where({name: []}), [])
    await expectTasks(Task.where({name: [null]}), [])
    const projects = await Project.where({id: project.id(), creatingUserReference: [null]}).toArray()

    expect(projects).toEqual([])
  })

  it("retains valid UUIDs while ignoring numeric no-match members", async () => {
    const item = await UuidItem.create({title: "Membership UUID"})
    const matched = await UuidItem.where({id: {in: [0, item.id(), null]}}).toArray()
    const unmatched = await UuidItem.where({id: {in: [0]}}).toArray()

    expect(matched.map((record) => record.id())).toEqual([item.id()])
    expect(unmatched).toEqual([])
  })
})
