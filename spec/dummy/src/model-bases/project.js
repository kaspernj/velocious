import DatabaseRecord from "../../../../src/database/record/index.js"

/**
 * Attributes accepted when creating or updating Project records.
 * @typedef {object} ProjectWriteAttributes
 * @property {number} [id] - Value for the id attribute.
 * @property {string | null} [creatingUserReference] - Value for the creatingUserReference attribute.
 * @property {Date | string | null} [createdAt] - Value for the createdAt attribute.
 * @property {Date | string | null} [updatedAt] - Value for the updatedAt attribute.
 * @property {number} [tasksCount] - Value for the tasksCount attribute.
 * @property {Array<import("./task.js").TaskWriteAttributes & {_destroy?: boolean}>} [tasksAttributes] - Nested tasks attributes.
 * @property {Array<import("./interaction.js").InteractionWriteAttributes & {_destroy?: boolean}>} [interactionsAttributes] - Nested interactions attributes.
 */

export default class ProjectBase extends DatabaseRecord {
  /**
   * Type anchor for inherited write methods.
   * @type {ProjectWriteAttributes | undefined}
   */
  _writeAttributesType = undefined

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
   * @returns {number}
   */
  tasksCount() { return this.readAttribute("tasksCount") }

  /**
   * @param {number} newValue
   * @returns {void}
   */
  setTasksCount(newValue) { return this._setColumnAttribute("tasksCount", newValue) }

  /**
   * @returns {boolean}
   */
  hasTasksCount() { return this._hasAttribute(this.tasksCount()) }

  /**
   * @returns {string | null}
   */
  name() { return this._getTranslatedAttributeWithFallback("name", this._getConfiguration().getLocale()) ?? null }

  /**
   * @abstract
   * @returns {boolean}
   */
  hasName() { throw new Error("hasName not implemented") }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setName(newValue) { return this._setTranslatedAttribute("name", this._getConfiguration().getLocale(), newValue) }

  /**
   * @returns {string | null}
   */
  nameDe() { return this._getTranslatedAttributeWithFallback("name", "de") ?? null }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setNameDe(newValue) { return this._setTranslatedAttribute("name", "de", newValue) }

  /**
   * @abstract
   * @returns {boolean}
   */
  hasNameDe() { throw new Error("hasNameDe not implemented") }

  /**
   * @returns {string | null}
   */
  nameEn() { return this._getTranslatedAttributeWithFallback("name", "en") ?? null }

