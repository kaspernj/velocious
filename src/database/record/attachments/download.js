// @ts-check

/** Downloaded attachment payload wrapper. */
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
    this.values = {byteSize, content, contentType, filename, id, url}
  }

  /** @returns {number} - File size in bytes. */
  byteSize() { return this.values.byteSize }
  /** @returns {Buffer} - File content. */
  content() { return this.values.content }
  /** @returns {string | null} - Content type. */
  contentType() { return this.values.contentType }
  /** @returns {string} - Filename. */
  filename() { return this.values.filename }
  /** @returns {string} - Attachment id. */
  id() { return this.values.id }
  /** @returns {string | null} - Resolvable attachment URL. */
  url() { return this.values.url }
}
