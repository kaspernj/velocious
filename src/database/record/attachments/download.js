// @ts-check

/** Downloaded attachment payload wrapper. */
export default class RecordAttachmentDownload {
  /**
 * Runs constructor.
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

  /**
 * Runs byte size.
 * @returns {number} - File size in bytes. */
  byteSize() { return this.values.byteSize }
  /**
 * Runs content.
 * @returns {Buffer} - File content. */
  content() { return this.values.content }
  /**
 * Runs content type.
 * @returns {string | null} - Content type. */
  contentType() { return this.values.contentType }
  /**
 * Runs filename.
 * @returns {string} - Filename. */
  filename() { return this.values.filename }
  /**
 * Runs id.
 * @returns {string} - Attachment id. */
  id() { return this.values.id }
  /**
 * Runs url.
 * @returns {string | null} - Resolvable attachment URL. */
  url() { return this.values.url }
}
