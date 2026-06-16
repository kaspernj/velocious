import FrontendModelBase from "../../../../src/frontend-models/base.js"

/**
 * Frontend model resource config.
 * @typedef {import("../../../../src/frontend-models/base.js").FrontendModelResourceConfig} FrontendModelResourceConfig
 */
/**
 * Fallback attribute value type for generated fields without narrower metadata.
 * @typedef {import("../../../../src/frontend-models/base.js").FrontendModelAttributeValue} FrontendModelAttributeValue
 */

/**
 * VelociousAttachmentAttributes type.
 * @typedef {object} VelociousAttachmentAttributes
 * @property {number} byteSize - Attribute value.
 * @property {string | null} contentType - Attribute value.
 * @property {Date} createdAt - Attribute value.
 * @property {string} filename - Attribute value.
 * @property {string} id - Attribute value.
 * @property {string} name - Attribute value.
 * @property {number} position - Attribute value.
 * @property {string} recordId - Attribute value.
 * @property {string} recordType - Attribute value.
 * @property {Date} updatedAt - Attribute value.
 */
/**
 * Attributes accepted by VelociousAttachmentCreateAttributes.
 * @typedef {Record<string, never>} VelociousAttachmentCreateAttributes
 */
/**
 * Attributes accepted by VelociousAttachmentUpdateAttributes.
 * @typedef {Record<string, never>} VelociousAttachmentUpdateAttributes
 */
/**
 * Frontend model for VelociousAttachment.
 * @augments {FrontendModelBase<VelociousAttachmentAttributes, VelociousAttachmentCreateAttributes, VelociousAttachmentUpdateAttributes>}
 */
class VelociousAttachment extends FrontendModelBase {
  /** @returns {FrontendModelResourceConfig} - Resource config. */
  static resourceConfig() {
    return {
      modelName: "VelociousAttachment",
      attributes: [
        "byteSize",
        "contentType",
        "createdAt",
        "filename",
        "id",
        "name",
        "position",
        "recordId",
        "recordType",
        "updatedAt",
      ],
    }
  }

  /** @returns {VelociousAttachmentAttributes["byteSize"]} - Attribute value. */
  byteSize() { return /** @type {VelociousAttachmentAttributes["byteSize"]} */ (this.readAttribute("byteSize")) }

  /**
   * @param {VelociousAttachmentAttributes["byteSize"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["byteSize"] | null} - Assigned value.
   */
  setByteSize(newValue) { return /** @type {VelociousAttachmentAttributes["byteSize"] | null} */ (this.setAttribute("byteSize", newValue)) }

  /** @returns {VelociousAttachmentAttributes["contentType"]} - Attribute value. */
  contentType() { return /** @type {VelociousAttachmentAttributes["contentType"]} */ (this.readAttribute("contentType")) }

  /**
   * @param {VelociousAttachmentAttributes["contentType"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["contentType"] | null} - Assigned value.
   */
  setContentType(newValue) { return /** @type {VelociousAttachmentAttributes["contentType"] | null} */ (this.setAttribute("contentType", newValue)) }

  /** @returns {VelociousAttachmentAttributes["createdAt"]} - Attribute value. */
  createdAt() { return /** @type {VelociousAttachmentAttributes["createdAt"]} */ (this.readAttribute("createdAt")) }

  /**
   * @param {VelociousAttachmentAttributes["createdAt"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["createdAt"] | null} - Assigned value.
   */
  setCreatedAt(newValue) { return /** @type {VelociousAttachmentAttributes["createdAt"] | null} */ (this.setAttribute("createdAt", newValue)) }

  /** @returns {VelociousAttachmentAttributes["filename"]} - Attribute value. */
  filename() { return /** @type {VelociousAttachmentAttributes["filename"]} */ (this.readAttribute("filename")) }

  /**
   * @param {VelociousAttachmentAttributes["filename"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["filename"] | null} - Assigned value.
   */
  setFilename(newValue) { return /** @type {VelociousAttachmentAttributes["filename"] | null} */ (this.setAttribute("filename", newValue)) }

  /** @returns {VelociousAttachmentAttributes["id"]} - Attribute value. */
  id() { return /** @type {VelociousAttachmentAttributes["id"]} */ (this.readAttribute("id")) }

  /**
   * @param {VelociousAttachmentAttributes["id"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["id"] | null} - Assigned value.
   */
  setId(newValue) { return /** @type {VelociousAttachmentAttributes["id"] | null} */ (this.setAttribute("id", newValue)) }

  /** @returns {VelociousAttachmentAttributes["name"]} - Attribute value. */
  name() { return /** @type {VelociousAttachmentAttributes["name"]} */ (this.readAttribute("name")) }

  /**
   * @param {VelociousAttachmentAttributes["name"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["name"] | null} - Assigned value.
   */
  setName(newValue) { return /** @type {VelociousAttachmentAttributes["name"] | null} */ (this.setAttribute("name", newValue)) }

  /** @returns {VelociousAttachmentAttributes["position"]} - Attribute value. */
  position() { return /** @type {VelociousAttachmentAttributes["position"]} */ (this.readAttribute("position")) }

  /**
   * @param {VelociousAttachmentAttributes["position"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["position"] | null} - Assigned value.
   */
  setPosition(newValue) { return /** @type {VelociousAttachmentAttributes["position"] | null} */ (this.setAttribute("position", newValue)) }

  /** @returns {VelociousAttachmentAttributes["recordId"]} - Attribute value. */
  recordId() { return /** @type {VelociousAttachmentAttributes["recordId"]} */ (this.readAttribute("recordId")) }

  /**
   * @param {VelociousAttachmentAttributes["recordId"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["recordId"] | null} - Assigned value.
   */
  setRecordId(newValue) { return /** @type {VelociousAttachmentAttributes["recordId"] | null} */ (this.setAttribute("recordId", newValue)) }

  /** @returns {VelociousAttachmentAttributes["recordType"]} - Attribute value. */
  recordType() { return /** @type {VelociousAttachmentAttributes["recordType"]} */ (this.readAttribute("recordType")) }

  /**
   * @param {VelociousAttachmentAttributes["recordType"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["recordType"] | null} - Assigned value.
   */
  setRecordType(newValue) { return /** @type {VelociousAttachmentAttributes["recordType"] | null} */ (this.setAttribute("recordType", newValue)) }

  /** @returns {VelociousAttachmentAttributes["updatedAt"]} - Attribute value. */
  updatedAt() { return /** @type {VelociousAttachmentAttributes["updatedAt"]} */ (this.readAttribute("updatedAt")) }

  /**
   * @param {VelociousAttachmentAttributes["updatedAt"] | null} newValue - New attribute value.
   * @returns {VelociousAttachmentAttributes["updatedAt"] | null} - Assigned value.
   */
  setUpdatedAt(newValue) { return /** @type {VelociousAttachmentAttributes["updatedAt"] | null} */ (this.setAttribute("updatedAt", newValue)) }
}

FrontendModelBase.registerModel(VelociousAttachment)

export {VelociousAttachment}

export default VelociousAttachment
