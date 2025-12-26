import DatabaseRecord from "../../../../src/database/record/index.js"

export default class UuidItemBase extends DatabaseRecord {
  /**
   * @returns {typeof import("../models/uuid-item.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/uuid-item.js").default} */ (this.constructor) }

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
  title() { return this.readAttribute("title") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setTitle(newValue) { return this._setColumnAttribute("title", newValue) }

  /**
   * @returns {boolean}
   */
  hasTitle() { return this._hasAttribute(this.title()) }

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
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/uuid-item.js").default, typeof import("../../../../src/database/record/index.js").default>}
   */
  uuidInteractions() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/uuid-item.js").default, typeof import("../../../../src/database/record/index.js").default>} */ (this.getRelationshipByName("uuidInteractions")) }

  /**
   * @returns {Array<import("../../../../src/database/record/index.js").default>}
   */
  uuidInteractionsLoaded() { return /** @type {Array<import("../../../../src/database/record/index.js").default>} */ (this.getRelationshipByName("uuidInteractions").loaded()) }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadUuidInteractions() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../../../../src/database/record/index.js").default>} newModels
   * @returns {void}
   */
  setUuidInteractions(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
