import FrontendModelBase from "../../../../src/frontend-models/base.js"

/**
 * @typedef {object} UserAttributes
 * @property {any} email - Attribute value.
 * @property {any} id - Attribute value.
 * @property {any} name - Attribute value.
 */
/** Frontend model for User. */
export default class User extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], commands: {destroy: string, find: string, index: string, update: string}, path: string, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      attributes: ["email","id","name"],
      commands: {"destroy":"destroy","find":"find","index":"index","update":"update"},
      path: "/api/frontend-models/users",
      primaryKey: "id"
    }
  }

  /**
   * @returns {Promise<number>} - Number of records matching the current query scope.
   */
  static async count() {
    return await this.query().count()
  }

  /**
   * @returns {UserAttributes["email"]} - Attribute value.
   */
  email() { return this.readAttribute("email") }

  /**
   * @param {UserAttributes["email"]} newValue - New attribute value.
   * @returns {UserAttributes["email"]} - Assigned value.
   */
  setEmail(newValue) { return this.setAttribute("email", newValue) }

  /**
   * @returns {UserAttributes["id"]} - Attribute value.
   */
  id() { return this.readAttribute("id") }

  /**
   * @param {UserAttributes["id"]} newValue - New attribute value.
   * @returns {UserAttributes["id"]} - Assigned value.
   */
  setId(newValue) { return this.setAttribute("id", newValue) }

  /**
   * @returns {UserAttributes["name"]} - Attribute value.
   */
  name() { return this.readAttribute("name") }

  /**
   * @param {UserAttributes["name"]} newValue - New attribute value.
   * @returns {UserAttributes["name"]} - Assigned value.
   */
  setName(newValue) { return this.setAttribute("name", newValue) }
}
