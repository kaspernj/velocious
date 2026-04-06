import BaseResource from "../../../../src/authorization/base-resource.js"
import Project from "../models/project.js"

export default class ProjectFrontendModelAbilityResource extends BaseResource {
  static ModelClass = Project

  /** @returns {void} */
  abilities() {
    this.can(["create", "read", "update"])
  }
}
