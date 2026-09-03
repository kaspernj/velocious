// @ts-check

import Project from "../../dummy/src/models/project.js"
import Record from "../../../src/database/record/index.js"
import Task from "../../dummy/src/models/task.js"

/** In-memory attachment driver for composite-key ownership coverage. */
class CompositePrimaryKeyAttachmentDriver {
  /** @type {Map<string, Buffer>} */
  contents = new Map()

  /**
   * @param {{attachmentId: string, input: {contentBuffer: Buffer}}} args - Attachment write arguments.
   * @returns {Promise<{storageKey: string}>} - Written storage identity.
   */
  async write({attachmentId, input}) {
    this.contents.set(attachmentId, input.contentBuffer)

    return {storageKey: attachmentId}
  }

  /**
   * @param {{storageKey: string}} args - Attachment read arguments.
   * @returns {Promise<Buffer>} - Stored attachment bytes.
   */
  async read({storageKey}) {
    const content = this.contents.get(storageKey)

    if (!content) throw new Error(`Missing attachment content: ${storageKey}`)

    return content
  }
}

/** Composite-key view of the dummy tasks table. */
class CompositePrimaryKeyTask extends Record {}

/** Composite-key view with uniqueness validation. */
class ValidatedCompositePrimaryKeyTask extends Record {}

CompositePrimaryKeyTask.setTableName("tasks")
CompositePrimaryKeyTask.setPrimaryKey(["name", "project_id"])
CompositePrimaryKeyTask.hasOneAttachment("descriptionFile", {driver: CompositePrimaryKeyAttachmentDriver})
ValidatedCompositePrimaryKeyTask.setTableName("tasks")
ValidatedCompositePrimaryKeyTask.setPrimaryKey(["name", "project_id"])
ValidatedCompositePrimaryKeyTask.validates("name", {uniqueness: true})

describe("Record - composite primary key", {tags: ["dummy"]}, () => {
  it("keeps scalar primary-key behavior unchanged", async () => {
    const project = await Project.create({name: "Scalar identity project"})
    const task = await Task.create({name: "Scalar identity task", project})

    expect(["number", "string"].includes(typeof task.id())).toBeTrue()
    expect((await Task.find(task.id()))?.id()).toEqual(task.id())
  })

  it("creates and finds a record by every composite key component", async () => {
    const project = await Project.create({name: "Composite identity project"})
    const task = await CompositePrimaryKeyTask.create({name: "Composite identity task", project_id: project.id()})

    expect(task.id()).toEqual({name: "Composite identity task", project_id: project.id()})

    const foundTask = await CompositePrimaryKeyTask.find({name: "Composite identity task", project_id: project.id()})

    expect(foundTask?.id()).toEqual({name: "Composite identity task", project_id: project.id()})
  })

  it("updates non-key attributes using the persisted composite identity", async () => {
    const project = await Project.create({name: "Composite non-key update project"})
    const task = await CompositePrimaryKeyTask.create({description: "Before", name: "Composite non-key update task", project_id: project.id()})

    await task.update({description: "After"})

    const foundTask = await CompositePrimaryKeyTask.find(task.id())

    expect(foundTask?.readAttribute("description")).toEqual("After")
  })

  it("locates a key-changing update by its persisted identity and reloads by its new identity", async () => {
    const originalProject = await Project.create({name: "Composite original project"})
    const replacementProject = await Project.create({name: "Composite replacement project"})
    const task = await CompositePrimaryKeyTask.create({name: "Composite original task", project_id: originalProject.id()})

    await task.update({name: "Composite renamed task", project_id: replacementProject.id()})

    expect(task.id()).toEqual({name: "Composite renamed task", project_id: replacementProject.id()})
    expect(await CompositePrimaryKeyTask.findBy({name: "Composite original task", project_id: originalProject.id()})).toBeNull()
    expect((await CompositePrimaryKeyTask.find(task.id()))?.id()).toEqual(task.id())
  })

  it("excludes the persisted composite identity from uniqueness checks while re-keying", async () => {
    const originalProject = await Project.create({name: "Composite validation original project"})
    const replacementProject = await Project.create({name: "Composite validation replacement project"})
    const task = await ValidatedCompositePrimaryKeyTask.create({
      name: "Composite validated task",
      project_id: originalProject.id()
    })

    await task.update({project_id: replacementProject.id()})

    expect(task.id()).toEqual({name: "Composite validated task", project_id: replacementProject.id()})
  })

  it("migrates attachment ownership when the composite identity changes", async () => {
    const project = await Project.create({name: "Composite attachment project"})
    const task = await CompositePrimaryKeyTask.create({name: "Composite attachment task", project_id: project.id()})

    await task.getAttachmentByName("descriptionFile").attach({
      content: "composite attachment",
      filename: "composite.txt"
    })
    await task.update({name: "Composite attachment renamed"})

    const attachment = await task.getAttachmentByName("descriptionFile").download()

    expect(attachment.filename()).toEqual("composite.txt")
    expect(attachment.content().toString()).toEqual("composite attachment")
  })

  it("destroys a record using every composite key component", async () => {
    const project = await Project.create({name: "Composite destroy project"})
    const task = await CompositePrimaryKeyTask.create({name: "Composite destroy task", project_id: project.id()})
    const identity = task.id()

    await task.destroy()

    expect(await CompositePrimaryKeyTask.findBy(identity)).toBeNull()
  })

  it("rejects malformed composite identities", async () => {
    const invalidIdentities = [
      "Composite task",
      ["Composite task", 1],
      null,
      {name: "Composite task"},
      {name: "Composite task", project_id: 1, extra: true},
      {name: null, project_id: 1},
      {name: "Composite task", project_id: undefined}
    ]

    for (const identity of invalidIdentities) {
      await expect(async () => await CompositePrimaryKeyTask.find(identity)).toThrow(/composite primary key identity/u)
    }
  })
})
