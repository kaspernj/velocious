import DatabaseRecord from "../../../../src/database/record/index.js"

export default class AuthenticationTokenBase extends DatabaseRecord {
  /**
   * @returns {typeof import("../models/authentication-token.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/authentication-token.js").default} */ (this.constructor) }

  /**
   * @returns {number}
   */
  id() { return this.readAttribute("id") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setId(newValue) { return this._setColumnAttribute("id", newValue) }

  /**
   * @returns {boolean}
   */
  hasId() { return this._hasAttribute(this.id()) }

  /**
   * @returns {string | null}
   */
  userToken() { return this.readAttribute("userToken") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setUserToken(newValue) { return this._setColumnAttribute("userToken", newValue) }

  /**
   * @returns {boolean}
   */
  hasUserToken() { return this._hasAttribute(this.userToken()) }

  /**
   * @returns {number | null}
   */
  userId() { return this.readAttribute("userId") }

  /**
   * @param {number | null} newValue
   * @returns {void}
   */
  setUserId(newValue) { return this._setColumnAttribute("userId", newValue) }

  /**
   * @returns {boolean}
   */
  hasUserId() { return this._hasAttribute(this.userId()) }

  /**
   * @returns {Date | null}
   */
  createdAt() { return this.readAttribute("createdAt") }

  /**
   * @param {Date | null} newValue
   * @returns {void}
   */
  setCreatedAt(newValue) { return this._setColumnAttribute("createdAt", newValue) }

  /**
   * @returns {boolean}
   */
  hasCreatedAt() { return this._hasAttribute(this.createdAt()) }

  /**
   * @returns {Date | null}
   */
  updatedAt() { return this.readAttribute("updatedAt") }

  /**
   * @param {Date | null} newValue
   * @returns {void}
   */
  setUpdatedAt(newValue) { return this._setColumnAttribute("updatedAt", newValue) }

  /**
   * @returns {boolean}
   */
  hasUpdatedAt() { return this._hasAttribute(this.updatedAt()) }

  /**
   * @returns {import("../models/user.js").default}
   */
  user() { return /** @type {import("../models/user.js").default} */ (this.getRelationshipByName("user").loaded()) }

  /**
   * @abstract
   * @param {Record<string, any>} [attributes]
   * @returns {import("../models/user.js").default}
   */
  buildUser(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadUser() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {import("../models/user.js").default} newModel
   * @returns {void}
   */
  setUser(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
