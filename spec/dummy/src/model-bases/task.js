import DatabaseRecord from "../../../../src/database/record/index.js"

export default class TaskBase extends DatabaseRecord {
  /**
   * @returns {typeof import("../models/task.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/task.js").default} */ (this.constructor) }

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
   * @returns {string | null}
   */
  description() { return this.readAttribute("description") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setDescription(newValue) { return this._setColumnAttribute("description", newValue) }

  /**
   * @returns {boolean}
   */
  hasDescription() { return this._hasAttribute(this.description()) }

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
   * @returns {boolean | null}
   */
  isDone() { return this.readAttribute("isDone") }

  /**
   * @param {boolean | null} newValue
   * @returns {void}
   */
  setIsDone(newValue) { return this._setColumnAttribute("isDone", newValue) }

  /**
   * @returns {boolean}
   */
  hasIsDone() { return this._hasAttribute(this.isDone()) }

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
   * @returns {Promise<void>}
   */
  loadProject() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {import("../models/project.js").default} newModel
   * @returns {void}
   */
  setProject(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/task.js").default, typeof import("../../../../src/database/record/index.js").default>}
   */
  interactions() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/task.js").default, typeof import("../../../../src/database/record/index.js").default>} */ (this.getRelationshipByName("interactions")) }

  /**
   * @returns {Array<import("../../../../src/database/record/index.js").default>}
   */
  interactionsLoaded() { return /** @type {Array<import("../../../../src/database/record/index.js").default>} */ (this.getRelationshipByName("interactions").loaded()) }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadInteractions() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../../../../src/database/record/index.js").default>} newModels
   * @returns {void}
   */
  setInteractions(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("velocious/build/src/database/record/index.js").default}
   */
  primaryInteraction() { return /** @type {import("velocious/build/src/database/record/index.js").default} */ (this.getRelationshipByName("primaryInteraction").loaded()) }

  /**
   * @abstract
   * @param {Record<string, any>} [attributes]
   * @returns {import("velocious/build/src/database/record/index.js").default}
   */
  buildPrimaryInteraction(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadPrimaryInteraction() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {import("velocious/build/src/database/record/index.js").default} newModel
   * @returns {void}
   */
  setPrimaryInteraction(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/task.js").default, typeof import("../models/comment.js").default>}
   */
  comments() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/task.js").default, typeof import("../models/comment.js").default>} */ (this.getRelationshipByName("comments")) }

  /**
   * @returns {Array<import("../models/comment.js").default>}
   */
  commentsLoaded() { return /** @type {Array<import("../models/comment.js").default>} */ (this.getRelationshipByName("comments").loaded()) }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadComments() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../models/comment.js").default>} newModels
   * @returns {void}
   */
  setComments(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
