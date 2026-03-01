import FrontendModelBase from "../../../../src/frontend-models/base.js"
import Project from "./project.js"

/**
 * @typedef {object} TaskAttributes
 * @property {any} id - Attribute value.
 * @property {any} identifier - Attribute value.
 * @property {any} name - Attribute value.
 */
/** Frontend model for Task. */
export default class Task extends FrontendModelBase {
  /** @returns {{attributes: string[], commands: {destroy: string, find: string, index: string, update: string}, primaryKey: string}} - Resource config. */
  static resourceConfig() {
    return {
      attributes: [
        "id",
        "identifier",
        "name",
      ],
      commands: {
        destroy: "destroy",
        find: "find",
        index: "list",
        update: "update",
      },
      primaryKey: "id"
    }
  }

  /** @returns {Record<string, {type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationship definitions. */
  static relationshipDefinitions() {
    return {
      project: {type: "belongsTo"},
    }
  }

  /** @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes. */
  static relationshipModelClasses() {
    return {
      project: Project,
    }
  }

  /** @returns {TaskAttributes["id"]} - Attribute value. */
  id() { return this.readAttribute("id") }

  /**
   * @param {TaskAttributes["id"]} newValue - New attribute value.
   * @returns {TaskAttributes["id"]} - Assigned value.
   */
  setId(newValue) { return this.setAttribute("id", newValue) }

  /** @returns {TaskAttributes["identifier"]} - Attribute value. */
  identifier() { return this.readAttribute("identifier") }

  /**
   * @param {TaskAttributes["identifier"]} newValue - New attribute value.
   * @returns {TaskAttributes["identifier"]} - Assigned value.
   */
  setIdentifier(newValue) { return this.setAttribute("identifier", newValue) }

  /** @returns {TaskAttributes["name"]} - Attribute value. */
  name() { return this.readAttribute("name") }

  /**
   * @param {TaskAttributes["name"]} newValue - New attribute value.
   * @returns {TaskAttributes["name"]} - Assigned value.
   */
  setName(newValue) { return this.setAttribute("name", newValue) }

  /** @returns {import("./project.js").default | null} - Loaded related model. */
  project() { return /** @type {import("./project.js").default | null} */ (this.getRelationshipByName("project").loaded()) }

  /**
   * @param {Record<string, any>} [attributes] - Attributes for the new related model.
   * @returns {import("./project.js").default} - Built related model.
   */
  buildProject(attributes = {}) { return /** @type {import("./project.js").default} */ (this.getRelationshipByName("project").build(attributes)) }
}
