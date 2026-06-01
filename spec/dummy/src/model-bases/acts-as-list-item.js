import DatabaseRecord from "../../../../src/database/record/index.js"

export default class ActsAsListItemBase extends DatabaseRecord {
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
   * @param {Record<string, any>} [attributes]
   * @returns {import("../models/project.js").default}
   */
  buildProject(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<import("../models/project.js").default | undefined>}
   */
  loadProject() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/project.js").default | undefined>}
   */
  projectOrLoad() { return this.relationshipOrLoad("project") }

  /**
   * @abstract
   * @param {import("../models/project.js").default} newModel
   * @returns {void}
   */
  setProject(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
