// @ts-check

export default class UploadedFile {
  /**
   * @param {object} args
   * @param {string} args.fieldName
   * @param {string} args.filename
   * @param {string | undefined} args.contentType
   * @param {number} args.size
   */
  constructor({contentType, fieldName, filename, size}) {
    if (!fieldName) throw new Error("fieldName is required")
    if (!filename) throw new Error("filename is required")
    if (typeof size !== "number") throw new Error("size is required")

    this.contentTypeValue = contentType
    this.fieldNameValue = fieldName
    this.filenameValue = filename
    this.sizeValue = size
  }

  contentType() { return this.contentTypeValue }
  fieldName() { return this.fieldNameValue }
  filename() { return this.filenameValue }
  size() { return this.sizeValue }

  /**
   * @param {string} _destinationPath
   * @returns {Promise<void>} - Result.
   */
  async saveTo(_destinationPath) { // eslint-disable-line no-unused-vars
    throw new Error("Not implemented")
  }
}
