// @ts-check

import fs from "fs/promises"
import UploadedFile from "./uploaded-file.js"

export default class MemoryUploadedFile extends UploadedFile {
  /**
   * @param {object} args
   * @param {Buffer} args.buffer
   * @param {string} args.fieldName
   * @param {string} args.filename
   * @param {string | undefined} args.contentType
   * @param {number} args.size
   */
  constructor({buffer, contentType, fieldName, filename, size}) {
    super({contentType, fieldName, filename, size})

    this.buffer = buffer
  }

  getBuffer() { return this.buffer }

  /**
   * @param {string} destinationPath
   * @returns {Promise<void>} - Resolves when complete.
   */
  async saveTo(destinationPath) {
    await fs.writeFile(destinationPath, this.buffer)
  }
}
