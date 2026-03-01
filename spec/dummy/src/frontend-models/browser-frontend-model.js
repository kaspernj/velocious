import FrontendModelBase from "../../../../src/frontend-models/base.js"

/**
 * @typedef {object} BrowserFrontendModelAttributes
 * @property {any} id - Attribute value.
 * @property {any} email - Attribute value.
 * @property {any} createdAt - Attribute value.
 */
/** Frontend model for BrowserFrontendModel. */
export default class BrowserFrontendModel extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], commands: {destroy: string, find: string, index: string, update: string}, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      attributes: [
        "id",
        "email",
        "createdAt",
      ],
      commands: {
        destroy: "destroy",
        find: "frontend-find",
        index: "frontend-index",
        update: "update",
      },
      primaryKey: "id"
    }
  }

  /**
   * @returns {BrowserFrontendModelAttributes["id"]} - Attribute value.
   */
  id() { return this.readAttribute("id") }

  /**
   * @param {BrowserFrontendModelAttributes["id"]} newValue - New attribute value.
   * @returns {BrowserFrontendModelAttributes["id"]} - Assigned value.
   */
  setId(newValue) { return this.setAttribute("id", newValue) }

  /**
   * @returns {BrowserFrontendModelAttributes["email"]} - Attribute value.
   */
  email() { return this.readAttribute("email") }

  /**
   * @param {BrowserFrontendModelAttributes["email"]} newValue - New attribute value.
   * @returns {BrowserFrontendModelAttributes["email"]} - Assigned value.
   */
  setEmail(newValue) { return this.setAttribute("email", newValue) }

  /**
   * @returns {BrowserFrontendModelAttributes["createdAt"]} - Attribute value.
   */
  createdAt() { return this.readAttribute("createdAt") }

  /**
   * @param {BrowserFrontendModelAttributes["createdAt"]} newValue - New attribute value.
   * @returns {BrowserFrontendModelAttributes["createdAt"]} - Assigned value.
   */
  setCreatedAt(newValue) { return this.setAttribute("createdAt", newValue) }
}
