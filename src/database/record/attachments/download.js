// @ts-check

/**
 * Downloaded attachment payload wrapper.
 */
export default class RecordAttachmentDownload {
  /**
   * @param {object} args - Options.
   * @param {string} args.id - Attachment id.
   * @param {string} args.filename - Filename.
   * @param {string | null} args.contentType - Content type.
   * @param {number} args.byteSize - File size in bytes.
   * @param {Buffer} args.content - File content.
   * @param {string | null} [args.url] - Resolvable URL.
   */
  constructor({byteSize, content, contentType, filename, id, url = null}) {
    this.idValue = id
    this.filenameValue = filename
    this.contentTypeValue = contentType
    this.byteSizeValue = byteSize
    this.contentValue = content
    this.urlValue = url
  }

  /** @returns {number} - File size in bytes. */
  byteSize() { return this.byteSizeValue }
  /** @returns {Buffer} - File content. */
  content() { return this.contentValue }
  /** @returns {string | null} - Content type. */
  contentType() { return this.contentTypeValue }
  /** @returns {string} - Filename. */
  filename() { return this.filenameValue }
  /** @returns {string} - Attachment id. */
  id() { return this.idValue }
  /** @returns {string | null} - Resolvable attachment URL. */
  url() { return this.urlValue }
}
