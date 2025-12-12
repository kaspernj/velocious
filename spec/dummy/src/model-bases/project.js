import Record from "../../../../src/database/record/index.js"

export default class ProjectBase extends Record {
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
   * @returns {string | null}
   */
  nameDe() { return this._getTranslatedAttributeWithFallback("name", "de") }

  /**
   * @returns {string | null}
   */
  nameEn() { return this._getTranslatedAttributeWithFallback("name", "en") }

  /**
   * @interface
   * @returns {import("../models/user.js").default}
   */
  creatingUser() { return this.getRelationshipByName("creatingUser").loaded() }

  /**
   * @interface
   * @param {Record<string, any>} attributes
   * @returns {import("../models/user.js").default}
   */
  buildCreatingUser(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @interface
   * @returns {Promise<void>}
   */
  loadCreatingUser() { throw new Error("Not implemented") }

  /**
   * @interface
   * @param {import("../models/user.js").default} newModel
   * @returns {void}
   */
  setCreatingUser(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @interface
   * @returns {import("velocious/src/database/query/index.js").default<import("../models/task.js").default>}
   */
  tasks() { return this.getRelationshipByName("tasks") }

  /**
   * @interface
   * @returns {Array<import("../models/task.js").default>}
   */
  tasksLoaded() { return this.getRelationshipByName("tasks").loaded() }

  /**
   * @interface
   * @returns {Promise<void>}
   */
  loadTasks() { throw new Error("Not implemented") }

  /**
   * @interface
   * @param {Array<import("../models/task.js").default>} newModels
   * @returns {void}
   */
  setTasks(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @interface
   * @returns {import("../models/project-detail.js").default}
   */
  projectDetail() { return this.getRelationshipByName("projectDetail").loaded() }

  /**
   * @interface
   * @param {Record<string, any>} attributes
   * @returns {import("../models/project-detail.js").default}
   */
  buildProjectDetail(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @interface
   * @returns {Promise<void>}
   */
  loadProjectDetail() { throw new Error("Not implemented") }

  /**
   * @interface
   * @param {import("../models/project-detail.js").default} newModel
   * @returns {void}
   */
  setProjectDetail(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @interface
   * @returns {import("velocious/src/database/query/index.js").default<import("velocious/src/database/record/index.js").default>}
   */
  translations() { return this.getRelationshipByName("translations") }

  /**
   * @interface
   * @returns {Array<import("velocious/src/database/record/index.js").default>}
   */
  translationsLoaded() { return this.getRelationshipByName("translations").loaded() }

  /**
   * @interface
   * @returns {Promise<void>}
   */
  loadTranslations() { throw new Error("Not implemented") }

  /**
   * @interface
   * @param {Array<import("velocious/src/database/record/index.js").default>} newModels
   * @returns {void}
   */
  setTranslations(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars
}
