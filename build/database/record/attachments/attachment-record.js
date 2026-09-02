// @ts-check

import DatabaseRecord from "../index.js"
import RecordAttachmentsStore from "./store.js"

const INTEGER_STRING_PATTERN = /^-?\d+$/

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
  byteSize() { return this.safeIntegerAttribute({attributeName: "byteSize", expectedDescription: "attachment byte size"}) }

  /**
   * Returns the created-at timestamp in milliseconds.
   * @returns {number} - Created-at timestamp in milliseconds.
   */
  createdAtMs() { return this.safeIntegerAttribute({attributeName: "createdAtMs", expectedDescription: "safe millisecond timestamp"}) }

  /**
   * Returns the updated-at timestamp in milliseconds.
   * @returns {number} - Updated-at timestamp in milliseconds.
   */
  updatedAtMs() { return this.safeIntegerAttribute({attributeName: "updatedAtMs", expectedDescription: "safe millisecond timestamp"}) }

  /**
   * Returns a checked integer attribute value.
   * @param {object} args - Options object.
   * @param {"byteSize" | "createdAtMs" | "updatedAtMs"} args.attributeName - Integer attribute name.
   * @param {string} args.expectedDescription - Description for error messages.
   * @returns {number} - Safe integer value.
   */
  safeIntegerAttribute({attributeName, expectedDescription}) {
    const value = this.readAttribute(attributeName)
    let integer

    if (typeof value === "number") {
      integer = value
    } else if (typeof value === "bigint") {
      integer = Number(value)
    } else if (typeof value === "string" && INTEGER_STRING_PATTERN.test(value)) {
      integer = Number(value)
    } else {
      throw new Error(`Expected ${attributeName} to be a ${expectedDescription}`)
    }

    if (!Number.isSafeInteger(integer)) {
      throw new Error(`Expected ${attributeName} to be a ${expectedDescription}`)
    }

    return integer
  }
}
