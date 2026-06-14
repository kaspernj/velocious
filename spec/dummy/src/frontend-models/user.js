import FrontendModelBase from "../../../../src/frontend-models/base.js"

/**
 * Frontend model resource config.
 * @typedef {import("../../../../src/frontend-models/base.js").FrontendModelResourceConfig} FrontendModelResourceConfig
 */

/**
 * UserAttributes type.
 * @typedef {object} UserAttributes
 * @property {any} reference - Attribute value.
 * @property {any} email - Attribute value.
 */
/**
 * Attributes accepted by UserCreateAttributes.
 * @typedef {object} UserCreateAttributes
 */
/**
 * Attributes accepted by UserUpdateAttributes.
 * @typedef {object} UserUpdateAttributes
 */
/** Frontend model for User. */
export default class User extends FrontendModelBase {
  /** @returns {FrontendModelResourceConfig} - Resource config. */
  static resourceConfig() {
    return {
      modelName: "User",
      attributes: [
        "reference",
        "email",
      ],
      primaryKey: "reference",
    }
  }

  /** @returns {UserAttributes["reference"]} - Attribute value. */
  reference() { return /** @type {UserAttributes["reference"]} */ (this.readAttribute("reference")) }

  /**
   * @param {UserAttributes["reference"]} newValue - New attribute value.
   * @returns {UserAttributes["reference"]} - Assigned value.
   */
  setReference(newValue) { return /** @type {UserAttributes["reference"]} */ (this.setAttribute("reference", newValue)) }

  /** @returns {UserAttributes["email"]} - Attribute value. */
  email() { return /** @type {UserAttributes["email"]} */ (this.readAttribute("email")) }

  /**
   * @param {UserAttributes["email"]} newValue - New attribute value.
   * @returns {UserAttributes["email"]} - Assigned value.
   */
  setEmail(newValue) { return /** @type {UserAttributes["email"]} */ (this.setAttribute("email", newValue)) }
}

FrontendModelBase.registerModel(User)
