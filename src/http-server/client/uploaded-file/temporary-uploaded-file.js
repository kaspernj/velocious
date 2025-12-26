// @ts-check

import fs from "fs/promises"
import UploadedFile from "./uploaded-file.js"

export default class TemporaryUploadedFile extends UploadedFile {
  /**
   * @param {object} args - Options object.
   * @param {string} args.path - Path.
   * @param {string} args.fieldName - Field name.
   * @param {string} args.filename - Filename.
   * @param {string | undefined} args.contentType - Content type.
   * @param {number} args.size - Size.
   */
  constructor({contentType, fieldName, filename, path, size}) {
    super({contentType, fieldName, filename, size})

    this.pathValue = path
  }

  getPath() { return this.pathValue }

  /**
   * @param {string} destinationPath - Destination path.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async saveTo(destinationPath) {
    await fs.copyFile(this.pathValue, destinationPath)
  }
}
