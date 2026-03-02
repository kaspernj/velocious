import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - attachments", {tags: ["dummy"]}, () => {
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
})
