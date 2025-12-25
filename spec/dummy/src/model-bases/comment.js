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
}
