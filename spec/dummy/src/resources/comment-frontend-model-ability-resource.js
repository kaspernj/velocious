import BaseResource from "../../../../src/authorization/base-resource.js"
import Comment from "../models/comment.js"

export default class CommentFrontendModelAbilityResource extends BaseResource {
  static ModelClass = Comment

  /** @returns {void} */
  abilities() {
    this.can("read")
  }
}
