import FrontendModelBase from "../../../../src/frontend-models/base.js"
import Task from "./task.js"

/**
 * @typedef {object} ProjectAttributes
 * @property {any} id - Attribute value.
 * @property {any} name - Attribute value.
 */
/** Frontend model for Project. */
export default class Project extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], commands: {destroy: string, find: string, index: string, update: string}, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      attributes: [
        "id",
        "name",
      ],
      commands: {
        destroy: "destroy",
        find: "find",
        index: "index",
        update: "update",
      },
      primaryKey: "id"
    }
  }

  /**
   * @returns {Record<string, {type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationship definitions.
   */
  static relationshipDefinitions() {
    return {
      tasks: {type: "hasMany"},
    }
  }

  /**
   * @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes.
   */
  static relationshipModelClasses() {
    return {
      tasks: Task,
    }
  }

  /**
   * @returns {ProjectAttributes["id"]} - Attribute value.
   */
  id() { return this.readAttribute("id") }

  /**
   * @param {ProjectAttributes["id"]} newValue - New attribute value.
   * @returns {ProjectAttributes["id"]} - Assigned value.
   */
  setId(newValue) { return this.setAttribute("id", newValue) }

  /**
   * @returns {ProjectAttributes["name"]} - Attribute value.
   */
  name() { return this.readAttribute("name") }

  /**
   * @param {ProjectAttributes["name"]} newValue - New attribute value.
   * @returns {ProjectAttributes["name"]} - Assigned value.
   */
  setName(newValue) { return this.setAttribute("name", newValue) }

  /**
   * @returns {import("../../../../src/frontend-models/base.js").FrontendModelHasManyRelationship<typeof import("./project.js").default, typeof import("./task.js").default>} - Relationship helper.
   */
  tasks() { return /** @type {import("../../../../src/frontend-models/base.js").FrontendModelHasManyRelationship<typeof import("./project.js").default, typeof import("./task.js").default>} */ (this.getRelationshipByName("tasks")) }

  /**
   * @returns {Array<import("./task.js").default>} - Loaded related models.
   */
  tasksLoaded() { return /** @type {Array<import("./task.js").default>} */ (this.getRelationshipByName("tasks").loaded()) }
}
