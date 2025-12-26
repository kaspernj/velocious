// @ts-check

export default class UploadedFile {
  /**
   * @param {object} args - Options object.
   * @param {string} args.fieldName - Field name.
   * @param {string} args.filename - Filename.
   * @param {string | undefined} args.contentType - Content type.
   * @param {number} args.size - Size.
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
   * @param {string} _destinationPath - Destination path.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async saveTo(_destinationPath) { // eslint-disable-line no-unused-vars
    throw new Error("Not implemented")
  }
}
