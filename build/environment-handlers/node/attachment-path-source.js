// @ts-check

import { Readable } from "node:stream"

const READ_CHUNK_SIZE = 64 * 1024

/**
 * Opened Node attachment path source.
 *
 * The opened file handle fixes the source identity at normalization time. Reads
 * are limited to the stat snapshot and fail if the file becomes shorter.
 */
export default class AttachmentPathSource {
  /**
   * Creates an opened attachment path source.
   * @param {object} args - Source args.
   * @param {number} args.byteSize - Opened-handle stat size.
   * @param {import("node:fs/promises").FileHandle} args.fileHandle - Open file handle.
   * @param {string} args.filePath - Validated path used to open the handle.
   */
  constructor({byteSize, fileHandle, filePath}) {
    this.byteSize = byteSize
    this.fileHandle = fileHandle
    this.filePath = filePath
    /** @type {Set<Readable>} */
    this.activeStreams = new Set()
    /** @type {Promise<void> | null} */
    this.closePromise = null
    this.closed = false
  }

  /**
   * Creates a bounded, backpressured stream over the opened file snapshot.
   * @returns {Promise<Readable>} - Snapshot read stream.
   */
  async createReadStream() {
    this.assertOpen()

    const stream = Readable.from(this.readChunks())

    this.activeStreams.add(stream)
    stream.once("close", () => {
      this.activeStreams.delete(stream)
    })

    return stream
  }

  /**
   * Reads the opened file snapshot into memory for compatibility-only callers.
   * @returns {Promise<Buffer>} - Exact snapshot bytes.
   */
  async readBuffer() {
    this.assertOpen()

    const contentBuffer = Buffer.allocUnsafe(this.byteSize)
    let offset = 0

    while (offset < this.byteSize) {
      this.assertOpen()

      const {bytesRead} = await this.fileHandle.read(
        contentBuffer,
        offset,
        Math.min(READ_CHUNK_SIZE, this.byteSize - offset),
        offset
      )

      if (bytesRead === 0) this.throwTruncated({bytesRead: offset})

      offset += bytesRead
    }

    return contentBuffer
  }

  /**
   * Closes all active streams and the owned file handle.
   * @returns {Promise<void>} - Resolves after close.
   */
  async close() {
    if (!this.closePromise) {
      this.closed = true
      this.closePromise = (async () => {
        const streams = Array.from(this.activeStreams)
        const streamClosePromises = streams.map(async (stream) => {
          if (stream.closed) return

          await new Promise((resolve) => {
            stream.once("close", resolve)
            stream.destroy()
          })
        })

        await Promise.all(streamClosePromises)
        await this.fileHandle.close()
      })()
    }

    await this.closePromise
  }

  /**
   * Produces bounded chunks from the opened file handle.
   * @yields {Buffer} - Snapshot chunks.
   */
  async *readChunks() {
    let offset = 0

    while (offset < this.byteSize) {
      this.assertOpen()

      const chunkBuffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_SIZE, this.byteSize - offset))
      const {bytesRead} = await this.fileHandle.read(chunkBuffer, 0, chunkBuffer.length, offset)

      if (bytesRead === 0) this.throwTruncated({bytesRead: offset})

      offset += bytesRead
      yield bytesRead === chunkBuffer.length ? chunkBuffer : chunkBuffer.subarray(0, bytesRead)
    }
  }

  /**
   * Asserts that the source remains open.
   * @returns {void} - Throws if closed.
   */
  assertOpen() {
    if (this.closed) {
      throw new Error(`Attachment path source is closed: ${this.filePath}`)
    }
  }

  /**
   * Throws a truncation error.
   * @param {object} args - Args.
   * @param {number} args.bytesRead - Bytes read before EOF.
   * @returns {never} - Always throws.
   */
  throwTruncated({bytesRead}) {
    throw new Error(
      `Attachment path source was truncated: expected ${this.byteSize} bytes but read ${bytesRead} from ${this.filePath}`
    )
  }
}
