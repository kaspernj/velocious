import FrontendModelBase from "../../../../src/frontend-models/base.js"

/**
 * @typedef {object} UserAttributes
 * @property {any} reference - Attribute value.
 * @property {any} email - Attribute value.
 */
/** Frontend model for User. */
export default class User extends FrontendModelBase {
  /** @returns {{attachments?: Record<string, {type: "hasOne" | "hasMany"}>, attributes: string[], collectionCommands?: {create: string, index: string}, memberCommands?: {destroy: string, find: string, update: string}}} - Resource config. */
  static resourceConfig() {
    return {
      attributes: [
        "reference",
        "email",
      ],
      primaryKey: "reference",
    }
  }

  /** @returns {UserAttributes["reference"]} - Attribute value. */
  reference() { return this.readAttribute("reference") }

  /**
   * @param {UserAttributes["reference"]} newValue - New attribute value.
   * @returns {UserAttributes["reference"]} - Assigned value.
   */
  setReference(newValue) { return this.setAttribute("reference", newValue) }

  /** @returns {UserAttributes["email"]} - Attribute value. */
  email() { return this.readAttribute("email") }

  /**
   * @param {UserAttributes["email"]} newValue - New attribute value.
   * @returns {UserAttributes["email"]} - Assigned value.
   */
  setEmail(newValue) { return this.setAttribute("email", newValue) }
}
