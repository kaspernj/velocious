import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - attachments", {tags: ["dummy"]}, () => {
  class InlineMemoryAttachmentDriver {
    constructor() {
      /** @type {Map<string, Buffer>} */
      this.contents = new Map()
    }

    /**
     * @param {object} args - Options.
     * @param {string} args.attachmentId - Attachment id.
     * @param {{contentBuffer: Buffer}} args.input - Normalized input.
     * @returns {Promise<{storageKey: string}>} - Storage key.
     */
    async write({attachmentId, input}) {
      const storageKey = `${attachmentId}-memory`

      this.contents.set(storageKey, input.contentBuffer)

      return {storageKey}
    }

    /**
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<Buffer>} - Stored content.
     */
    async read({storageKey}) {
      return this.contents.get(storageKey) || Buffer.from("")
    }

    /**
     * @param {object} args - Options.
     * @param {string} args.storageKey - Storage key.
     * @returns {Promise<string>} - URL.
     */
    async url({storageKey}) {
      return `memory://${storageKey}`
    }
  }

  it("attaches and downloads has-one attachments", async () => {
    const project = await Project.create({name: "Attachment project"})
    const task = await Task.create({name: "Attachment task", projectId: project.id()})

    await task.descriptionFile().attach({
      content: "hello attachment",
      filename: "description.txt"
    })

    const downloadedAttachment = await task.descriptionFile().download()

    expect(downloadedAttachment.filename()).toEqual("description.txt")
    expect(downloadedAttachment.content().toString()).toEqual("hello attachment")
  })

  it("replaces has-one attachments when updating with attachment attributes", async () => {
    const project = await Project.create({name: "Attachment project"})
    const task = await Task.create({name: "Attachment task", projectId: project.id()})

    await task.descriptionFile().attach({
      content: "first",
      filename: "first.txt"
    })
    await task.update({
      descriptionFile: {
        content: "second",
        filename: "second.txt"
      }
    })

    const downloadedAttachment = await task.descriptionFile().download()

    expect(downloadedAttachment.filename()).toEqual("second.txt")
    expect(downloadedAttachment.content().toString()).toEqual("second")
  })

  it("supports has-many attachments", async () => {
    const project = await Project.create({name: "Attachment project"})
    const task = await Task.create({name: "Attachment task", projectId: project.id()})

    await task.files().attach({content: "A", filename: "a.txt"})
    await task.files().attach({content: "B", filename: "b.txt"})

    const downloadedAttachments = await task.files().downloadAll()

    expect(downloadedAttachments.map((attachment) => attachment.filename())).toEqual(["a.txt", "b.txt"])
    expect(downloadedAttachments.map((attachment) => attachment.content().toString())).toEqual(["A", "B"])
  })

  it("returns a resolvable URL for attachments", async () => {
    const project = await Project.create({name: "Attachment project"})
    const task = await Task.create({name: "Attachment task", projectId: project.id()})

    await task.descriptionFile().attach({
      content: "url-content",
      filename: "url.txt"
    })

    const attachmentUrl = await task.descriptionFile().url()
    const downloadedAttachment = await task.descriptionFile().download()

    expect(typeof attachmentUrl).toEqual("string")
    expect(attachmentUrl.startsWith("file://")).toEqual(true)
    expect(downloadedAttachment.url()).toEqual(attachmentUrl)
  })

  it("keeps only the latest queued has-one attachment before save", async () => {
    const project = await Project.create({name: "Attachment project"})
    const task = await Task.create({name: "Attachment task", projectId: project.id()})

    task.setDescriptionFile({content: "first", filename: "first.txt"})
    task.setDescriptionFile({content: "second", filename: "second.txt"})

    await task.save()

    const downloadedAttachment = await task.descriptionFile().download()

    expect(downloadedAttachment.filename()).toEqual("second.txt")
    expect(downloadedAttachment.content().toString()).toEqual("second")
  })

  it("supports attachment driver classes directly on model definitions", async () => {
    const originalDriver = Task.getAttachmentByName("descriptionFile").driver

    Task.getAttachmentByName("descriptionFile").driver = InlineMemoryAttachmentDriver

    try {
      const project = await Project.create({name: "Attachment project"})
      const task = await Task.create({name: "Attachment task", projectId: project.id()})

      await task.descriptionFile().attach({
        content: "driver-content",
        filename: "driver.txt"
      })

      const downloadedAttachment = await task.descriptionFile().download()
      const attachmentUrl = await task.descriptionFile().url()

      expect(downloadedAttachment.content().toString()).toEqual("driver-content")
      expect(downloadedAttachment.url()).toMatch(/^memory:\/\//)
      expect(attachmentUrl).toMatch(/^memory:\/\//)
    } finally {
      Task.getAttachmentByName("descriptionFile").driver = originalDriver
    }
  })
})
