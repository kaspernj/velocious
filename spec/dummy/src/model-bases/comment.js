import DatabaseRecord from "../../../../src/database/record/index.js"

export default class CommentBase extends DatabaseRecord {
  /**
   * @returns {typeof import("../models/comment.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/comment.js").default} */ (this.constructor) }

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
  taskId() { return this.readAttribute("taskId") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setTaskId(newValue) { return this._setColumnAttribute("taskId", newValue) }

  /**
   * @returns {boolean}
   */
  hasTaskId() { return this._hasAttribute(this.taskId()) }

  /**
   * @returns {string | null}
   */
  body() { return this.readAttribute("body") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setBody(newValue) { return this._setColumnAttribute("body", newValue) }

  /**
   * @returns {boolean}
   */
  hasBody() { return this._hasAttribute(this.body()) }

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
   * @returns {import("../models/task.js").default}
   */
  task() { return /** @type {import("../models/task.js").default} */ (this.getRelationshipByName("task").loaded()) }

  /**
   * @abstract
   * @param {Record<string, any>} [attributes]
   * @returns {import("../models/task.js").default}
   */
  buildTask(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadTask() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {import("../models/task.js").default} newModel
   * @returns {void}
   */
  setTask(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
