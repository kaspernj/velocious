import Record from "../../../../src/database/record/index.js"

export default class ProjectDetailBase extends Record {
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

  note() { return this.readAttribute("note") }

  setNote(newValue) { return this._setColumnAttribute("note", newValue) }

  /**
   * @returns {boolean}
   */
  hasNote() { return this._hasAttribute(this.note()) }

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
   * @interface
   * @returns {import("../models/project.js").default}
   */
  project() { return this.getRelationshipByName("project").loaded() }

  /**
   * @interface
   * @param {Record<string, any>} attributes
   * @returns {import("../models/project.js").default}
   */
  buildProject(attributes) { throw new Error("Not implemented") }

  /**
   * @interface
   * @returns {Promise<void>}
   */
  loadProject() { throw new Error("Not implemented") }

  /**
   * @interface
   * @param {import("../models/project.js").default} newModel
   * @returns {void}
   */
  setProject() { throw new Error("Not implemented") }
}
