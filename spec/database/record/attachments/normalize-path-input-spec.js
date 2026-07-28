// @ts-check

import BaseEnvironmentHandler from "../../../../src/environment-handlers/base.js"
import normalizeRecordAttachmentInput from "../../../../src/database/record/attachments/normalize-input.js"

class PathMetadataEnvironmentHandler extends BaseEnvironmentHandler {
  constructor() {
    super()
    this.readCalls = 0
    /**
     * @type {{allowedPathPrefixes: string[], inputPath: string} | null}
     */
    this.resolveArgs = null
    this.pathSource = {
      byteSize: 7,
      close: async () => {},
      createReadStream: async () => {
        throw new Error("Path normalization must not open a stream")
      },
      filePath: "/allowed/reports/source.bin",
      readBuffer: async () => {
        throw new Error("Path normalization must not read the attachment")
      }
    }
  }

  /** @returns {Promise<Buffer>} - Never returns file bytes. */
  async readAttachmentInputFile() {
    this.readCalls += 1
    throw new Error("Path normalization must not read the attachment")
  }

  /**
   * @param {{allowedPathPrefixes: string[], inputPath: string}} args - Resolution args.
   * @returns {Promise<import("../../../../src/database/record/attachments/normalize-input.js").AttachmentPathSource>} - Resolved path source.
   */
  async resolveAttachmentInputPath(args) {
    this.resolveArgs = args

    return this.pathSource
  }
}

describe("Record attachment path input normalization", () => {
  it("normalizes validated path metadata without reading or encoding the file", async () => {
    const environmentHandler = new PathMetadataEnvironmentHandler()
    const normalizedInput = await normalizeRecordAttachmentInput({
      contentType: "application/octet-stream",
      filename: "renamed.bin",
      path: "/allowed/reports/source.bin"
    }, {
      allowPathInput: true,
      allowedPathPrefixes: ["/allowed"],
      environmentHandler
    })

    expect(environmentHandler.resolveArgs).toEqual({
      allowedPathPrefixes: ["/allowed"],
      inputPath: "/allowed/reports/source.bin"
    })
    expect(environmentHandler.readCalls).toEqual(0)
    expect(normalizedInput).toEqual({
      byteSize: 7,
      contentBase64: null,
      contentBuffer: null,
      contentType: "application/octet-stream",
      filename: "renamed.bin",
      pathSource: environmentHandler.pathSource
    })
  })

  it("keeps in-memory inputs as buffers with compatible Base64 content", async () => {
    const contentBuffer = Buffer.from([0, 1, 2, 254, 255])
    const normalizedInput = await normalizeRecordAttachmentInput({
      content: contentBuffer,
      contentType: "application/octet-stream",
      filename: "memory.bin"
    })

    expect(normalizedInput).toEqual({
      byteSize: 5,
      contentBase64: contentBuffer.toString("base64"),
      contentBuffer,
      contentType: "application/octet-stream",
      filename: "memory.bin",
      pathSource: null
    })
  })
})
