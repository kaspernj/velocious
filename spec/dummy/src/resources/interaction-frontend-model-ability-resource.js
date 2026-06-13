import BaseResource from "../../../../src/authorization/base-resource.js"
import Interaction from "../models/interaction.js"

export default class InteractionFrontendModelAbilityResource extends BaseResource {
  static ModelClass = Interaction

  /** @returns {void} */
  abilities() {
    this.can(["create", "destroy", "read", "update"])
  }
}
