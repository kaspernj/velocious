// @ts-check

import fs from "node:fs/promises"
import NodeEnvironmentHandler from "../../../../src/environment-handlers/node.js"
import path from "node:path"
import { Readable } from "node:stream"
import S3AttachmentStorageDriver from "../../../../src/database/record/attachments/storage-drivers/s3.js"

class FakePutObjectCommand {
  /**
   * @param {{Body: Buffer | Readable, Bucket: string, ContentLength: number, ContentType: string | undefined, Key: string}} input - Command input.
   */
  constructor(input) {
    this.input = input
  }
}

class FakeS3Client {
  constructor() {
    /** @type {Buffer | Readable | null} */
    this.body = null
    this.contentLength = 0
    this.receivedBytes = Buffer.alloc(0)
    /** @type {Error | null} */
    this.writeError = null
  }

  /**
   * @param {FakePutObjectCommand} command - Put command.
   * @returns {Promise<Record<string, never>>} - Empty response.
   */
  async send(command) {
    this.body = command.input.Body
    this.contentLength = command.input.ContentLength

    if (this.writeError) throw this.writeError

    if (Buffer.isBuffer(this.body)) {
      this.receivedBytes = this.body
    } else {
      /** @type {Buffer[]} */
      const chunks = []

      for await (const chunk of this.body) {
        chunks.push(Buffer.from(chunk))
      }

      this.receivedBytes = Buffer.concat(chunks)
    }

    return {}
  }
}

class TestS3AttachmentStorageDriver extends S3AttachmentStorageDriver {
  /**
   * @param {{client: FakeS3Client}} args - Driver args.
   */
  constructor({client}) {
    super({
      options: {bucket: "attachments"}
    })
    this.fakeClient = client
  }

  /** @returns {Promise<FakeS3Client>} - Fake S3 client. */
  async client() {
    return this.fakeClient
  }

  /**
   * @returns {Promise<{DeleteObjectCommand: typeof FakePutObjectCommand, GetObjectCommand: typeof FakePutObjectCommand, PutObjectCommand: typeof FakePutObjectCommand, S3Client: typeof FakeS3Client, getSignedUrl: () => Promise<string>}>} - Fake runtime.
   */
  async s3Runtime() {
    return {
      DeleteObjectCommand: FakePutObjectCommand,
      GetObjectCommand: FakePutObjectCommand,
      PutObjectCommand: FakePutObjectCommand,
      S3Client: FakeS3Client,
      getSignedUrl: async () => "https://example.test/attachment"
    }
  }
}

describe("S3 attachment storage driver path input", () => {
  it("sends a Node Readable body for path input and preserves exact bytes", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/s3-attachment-driver-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const sourceBytes = Buffer.from([0, 255, 34, 128, 10, 13])
    const client = new FakeS3Client()
    const driver = new TestS3AttachmentStorageDriver({client})
    /** @type {import("../../../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, sourceBytes)
      pathSource = await new NodeEnvironmentHandler().resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })
      await driver.write({
        attachmentId: "path-id",
        input: {
          byteSize: sourceBytes.length,
          contentBase64: null,
          contentBuffer: null,
          contentType: "application/octet-stream",
          filename: "stored.bin",
          pathSource
        }
      })

      expect(client.body).toBeInstanceOf(Readable)
      expect(Buffer.isBuffer(client.body)).toEqual(false)
      expect(client.contentLength).toEqual(sourceBytes.length)
      expect(client.receivedBytes.toString("base64")).toEqual(sourceBytes.toString("base64"))
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("continues sending the original Buffer for in-memory input", async () => {
    const client = new FakeS3Client()
    const driver = new TestS3AttachmentStorageDriver({client})
    const contentBuffer = Buffer.from("in-memory content")

    await driver.write({
      attachmentId: "memory-id",
      input: {
        byteSize: contentBuffer.length,
        contentBase64: contentBuffer.toString("base64"),
        contentBuffer,
        contentType: "text/plain",
        filename: "memory.txt",
        pathSource: null
      }
    })

    expect(client.body).toBe(contentBuffer)
    expect(client.receivedBytes.toString("base64")).toEqual(contentBuffer.toString("base64"))
  })

  it("destroys an opened path stream when S3 rejects the write", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/s3-failed-attachment-driver-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const client = new FakeS3Client()
    const driver = new TestS3AttachmentStorageDriver({client})
    /** @type {import("../../../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, "source")
      pathSource = await new NodeEnvironmentHandler().resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })
      client.writeError = new Error("S3 write failed")

      await expect(async () => await driver.write({
        attachmentId: "failed-id",
        input: {
          byteSize: 6,
          contentBase64: null,
          contentBuffer: null,
          contentType: null,
          filename: "failed.bin",
          pathSource
        }
      })).toThrow(/S3 write failed/)

      expect(client.body).toBeInstanceOf(Readable)
      expect(/** @type {Readable} */ (client.body).destroyed).toEqual(true)
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })
})
