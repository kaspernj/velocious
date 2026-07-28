// @ts-check

import fs from "node:fs/promises"
import MemoryUploadedFile from "../../../../src/http-server/client/uploaded-file/memory-uploaded-file.js"
import NodeEnvironmentHandler from "../../../../src/environment-handlers/node.js"
import normalizeRecordAttachmentInput from "../../../../src/database/record/attachments/normalize-input.js"
import path from "node:path"
import TemporaryUploadedFile from "../../../../src/http-server/client/uploaded-file/temporary-uploaded-file.js"

describe("Record UploadedFile attachment input normalization", () => {
  it("keeps memory UploadedFile content in memory", async () => {
    const contentBuffer = Buffer.from("memory upload")
    const uploadedFile = new MemoryUploadedFile({
      buffer: contentBuffer,
      contentType: "text/plain",
      fieldName: "document",
      filename: "memory.txt",
      size: contentBuffer.length
    })
    const normalizedInput = await normalizeRecordAttachmentInput(uploadedFile)

    expect(normalizedInput.contentBuffer).toBe(contentBuffer)
    expect(normalizedInput.contentBase64).toEqual(contentBuffer.toString("base64"))
    expect(normalizedInput.pathSource).toEqual(null)
    expect(normalizedInput.byteSize).toEqual(contentBuffer.length)
    expect(normalizedInput.filename).toEqual("memory.txt")
  })

  it("preserves temporary UploadedFile buffering behavior", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/temporary-uploaded-file-"))
    const sourcePath = path.join(temporaryDirectory, "upload.bin")
    const sourceBytes = Buffer.from([0, 255, 1, 128])

    try {
      await fs.writeFile(sourcePath, sourceBytes)

      const uploadedFile = new TemporaryUploadedFile({
        contentType: "application/octet-stream",
        fieldName: "document",
        filename: "upload.bin",
        path: sourcePath,
        size: sourceBytes.length
      })
      const normalizedInput = await normalizeRecordAttachmentInput(uploadedFile, {
        environmentHandler: new NodeEnvironmentHandler()
      })

      expect(normalizedInput.contentBuffer?.toString("base64")).toEqual(sourceBytes.toString("base64"))
      expect(normalizedInput.contentBase64).toEqual(sourceBytes.toString("base64"))
      expect(normalizedInput.pathSource).toEqual(null)
      expect(normalizedInput.byteSize).toEqual(sourceBytes.length)
    } finally {
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })
})
