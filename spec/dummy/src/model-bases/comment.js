import DatabaseRecord from "../../../../src/database/record/index.js"

/**
 * Attributes accepted when creating or updating Comment records.
 * @typedef {object} CommentWriteAttributes
 * @property {number} [id] - Value for the id attribute.
 * @property {number} [taskId] - Value for the taskId attribute.
 * @property {string | null} [body] - Value for the body attribute.
 * @property {Date | string | null} [createdAt] - Value for the createdAt attribute.
 * @property {Date | string | null} [updatedAt] - Value for the updatedAt attribute.
 */

export default class CommentBase extends DatabaseRecord {
  /**
   * Type anchor for inherited write methods.
   * @type {CommentWriteAttributes | undefined}
   */
  _writeAttributesType = undefined

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
   * @returns {import("../models/task.js").default}
   */
  task() { return /** @type {import("../models/task.js").default} */ (this.getRelationshipByName("task").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../models/task.js").default}
   */
  buildTask(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../models/task.js").default | undefined>}
   */
  loadTask() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/task.js").default | undefined>}
   */
  taskOrLoad() { return /** @type {Promise<import("../models/task.js").default | undefined>} */ (this.relationshipOrLoad("task", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/task.js").default} newModel
   * @returns {void}
   */
  setTask(newModel) { void newModel; throw new Error("Not implemented") }

  /**
   * @returns {import("../models/task.js").default}
   */
  doneTask() { return /** @type {import("../models/task.js").default} */ (this.getRelationshipByName("doneTask").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../models/task.js").default}
   */
  buildDoneTask(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../models/task.js").default | undefined>}
   */
  loadDoneTask() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/task.js").default | undefined>}
   */
  doneTaskOrLoad() { return /** @type {Promise<import("../models/task.js").default | undefined>} */ (this.relationshipOrLoad("doneTask", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/task.js").default} newModel
   * @returns {void}
   */
  setDoneTask(newModel) { void newModel; throw new Error("Not implemented") }
}
