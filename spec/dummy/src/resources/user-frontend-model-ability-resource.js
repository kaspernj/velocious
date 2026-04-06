import BaseResource from "../../../../src/authorization/base-resource.js"
import User from "../models/user.js"

export default class UserFrontendModelAbilityResource extends BaseResource {
  static ModelClass = User

  /** @returns {void} */
  abilities() {
    this.can("read")
  }
}
