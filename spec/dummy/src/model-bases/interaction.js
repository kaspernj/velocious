import DatabaseRecord from "../../../../src/database/record/index.js"

export default class InteractionBase extends DatabaseRecord {
  /**
   * @returns {typeof import("../models/interaction.js").default}
   */
  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases
  getModelClass() { return /** @type {typeof import("../models/interaction.js").default} */ (this.constructor) }

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
   * @returns {number | null}
   */
  subjectId() { return this.readAttribute("subjectId") }

  /**
   * @param {number | null} newValue
   * @returns {void}
   */
  setSubjectId(newValue) { return this._setColumnAttribute("subjectId", newValue) }

  /**
   * @returns {boolean}
   */
  hasSubjectId() { return this._hasAttribute(this.subjectId()) }

  /**
   * @returns {string | null}
   */
  subjectType() { return this.readAttribute("subjectType") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setSubjectType(newValue) { return this._setColumnAttribute("subjectType", newValue) }

  /**
   * @returns {boolean}
   */
  hasSubjectType() { return this._hasAttribute(this.subjectType()) }

  /**
   * @returns {string | null}
   */
  kind() { return this.readAttribute("kind") }

  /**
   * @param {string | null} newValue
   * @returns {void}
   */
  setKind(newValue) { return this._setColumnAttribute("kind", newValue) }

  /**
   * @returns {boolean}
   */
  hasKind() { return this._hasAttribute(this.kind()) }

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
   * @returns {import("../../../../src/database/record/instance-relationships/belongs-to.js").default<typeof import("../models/interaction.js").default, typeof import("../models/project.js").default>}
   */
  subjectRelationship() { return /** @type {import("../../../../src/database/record/instance-relationships/belongs-to.js").default<typeof import("../models/interaction.js").default, typeof import("../models/project.js").default>} */ (this.getRelationshipByName("subject")) }

  /**
   * @returns {import("../models/project.js").default | import("../models/task.js").default | undefined}
   */
  subject() { return /** @type {import("../models/project.js").default | import("../models/task.js").default | undefined} */ (this.getRelationshipByName("subject").loaded()) }
}
