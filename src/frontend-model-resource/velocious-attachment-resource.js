// @ts-check

import FrontendModelBaseResource from "./base-resource.js"
import VelociousAttachment from "../database/record/attachments/attachment-record.js"
import isPlainObject from "../utils/plain-object.js"

/**
 * Framework-owned frontend resource exposing safe attachment metadata while
 * delegating read authorization to the attached owner record.
 * @augments {FrontendModelBaseResource<typeof VelociousAttachment>}
 */
export default class VelociousAttachmentResource extends FrontendModelBaseResource {
  static ModelClass = VelociousAttachment

  /** @type {Record<string, import("../configuration-types.js").FrontendModelAttributeConfiguration>} */
  static attributes = {
    byteSize: {type: "integer"},
    contentType: {null: true, type: "varchar"},
    createdAt: {type: "datetime"},
    filename: {type: "varchar"},
    id: {type: "uuid"},
    name: {type: "varchar"},
    position: {type: "integer"},
    recordId: {type: "varchar"},
    recordType: {type: "varchar"},
    updatedAt: {type: "datetime"}
  }

  /** @type {string[]} */
  static abilities = ["read"]

  /** @type {string[]} */
  static builtInCollectionCommands = ["index"]

  /** @type {string[]} */
  static builtInMemberCommands = ["find"]

  /**
   * Returns the attachment metadata query after owner-scope authorization has
   * validated the request through beforeAction/find.
   * @param {import("./base-resource.js").FrontendModelResourceAction} action - Frontend-model action.
   * @returns {import("../database/query/model-class-query.js").default<typeof VelociousAttachment>} - Attachment query.
   */
  authorizedQuery(action) {
    void action

    return VelociousAttachment.all()
  }

  /**
   * Runs before action.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @returns {Promise<void>}
   */
  async beforeAction(action) {
    if (action !== "index") return

    const authorized = await this.attachmentOwnerAuthorized(this.requiredOwnerScopeFromParams())

    if (!authorized) {
      throw new Error("Attachment owner not found or not authorized")
    }
  }

  /**
   * Runs find.
   * @param {"find" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @param {string | number} id - Attachment id.
   * @returns {Promise<VelociousAttachment | null>} - Located attachment when owner is authorized.
   */
  async find(action, id) {
    void action

    const attachment = await VelociousAttachment.findBy({id})

    if (!attachment) return null
    if (!await this.attachmentOwnerAuthorized(this.ownerScopeFromAttachment(attachment))) return null

    return attachment
  }

  /**
   * Runs created at attribute.
   * @param {VelociousAttachment} model - Attachment model.
   * @returns {Date} - Created-at timestamp.
   */
  createdAtAttribute(model) {
    return new Date(model.createdAtMs())
  }

  /**
   * Runs updated at attribute.
   * @param {VelociousAttachment} model - Attachment model.
   * @returns {Date} - Updated-at timestamp.
   */
  updatedAtAttribute(model) {
    return new Date(model.updatedAtMs())
  }

  /**
   * Returns a validated owner scope from frontend-model where params.
   * @returns {{name: string, recordId: string, recordType: string}} - Attachment owner scope.
   */
  requiredOwnerScopeFromParams() {
    const where = this.params().where

    if (!isPlainObject(where)) {
      throw new Error("VelociousAttachment index requires recordType, recordId, and name where filters")
    }

    return {
      name: this.requiredSingleWhereValue({attributeName: "name", where}),
      recordId: this.requiredSingleWhereValue({attributeName: "recordId", where}),
      recordType: this.requiredSingleWhereValue({attributeName: "recordType", where})
    }
  }

  /**
   * Reads one required string-like where value.
   * @param {object} args - Args.
   * @param {string} args.attributeName - Attribute name.
   * @param {Record<string, ?>} args.where - Where hash.
   * @returns {string} - String value.
   */
  requiredSingleWhereValue({attributeName, where}) {
    const value = where[attributeName]

    if (typeof value === "string" || typeof value === "number") return String(value)

    throw new Error(`VelociousAttachment index requires a single ${attributeName} where filter`)
  }

  /**
   * Builds owner scope from a stored attachment row.
   * @param {VelociousAttachment} attachment - Attachment row.
   * @returns {{name: string, recordId: string, recordType: string}} - Owner scope.
   */
  ownerScopeFromAttachment(attachment) {
    return {
      name: attachment.name(),
      recordId: attachment.recordId(),
      recordType: attachment.recordType()
    }
  }

  /**
   * Checks whether the current ability can read the attachment owner.
   * @param {{name: string, recordId: string, recordType: string}} ownerScope - Owner scope.
   * @returns {Promise<boolean>} - Whether owner is readable.
   */
  async attachmentOwnerAuthorized(ownerScope) {
    const controller = /** @type {import("../frontend-model-controller.js").default} */ (this.controllerInstance())
    const frontendModelResource = controller.frontendModelResourceConfiguration()
    const backendProject = frontendModelResource?.backendProject

    if (!backendProject) throw new Error("VelociousAttachment requires a backend project")

    const ownerResource = controller.frontendModelResourceConfigurationForBackendProjectModelName({
      backendProject,
      modelName: ownerScope.recordType
    })

    if (!ownerResource) {
      throw new Error(`No frontend model resource configured for attachment owner ${ownerScope.recordType}`)
    }

    const ownerModelClass = controller.frontendModelResourceModelClass(ownerResource)

    if (!ownerModelClass) {
      throw new Error(`No model class configured for attachment owner ${ownerScope.recordType}`)
    }

    const attachmentDefinitions = ownerModelClass.getAttachmentsMap()

    if (!attachmentDefinitions[ownerScope.name]) {
      throw new Error(`No attachment '${ownerScope.name}' configured for ${ownerScope.recordType}`)
    }

    await controller.ensureFrontendModelRecordClassInitialized(ownerModelClass)

    const abilityAction = ownerResource.resourceConfiguration.abilities.find || ownerResource.resourceConfiguration.abilities.index || "read"
    const owner = await ownerModelClass
      .accessibleFor(abilityAction, this.ability)
      .findBy({[ownerModelClass.primaryKey()]: ownerScope.recordId})

    return Boolean(owner)
  }
}
