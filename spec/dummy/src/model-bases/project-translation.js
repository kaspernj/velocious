import DatabaseRecord from "../../../../src/database/record/index.js"

/**
 * Attributes accepted when creating or updating ProjectTranslation records.
 * @typedef {object} ProjectTranslationWriteAttributes
 * @property {number} [id] - Value for the id attribute.
 * @property {number} [projectId] - Value for the projectId attribute.
 * @property {string} [locale] - Value for the locale attribute.
 * @property {string | null} [name] - Value for the name attribute.
 * @property {Date | string | null} [createdAt] - Value for the createdAt attribute.
 * @property {Date | string | null} [updatedAt] - Value for the updatedAt attribute.
 */

export default class ProjectTranslationBase extends DatabaseRecord {
  /**
   * Creates a ProjectTranslation record.
   * @template {typeof ProjectTranslationBase} T
   * @this {T}
   * @param {ProjectTranslationWriteAttributes} [attributes] - Attributes for the new record.
   * @returns {Promise<InstanceType<T>>} - Persisted record.
   */
  static async create(attributes) { return /** @type {Promise<InstanceType<T>>} */ (super.create(attributes)) }

  /**
   * Updates this ProjectTranslation record.
   * @param {ProjectTranslationWriteAttributes} attributes - Attributes to assign before saving.
   * @returns {Promise<void>} - Resolves when the record is saved.
   */
  async update(attributes) { return await super.update(attributes) }

  /**
   * @returns {typeof ProjectTranslationBase}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof ProjectTranslationBase} */ (this.constructor) }

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
   * @returns {string}
   */
  locale() { return this.readAttribute("locale") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setLocale(newValue) { return this._setColumnAttribute("locale", newValue) }

  /**
   * @returns {boolean}
   */
  hasLocale() { return this._hasAttribute(this.locale()) }

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
  Project() { return /** @type {import("../models/project.js").default} */ (this.getRelationshipByName("Project").loaded()) }

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
  ProjectOrLoad() { return /** @type {Promise<import("../models/project.js").default | undefined>} */ (this.relationshipOrLoad("Project", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/project.js").default} newModel
   * @returns {void}
   */
  setProject(newModel) { void newModel; throw new Error("Not implemented") }
}
