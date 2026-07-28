// @ts-check

import { createWriteStream } from "node:fs"
import fs from "fs/promises"
import path from "path"
import { pipeline } from "node:stream/promises"

/**
 * Runs normalize base url.
 * @param {string} value - URL value.
 * @returns {string} - URL without trailing slash.
 */
function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "")
}

/**
 * Runs encode storage key.
 * @param {string} storageKey - Storage key.
 * @returns {string} - URL-safe storage key.
 */
function encodeStorageKey(storageKey) {
  return storageKey.split("/").map((entry) => encodeURIComponent(entry)).join("/")
}

/**
 * Filesystem attachment storage driver.
 */
export default class FilesystemAttachmentStorageDriver {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../../../../configuration.js").default} args.configuration - Configuration instance.
   * @param {Record<string, ?>} [args.options] - Driver options.
   */
  constructor({configuration, options = {}}) {
    this.configuration = configuration
    this.options = options
  }

  /**
   * Runs directory.
   * @returns {string} - Root directory for attachment files.
   */
  directory() {
    if (typeof this.options.directory === "string" && this.options.directory.length > 0) {
      return path.resolve(this.options.directory)
    }

    return path.resolve(this.configuration.getDirectory(), "tmp/attachments/filesystem")
  }

  /**
   * Runs write.
   * @param {object} args - Options.
   * @param {string} args.attachmentId - Attachment id.
   * @param {import("../normalize-input.js").NormalizedAttachmentInput} args.input - Normalized attachment input.
   * @returns {Promise<{storageKey: string}>} - Storage key result.
   */
  async write({attachmentId, input}) {
    const normalizedFilename = path.basename(input.filename || "attachment.bin")
    const storageKey = `${attachmentId}-${normalizedFilename}`
    const filePath = path.resolve(this.directory(), storageKey)
    const temporaryFilePath = `${filePath}.tmp`

    await fs.mkdir(path.dirname(filePath), {recursive: true})

    try {
      if (input.pathSource) {
        await pipeline(
          await input.pathSource.createReadStream(),
          createWriteStream(temporaryFilePath)
        )
      } else if (input.contentBuffer) {
        await fs.writeFile(temporaryFilePath, input.contentBuffer)
      } else {
        throw new Error("Filesystem attachment input has no content")
      }

      await fs.rename(temporaryFilePath, filePath)
    } catch (error) {
      try {
        await fs.unlink(temporaryFilePath)
      } catch (cleanupError) {
        if (!(cleanupError instanceof Error) || !("code" in cleanupError) || cleanupError.code !== "ENOENT") {
          throw new AggregateError(
            [error, cleanupError],
            `Filesystem attachment write and partial-file cleanup both failed for ${storageKey}`,
            {cause: cleanupError}
          )
        }
      }

      throw error
    }

    return {storageKey}
  }

  /**
   * Runs read.
   * @param {object} args - Options.
   * @param {string} args.storageKey - Storage key.
   * @returns {Promise<Buffer>} - Attachment bytes.
   */
  async read({storageKey}) {
    const filePath = path.resolve(this.directory(), storageKey)

    return await fs.readFile(filePath)
  }

  /**
   * Runs delete.
   * @param {object} args - Options.
   * @param {string} args.storageKey - Storage key.
   * @returns {Promise<void>} - Resolves when file has been deleted.
   */
  async delete({storageKey}) {
    const filePath = path.resolve(this.directory(), storageKey)

    try {
      await fs.unlink(filePath)
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error
      }
    }
  }

  /**
   * Runs url.
   * @param {object} args - Options.
   * @param {string} args.storageKey - Storage key.
   * @returns {Promise<string>} - Resolvable URL.
   */
  async url({storageKey}) {
    if (typeof this.options.baseUrl === "string" && this.options.baseUrl.length > 0) {
      return `${normalizeBaseUrl(this.options.baseUrl)}/${encodeStorageKey(storageKey)}`
    }

    const filePath = path.resolve(this.directory(), storageKey)

    return `file://${filePath}`
  }
}
