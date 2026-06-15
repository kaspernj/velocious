// @ts-check

import DatabaseRecord from "../index.js"
import RecordAttachmentsStore from "./store.js"

/** Frontend-readable metadata row for `velocious_attachments`. */
export default class VelociousAttachment extends DatabaseRecord {
  /**
   * Returns the backing attachment table name.
   * @returns {string} - Backing attachment table name.
   */
  static tableName() {
    return "velocious_attachments"
  }

  /**
   * Ensures the framework-owned attachment table exists before loading metadata.
   * @param {object} args - Options object.
   * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
   * @returns {Promise<void>} - Resolves when complete.
   */
  static async initializeRecord({configuration}) {
    const store = new RecordAttachmentsStore({
      configuration,
      databaseIdentifier: this.getConfiguredDatabaseIdentifier()
    })

    await store.ensureReady()
    await super.initializeRecord({configuration})
  }

  /**
   * Returns the attachment id.
   * @returns {string} - Attachment id.
   */
  id() { return this.readAttribute("id") }

  /**
   * Returns the owner model name.
   * @returns {string} - Owner model name.
   */
  recordType() { return this.readAttribute("recordType") }

  /**
   * Returns the owner record id.
   * @returns {string} - Owner record id.
   */
  recordId() { return this.readAttribute("recordId") }

  /**
   * Returns the attachment name on the owner model.
   * @returns {string} - Attachment name on the owner model.
   */
  name() { return this.readAttribute("name") }

  /**
   * Returns the attachment position.
   * @returns {number} - Attachment position.
   */
  position() { return this.readAttribute("position") }

  /**
   * Returns the attachment filename.
   * @returns {string} - Attachment filename.
   */
  filename() { return this.readAttribute("filename") }

  /**
   * Returns the attachment content type.
   * @returns {string | null} - Attachment content type.
   */
  contentType() { return this.readAttribute("contentType") }

  /**
   * Returns the attachment byte size.
   * @returns {number} - Attachment byte size.
   */
  byteSize() { return this.readAttribute("byteSize") }

  /**
   * Returns the created-at timestamp in milliseconds.
   * @returns {number} - Created-at timestamp in milliseconds.
   */
  createdAtMs() { return this.readAttribute("createdAtMs") }

  /**
   * Returns the updated-at timestamp in milliseconds.
   * @returns {number} - Updated-at timestamp in milliseconds.
   */
  updatedAtMs() { return this.readAttribute("updatedAtMs") }
}
