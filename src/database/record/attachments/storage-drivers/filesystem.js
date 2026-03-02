// @ts-check

import fs from "fs/promises"
import path from "path"

/**
 * @param {string} value - URL value.
 * @returns {string} - URL without trailing slash.
 */
function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "")
}

/**
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
   * @param {object} args - Options.
   * @param {import("../../../../configuration.js").default} args.configuration - Configuration instance.
   * @param {Record<string, any>} [args.options] - Driver options.
   */
  constructor({configuration, options = {}}) {
    this.configuration = configuration
    this.options = options
  }

  /**
   * @returns {string} - Root directory for attachment files.
   */
  directory() {
    if (typeof this.options.directory === "string" && this.options.directory.length > 0) {
      return path.resolve(this.options.directory)
    }

    return path.resolve(this.configuration.getDirectory(), "tmp/attachments/filesystem")
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.attachmentId - Attachment id.
   * @param {{contentBuffer: Buffer, filename: string}} args.input - Normalized attachment input.
   * @returns {Promise<{storageKey: string}>} - Storage key result.
   */
  async write({attachmentId, input}) {
    const normalizedFilename = path.basename(input.filename || "attachment.bin")
    const storageKey = `${attachmentId}-${normalizedFilename}`
    const filePath = path.resolve(this.directory(), storageKey)

    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.writeFile(filePath, input.contentBuffer)

    return {storageKey}
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.storageKey - Storage key.
   * @returns {Promise<Buffer>} - Attachment bytes.
   */
  async read({storageKey}) {
    const filePath = path.resolve(this.directory(), storageKey)

    return await fs.readFile(filePath)
  }

  /**
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
