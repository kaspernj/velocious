import DatabaseRecord from "../../../../src/database/record/index.js"

/**
 * Attributes accepted when creating or updating ActsAsListItem records.
 * @typedef {object} ActsAsListItemWriteAttributes
 * @property {number} [id] - Value for the id attribute.
 * @property {number} [projectId] - Value for the projectId attribute.
 * @property {number | null} [position] - Value for the position attribute.
 * @property {string | null} [name] - Value for the name attribute.
 * @property {Date | string | null} [createdAt] - Value for the createdAt attribute.
 * @property {Date | string | null} [updatedAt] - Value for the updatedAt attribute.
 */

export default class ActsAsListItemBase extends DatabaseRecord {
  /**
   * Creates a ActsAsListItem record.
   * @template {typeof ActsAsListItemBase} T
   * @this {T}
   * @param {ActsAsListItemWriteAttributes} [attributes] - Attributes for the new record.
   * @returns {Promise<InstanceType<T>>} - Persisted record.
   */
  static async create(attributes) { return /** @type {Promise<InstanceType<T>>} */ (super.create(attributes)) }

  /**
   * Updates this ActsAsListItem record.
   * @param {ActsAsListItemWriteAttributes} attributes - Attributes to assign before saving.
   * @returns {Promise<void>} - Resolves when the record is saved.
   */
  async update(attributes) { return await super.update(attributes) }

  /**
   * @returns {typeof import("../models/acts-as-list-item.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/acts-as-list-item.js").default} */ (this.constructor) }

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
   * @returns {number}
   */
  projectId() { return this.readAttribute("projectId") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setProjectId(newValue) { return this._setColumnAttribute("projectId", newValue) }

  /**
   * @returns {boolean}
   */
  hasProjectId() { return this._hasAttribute(this.projectId()) }

  /**
   * @returns {number | null}
   */
  position() { return this.readAttribute("position") }

  /**
   * @param {number | null} newValue
   * @returns {void}
   */
  setPosition(newValue) { return this._setColumnAttribute("position", newValue) }

  /**
   * @returns {boolean}
   */
  hasPosition() { return this._hasAttribute(this.position()) }

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
   * @returns {import("../models/project.js").default}
   */
  project() { return /** @type {import("../models/project.js").default} */ (this.getRelationshipByName("project").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../models/project.js").default}
   */
  buildProject(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../models/project.js").default | undefined>}
   */
  loadProject() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/project.js").default | undefined>}
   */
  projectOrLoad() { return /** @type {Promise<import("../models/project.js").default | undefined>} */ (this.relationshipOrLoad("project", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/project.js").default} newModel
   * @returns {void}
   */
  setProject(newModel) { void newModel; throw new Error("Not implemented") }
}
