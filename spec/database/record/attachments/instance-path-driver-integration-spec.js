// @ts-check

import Configuration from "../../../../src/configuration.js"
import fs from "node:fs/promises"
import NativeAttachmentStorageDriver from "../../../../src/database/record/attachments/storage-drivers/native.js"
import path from "node:path"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Preconstructed attachment storage driver path input", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  it("supports a native driver instance without injecting configuration", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/instance-path-driver-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const sourceBytes = Buffer.from([0, 255, 1, 128])
    const attachmentsConfiguration = Configuration.current().getAttachmentsConfiguration()
    const attachmentDefinition = Task.getAttachmentByName("descriptionFile")
    const previousAllowPathInput = attachmentsConfiguration.allowPathInput
    const previousAllowedPathPrefixes = attachmentsConfiguration.allowedPathPrefixes
    const previousDriver = attachmentDefinition.driver
    const driverName = "preconstructed-native-path"
    const previousDriverConfiguration = attachmentsConfiguration.drivers?.[driverName]
    /** @type {Map<string, string>} */
    const storedBase64 = new Map()
    const nativeDriver = new NativeAttachmentStorageDriver({
      name: driverName,
      options: {
        read: async ({storageKey}) => storedBase64.get(storageKey) || "",
        write: async ({attachmentId, contentBase64}) => {
          storedBase64.set(attachmentId, contentBase64)

          return {storageKey: attachmentId}
        }
      }
    })

    if (!attachmentsConfiguration.drivers) attachmentsConfiguration.drivers = {}

    attachmentsConfiguration.drivers[driverName] = {instance: nativeDriver}
    attachmentsConfiguration.allowPathInput = true
    attachmentsConfiguration.allowedPathPrefixes = [temporaryDirectory]
    attachmentDefinition.driver = driverName

    try {
      await fs.writeFile(sourcePath, sourceBytes)

      const project = await Project.create({name: "Instance path driver project"})
      const task = await Task.create({name: "Instance path driver task", projectId: project.id()})

      await task.descriptionFile().attach({
        contentType: "application/octet-stream",
        filename: "source.bin",
        path: sourcePath
      })

      const downloadedAttachment = await task.descriptionFile().download()

      expect(downloadedAttachment.content().toString("base64")).toEqual(sourceBytes.toString("base64"))
    } finally {
      attachmentDefinition.driver = previousDriver
      attachmentsConfiguration.allowPathInput = previousAllowPathInput
      attachmentsConfiguration.allowedPathPrefixes = previousAllowedPathPrefixes

      if (previousDriverConfiguration) {
        attachmentsConfiguration.drivers[driverName] = previousDriverConfiguration
      } else {
        delete attachmentsConfiguration.drivers[driverName]
      }

      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })
})
