import DatabaseRecord from "../../../../src/database/record/index.js"

/**
 * Attributes accepted when creating or updating UuidInteraction records.
 * @typedef {object} UuidInteractionWriteAttributes
 * @property {number} [id] - Value for the id attribute.
 * @property {string} [subjectId] - Value for the subjectId attribute.
 * @property {string | null} [subjectType] - Value for the subjectType attribute.
 * @property {string | null} [kind] - Value for the kind attribute.
 * @property {Date | string | null} [createdAt] - Value for the createdAt attribute.
 * @property {Date | string | null} [updatedAt] - Value for the updatedAt attribute.
 */

export default class UuidInteractionBase extends DatabaseRecord {
  /**
   * Type anchor for inherited write methods.
   * @type {UuidInteractionWriteAttributes | undefined}
   */
  _writeAttributesType = undefined

  /**
   * @returns {typeof import("../models/uuid-interaction.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/uuid-interaction.js").default} */ (this.constructor) }

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
  subjectId() { return this.readAttribute("subjectId") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setSubjectId(newValue) { return this._setColumnAttribute("subjectId", newValue) }

  /**
   * @returns {boolean}
   */
  hasSubjectId() { return this._hasAttribute(this.subjectId()) }

  /**
   * @returns {string | null}
   */
  subjectType() { return this.readAttribute("subjectType") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setSubjectType(newValue) { return this._setColumnAttribute("subjectType", newValue) }

  /**
   * @returns {boolean}
   */
  hasSubjectType() { return this._hasAttribute(this.subjectType()) }

  /**
   * @returns {string | null}
   */
  kind() { return this.readAttribute("kind") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setKind(newValue) { return this._setColumnAttribute("kind", newValue) }

  /**
   * @returns {boolean}
   */
  hasKind() { return this._hasAttribute(this.kind()) }

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
   * @returns {import("velocious/build/src/database/record/index.js").default}
   */
  subject() { return /** @type {import("velocious/build/src/database/record/index.js").default} */ (this.getRelationshipByName("subject").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("velocious/build/src/database/record/index.js").default}
   */
  buildSubject(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("velocious/build/src/database/record/index.js").default | undefined>}
   */
  loadSubject() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("velocious/build/src/database/record/index.js").default | undefined>}
   */
  subjectOrLoad() { return /** @type {Promise<import("velocious/build/src/database/record/index.js").default | undefined>} */ (this.relationshipOrLoad("subject", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("velocious/build/src/database/record/index.js").default} newModel
   * @returns {void}
   */
  setSubject(newModel) { void newModel; throw new Error("Not implemented") }
}
