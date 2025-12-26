// @ts-check

import fs from "fs/promises"
import UploadedFile from "./uploaded-file.js"

export default class TemporaryUploadedFile extends UploadedFile {
  /**
   * @param {object} args
   * @param {string} args.path
   * @param {string} args.fieldName
   * @param {string} args.filename
   * @param {string | undefined} args.contentType
   * @param {number} args.size
   */
  constructor({contentType, fieldName, filename, path, size}) {
    super({contentType, fieldName, filename, size})

    this.pathValue = path
  }

  getPath() { return this.pathValue }

  /**
   * @param {string} destinationPath
   * @returns {Promise<void>} - Result.
   */
  async saveTo(destinationPath) {
    await fs.copyFile(this.pathValue, destinationPath)
  }
}
