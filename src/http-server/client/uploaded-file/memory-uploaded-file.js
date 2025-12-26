// @ts-check

import fs from "fs/promises"
import UploadedFile from "./uploaded-file.js"

export default class MemoryUploadedFile extends UploadedFile {
  /**
   * @param {object} args - Options object.
   * @param {Buffer} args.buffer - Buffer.
   * @param {string} args.fieldName - Field name.
   * @param {string} args.filename - Filename.
   * @param {string | undefined} args.contentType - Content type.
   * @param {number} args.size - Size.
   */
  constructor({buffer, contentType, fieldName, filename, size}) {
    super({contentType, fieldName, filename, size})

    this.buffer = buffer
  }

  getBuffer() { return this.buffer }

  /**
   * @param {string} destinationPath - Destination path.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async saveTo(destinationPath) {
    await fs.writeFile(destinationPath, this.buffer)
  }
}