  /**
   * @param {string} newValue
   * @returns {void}
   */
  setNameEn(newValue) { return this._setTranslatedAttribute("name", "en", newValue) }

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
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../models/user.js").default}
   */
  buildCreatingUser(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../models/user.js").default | undefined>}
   */
  loadCreatingUser() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/user.js").default | undefined>}
   */
  creatingUserOrLoad() { return /** @type {Promise<import("../models/user.js").default | undefined>} */ (this.relationshipOrLoad("creatingUser", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/user.js").default} newModel
   * @returns {void}
   */
  setCreatingUser(newModel) { void newModel; throw new Error("Not implemented") }

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
   * @returns {Promise<Array<import("../models/task.js").default>>}
   */
  loadTasks() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<Array<import("../models/task.js").default>>}
   */
  tasksOrLoad() { return /** @type {Promise<Array<import("../models/task.js").default>>} */ (this.relationshipOrLoad("tasks")) }

  /**
   * @abstract
   * @param {Array<import("../models/task.js").default>} newModels
   * @returns {void}
   */
  setTasks(newModels) { void newModels; throw new Error("Not implemented") }

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/task.js").default>}
   */
  doneTasks() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/task.js").default>} */ (this.getRelationshipByName("doneTasks")) }

  /**
   * @returns {Array<import("../models/task.js").default>}
   */
  doneTasksLoaded() { return /** @type {Array<import("../models/task.js").default>} */ (this.getRelationshipByName("doneTasks").loaded()) }

  /**
   * @abstract
   * @returns {Promise<Array<import("../models/task.js").default>>}
   */
  loadDoneTasks() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<Array<import("../models/task.js").default>>}
   */
  doneTasksOrLoad() { return /** @type {Promise<Array<import("../models/task.js").default>>} */ (this.relationshipOrLoad("doneTasks")) }

  /**
   * @abstract
   * @param {Array<import("../models/task.js").default>} newModels
   * @returns {void}
   */
  setDoneTasks(newModels) { void newModels; throw new Error("Not implemented") }

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/task.js").default>}
   */
  reviewTasks() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/task.js").default>} */ (this.getRelationshipByName("reviewTasks")) }

  /**
   * @returns {Array<import("../models/task.js").default>}
   */
  reviewTasksLoaded() { return /** @type {Array<import("../models/task.js").default>} */ (this.getRelationshipByName("reviewTasks").loaded()) }

  /**
   * @abstract
   * @returns {Promise<Array<import("../models/task.js").default>>}
   */
  loadReviewTasks() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<Array<import("../models/task.js").default>>}
   */
  reviewTasksOrLoad() { return /** @type {Promise<Array<import("../models/task.js").default>>} */ (this.relationshipOrLoad("reviewTasks")) }

  /**
   * @abstract
   * @param {Array<import("../models/task.js").default>} newModels
   * @returns {void}
   */
  setReviewTasks(newModels) { void newModels; throw new Error("Not implemented") }

  /**
   * @returns {import("../models/project-detail.js").default}
   */
  projectDetail() { return /** @type {import("../models/project-detail.js").default} */ (this.getRelationshipByName("projectDetail").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../models/project-detail.js").default}
   */
  buildProjectDetail(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../models/project-detail.js").default | undefined>}
   */
  loadProjectDetail() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/project-detail.js").default | undefined>}
   */
  projectDetailOrLoad() { return /** @type {Promise<import("../models/project-detail.js").default | undefined>} */ (this.relationshipOrLoad("projectDetail", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/project-detail.js").default} newModel
   * @returns {void}
   */
  setProjectDetail(newModel) { void newModel; throw new Error("Not implemented") }

  /**
   * @returns {import("../models/project-detail.js").default}
   */
  activeProjectDetail() { return /** @type {import("../models/project-detail.js").default} */ (this.getRelationshipByName("activeProjectDetail").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../models/project-detail.js").default}
   */
  buildActiveProjectDetail(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../models/project-detail.js").default | undefined>}
   */
  loadActiveProjectDetail() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/project-detail.js").default | undefined>}
   */
  activeProjectDetailOrLoad() { return /** @type {Promise<import("../models/project-detail.js").default | undefined>} */ (this.relationshipOrLoad("activeProjectDetail", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/project-detail.js").default} newModel
   * @returns {void}
   */
  setActiveProjectDetail(newModel) { void newModel; throw new Error("Not implemented") }

  /**
   * @returns {import("../models/task.js").default}
   */
  reviewTask() { return /** @type {import("../models/task.js").default} */ (this.getRelationshipByName("reviewTask").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../models/task.js").default}
   */
  buildReviewTask(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../models/task.js").default | undefined>}
   */
  loadReviewTask() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../models/task.js").default | undefined>}
   */
  reviewTaskOrLoad() { return /** @type {Promise<import("../models/task.js").default | undefined>} */ (this.relationshipOrLoad("reviewTask", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../models/task.js").default} newModel
   * @returns {void}
   */
  setReviewTask(newModel) { void newModel; throw new Error("Not implemented") }

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
   * @returns {Promise<Array<import("../../../../src/database/record/index.js").default>>}
   */
  loadInteractions() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<Array<import("../../../../src/database/record/index.js").default>>}
   */
  interactionsOrLoad() { return /** @type {Promise<Array<import("../../../../src/database/record/index.js").default>>} */ (this.relationshipOrLoad("interactions")) }

  /**
   * @abstract
   * @param {Array<import("../../../../src/database/record/index.js").default>} newModels
   * @returns {void}
   */
  setInteractions(newModels) { void newModels; throw new Error("Not implemented") }

  /**
   * @returns {import("velocious/build/src/database/record/index.js").default}
   */
  primaryInteraction() { return /** @type {import("velocious/build/src/database/record/index.js").default} */ (this.getRelationshipByName("primaryInteraction").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("velocious/build/src/database/record/index.js").default}
   */
  buildPrimaryInteraction(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("velocious/build/src/database/record/index.js").default | undefined>}
   */
  loadPrimaryInteraction() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("velocious/build/src/database/record/index.js").default | undefined>}
   */
  primaryInteractionOrLoad() { return /** @type {Promise<import("velocious/build/src/database/record/index.js").default | undefined>} */ (this.relationshipOrLoad("primaryInteraction", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("velocious/build/src/database/record/index.js").default} newModel
   * @returns {void}
   */
  setPrimaryInteraction(newModel) { void newModel; throw new Error("Not implemented") }

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
   * @returns {Promise<Array<import("../models/comment.js").default>>}
   */
  loadComments() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<Array<import("../models/comment.js").default>>}
   */
  commentsOrLoad() { return /** @type {Promise<Array<import("../models/comment.js").default>>} */ (this.relationshipOrLoad("comments")) }

  /**
   * @abstract
   * @param {Array<import("../models/comment.js").default>} newModels
   * @returns {void}
   */
  setComments(newModels) { void newModels; throw new Error("Not implemented") }

  /**
   * @returns {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/comment.js").default>}
   */
  commentsThroughTasks() { return /** @type {import("../../../../src/database/record/instance-relationships/has-many.js").default<typeof import("../models/project.js").default, typeof import("../models/comment.js").default>} */ (this.getRelationshipByName("commentsThroughTasks")) }

  /**
   * @returns {Array<import("../models/comment.js").default>}
   */
  commentsThroughTasksLoaded() { return /** @type {Array<import("../models/comment.js").default>} */ (this.getRelationshipByName("commentsThroughTasks").loaded()) }

  /**
   * @abstract
   * @returns {Promise<Array<import("../models/comment.js").default>>}
   */
  loadCommentsThroughTasks() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<Array<import("../models/comment.js").default>>}
   */
  commentsThroughTasksOrLoad() { return /** @type {Promise<Array<import("../models/comment.js").default>>} */ (this.relationshipOrLoad("commentsThroughTasks")) }

  /**
   * @abstract
   * @param {Array<import("../models/comment.js").default>} newModels
   * @returns {void}
   */
  setCommentsThroughTasks(newModels) { void newModels; throw new Error("Not implemented") }

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
   * @returns {Promise<Array<import("../model-bases/project-translation.js").default>>}
   */
  loadTranslations() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<Array<import("../model-bases/project-translation.js").default>>}
   */
  translationsOrLoad() { return /** @type {Promise<Array<import("../model-bases/project-translation.js").default>>} */ (this.relationshipOrLoad("translations")) }

  /**
   * @abstract
   * @param {Array<import("../model-bases/project-translation.js").default>} newModels
   * @returns {void}
   */
  setTranslations(newModels) { void newModels; throw new Error("Not implemented") }

  /**
   * @returns {import("../model-bases/project-translation.js").default}
   */
  currentTranslation() { return /** @type {import("../model-bases/project-translation.js").default} */ (this.getRelationshipByName("currentTranslation").loaded()) }

  /**
   * @abstract
   * @param {Record<string, ?>} [attributes]
   * @returns {import("../model-bases/project-translation.js").default}
   */
  buildCurrentTranslation(attributes) { void attributes; throw new Error("Not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../model-bases/project-translation.js").default | undefined>}
   */
  loadCurrentTranslation() { throw new Error("Not implemented") }

  /**
   * @returns {Promise<import("../model-bases/project-translation.js").default | undefined>}
   */
  currentTranslationOrLoad() { return /** @type {Promise<import("../model-bases/project-translation.js").default | undefined>} */ (this.relationshipOrLoad("currentTranslation", {preloadTranslations: true})) }

  /**
   * @abstract
   * @param {import("../model-bases/project-translation.js").default} newModel
   * @returns {void}
   */
  setCurrentTranslation(newModel) { void newModel; throw new Error("Not implemented") }
}
