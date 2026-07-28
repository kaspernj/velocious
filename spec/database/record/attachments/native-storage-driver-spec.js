// @ts-check

import NativeAttachmentStorageDriver from "../../../../src/database/record/attachments/storage-drivers/native.js"

class NativePathSource {
  constructor() {
    this.readCalls = 0
    this.sourceBytes = Buffer.from([0, 255, 10, 13])
    this.byteSize = this.sourceBytes.length
    this.filePath = "/allowed/source.bin"
  }

  /** @returns {Promise<void>} - No-op close. */
  async close() {}

  /** @returns {Promise<import("node:stream").Readable>} - Never opens a stream. */
  async createReadStream() {
    throw new Error("Native compatibility must use readBuffer")
  }

  /** @returns {Promise<Buffer>} - Path bytes. */
  async readBuffer() {
    this.readCalls += 1

    return this.sourceBytes
  }
}

describe("Native attachment storage driver path compatibility", () => {
  it("buffers path input only inside the native driver to preserve its Base64 callback", async () => {
    const pathSource = new NativePathSource()
    /** @type {string | null} */
    let receivedContentBase64 = null
    const driver = new NativeAttachmentStorageDriver({
      name: "native",
      options: {
        read: async () => Buffer.alloc(0),
        write: async ({contentBase64}) => {
          receivedContentBase64 = contentBase64

          return {storageKey: "native-path"}
        }
      }
    })

    await driver.write({
      attachmentId: "path-id",
      input: {
        byteSize: pathSource.sourceBytes.length,
        contentBase64: null,
        contentBuffer: null,
        contentType: "application/octet-stream",
        filename: "source.bin",
        pathSource
      },
      model: {},
      name: "document"
    })

    expect(pathSource.readCalls).toEqual(1)
    expect(receivedContentBase64).toEqual(pathSource.sourceBytes.toString("base64"))
  })

  it("passes existing in-memory Base64 through without reading a path", async () => {
    const contentBuffer = Buffer.from("memory")
    /** @type {string | null} */
    let receivedContentBase64 = null
    const driver = new NativeAttachmentStorageDriver({
      name: "native",
      options: {
        read: async () => Buffer.alloc(0),
        write: async ({contentBase64}) => {
          receivedContentBase64 = contentBase64

          return {storageKey: "native-memory"}
        }
      }
    })

    await driver.write({
      attachmentId: "memory-id",
      input: {
        byteSize: contentBuffer.length,
        contentBase64: contentBuffer.toString("base64"),
        contentBuffer,
        contentType: "text/plain",
        filename: "memory.txt",
        pathSource: null
      },
      model: {},
      name: "document"
    })

    expect(receivedContentBase64).toEqual(contentBuffer.toString("base64"))
  })
})
