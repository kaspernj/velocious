// @ts-check

import FrontendModelBaseResource from "../../../../src/frontend-model-resource/base-resource.js"
import UuidItem from "../models/uuid-item.js"

/** Resource-routed sync replay resource for the UUID-pk UuidItem dummy model. */
class SyncUuidItemResource extends FrontendModelBaseResource {
  static ModelClass = UuidItem

  static attributes = ["id", "title"]

  static builtInCollectionCommands = ["index"]

  static builtInMemberCommands = ["find"]

  /** @type {string[]} */
  static writableAttributes = ["title"]
}

export default SyncUuidItemResource
