import Record from "../../../../src/database/record/index.js"

export default class UserBase extends Record {
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
   * @returns {string}
   */
  email() { return this.readAttribute("email") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setEmail(newValue) { return this._setColumnAttribute("email", newValue) }

  /**
   * @returns {boolean}
   */
  hasEmail() { return this._hasAttribute(this.email()) }

  /**
   * @returns {string}
   */
  encryptedPassword() { return this.readAttribute("encryptedPassword") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setEncryptedPassword(newValue) { return this._setColumnAttribute("encryptedPassword", newValue) }

  /**
   * @returns {boolean}
   */
  hasEncryptedPassword() { return this._hasAttribute(this.encryptedPassword()) }

  /**
   * @returns {string | null}
   */
  reference() { return this.readAttribute("reference") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setReference(newValue) { return this._setColumnAttribute("reference", newValue) }

  /**
   * @returns {boolean}
   */
  hasReference() { return this._hasAttribute(this.reference()) }

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
   * @returns {import("../models/project.js").default}
   */
  createdProject() { return this.getRelationshipByName("createdProject").loaded() }

  /**
   * @abstract
   * @param {Record<string, any>} attributes
   * @returns {import("../models/project.js").default}
   */
  buildCreatedProject(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadCreatedProject() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {import("../models/project.js").default} newModel
   * @returns {void}
   */
  setCreatedProject(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("velocious/src/database/query/index.js").default<import("../models/authentication-token.js").default>}
   */
  authenticationTokens() { return this.getRelationshipByName("authenticationTokens") }

  /**
   * @returns {Array<import("../models/authentication-token.js").default>}
   */
  authenticationTokensLoaded() { return this.getRelationshipByName("authenticationTokens").loaded() }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadAuthenticationTokens() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../models/authentication-token.js").default>} newModels
   * @returns {void}
   */
  setAuthenticationTokens(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("velocious/src/database/query/index.js").default<import("../models/project.js").default>}
   */
  createdProjects() { return this.getRelationshipByName("createdProjects") }

  /**
   * @returns {Array<import("../models/project.js").default>}
   */
  createdProjectsLoaded() { return this.getRelationshipByName("createdProjects").loaded() }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadCreatedProjects() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../models/project.js").default>} newModels
   * @returns {void}
   */
  setCreatedProjects(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
