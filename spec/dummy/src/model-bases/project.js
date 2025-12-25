import DatabaseRecord from "../../../../src/database/record/index.js"

export default class ProjectBase extends DatabaseRecord {
  /**
   * @returns {typeof import("../models/project.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/project.js").default} */ (this.constructor) }

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
   * @returns {string | null}
   */
  creatingUserReference() { return this.readAttribute("creatingUserReference") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setCreatingUserReference(newValue) { return this._setColumnAttribute("creatingUserReference", newValue) }

  /**
   * @returns {boolean}
   */
  hasCreatingUserReference() { return this._hasAttribute(this.creatingUserReference()) }

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
   * @returns {string | null}
   */
  name() { return this._getTranslatedAttributeWithFallback("name", this._getConfiguration().getLocale()) }

  /**
   * @abstract
   * @returns {boolean}
   */
  hasName() { throw new Error("hasName not implemented") }

  /**
   * @returns {string | null}
   */
  nameDe() { return this._getTranslatedAttributeWithFallback("name", "de") }

  /**
   * @abstract
   * @returns {boolean}
   */
  hasNameDe() { throw new Error("hasNameDe not implemented") }

  /**
   * @returns {string | null}
   */
  nameEn() { return this._getTranslatedAttributeWithFallback("name", "en") }

  /**
   * @abstract
   * @returns {boolean}
   */
  hasNameEn() { throw new Error("hasNameEn not implemented") }

  /**
   * @returns {import("../models/user.js").default}
   */
  creatingUser() { return /** @type {import("../models/user.js").default} */ (this.getRelationshipByName("creatingUser").loaded()) }

  /**
   * @abstract
   * @param {Record<string, any>} [attributes]
   * @returns {import("../models/user.js").default}
   */
  buildCreatingUser(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadCreatingUser() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {import("../models/user.js").default} newModel
   * @returns {void}
   */
  setCreatingUser(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/task.js").default>}
   */
  tasks() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/task.js").default>} */ (this.getRelationshipByName("tasks")) }

  /**
   * @returns {Array<import("../models/task.js").default>}
   */
  tasksLoaded() { return /** @type {Array<import("../models/task.js").default>} */ (this.getRelationshipByName("tasks").loaded()) }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadTasks() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../models/task.js").default>} newModels
   * @returns {void}
   */
  setTasks(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("../models/project-detail.js").default}
   */
  projectDetail() { return /** @type {import("../models/project-detail.js").default} */ (this.getRelationshipByName("projectDetail").loaded()) }

  /**
   * @abstract
   * @param {Record<string, any>} [attributes]
   * @returns {import("../models/project-detail.js").default}
   */
  buildProjectDetail(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadProjectDetail() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {import("../models/project-detail.js").default} newModel
   * @returns {void}
   */
  setProjectDetail(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../../../../src/database/record/index.js").default>}
   */
  interactions() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../../../../src/database/record/index.js").default>} */ (this.getRelationshipByName("interactions")) }

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
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/comment.js").default>}
   */
  comments() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/comment.js").default>} */ (this.getRelationshipByName("comments")) }

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

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../model-bases/project-translation.js").default>}
   */
  translations() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../model-bases/project-translation.js").default>} */ (this.getRelationshipByName("translations")) }

  /**
   * @returns {Array<import("../model-bases/project-translation.js").default>}
   */
  translationsLoaded() { return /** @type {Array<import("../model-bases/project-translation.js").default>} */ (this.getRelationshipByName("translations").loaded()) }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  loadTranslations() { throw new Error("Not implemented") }

  /**
   * @abstract
   * @param {Array<import("../model-bases/project-translation.js").default>} newModels
   * @returns {void}
   */
  setTranslations(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
