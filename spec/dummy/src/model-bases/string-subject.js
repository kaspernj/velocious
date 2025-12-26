import DatabaseRecord from "../../../../src/database/record/index.js"

export default class StringSubjectBase extends DatabaseRecord {
  /**
   * @returns {typeof import("../models/string-subject.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/string-subject.js").default} */ (this.constructor) }

  /**
   * @returns {string}
   */
  id() { return this.readAttribute("id") }

  /**
   * @param {string} newValue
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
  name() { return this.readAttribute("name") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setName(newValue) { return this._setColumnAttribute("name", newValue) }

  /**
   * @returns {boolean}
   */
  hasName() { return this._hasAttribute(this.name()) }

  /**
   * @returns {Date | null}
   */
  createdAt() { return this.readAttribute("createdAt") }

  /**
   * @param {Date | string | null} newValue
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
   * @param {Date | string | null} newValue
   * @returns {void}
   */
  setUpdatedAt(newValue) { return this._setColumnAttribute("updatedAt", newValue) }

  /**
   * @returns {boolean}
   */
  hasUpdatedAt() { return this._hasAttribute(this.updatedAt()) }

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/string-subject.js").default, typeof import("../../../../src/database/record/index.js").default>}
   */
  stringSubjectInteractions() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/string-subject.js").default, typeof import("../../../../src/database/record/index.js").default>} */ (this.getRelationshipByName("stringSubjectInteractions")) }

  /**
   * @returns {Array<import("../../../../src/database/record/index.js").default>}
   */
  stringSubjectInteractionsLoaded() { return /** @type {Array<import("../../../../src/database/record/index.js").default>} */ (this.getRelationshipByName("stringSubjectInteractions").loaded()) }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadStringSubjectInteractions() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../../../../src/database/record/index.js").default>} newModels
   * @returns {void}
   */
  setStringSubjectInteractions(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
