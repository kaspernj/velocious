import FrontendModelBaseResource from "./base-resource.js";
import VelociousAttachment from "../database/record/attachments/attachment-record.js";
/**
 * Framework-owned frontend resource exposing safe attachment metadata while
 * delegating read authorization to the attached owner record.
 * @augments {FrontendModelBaseResource<typeof VelociousAttachment>}
 */
export default class VelociousAttachmentResource extends FrontendModelBaseResource<typeof VelociousAttachment> {
    static ModelClass: typeof VelociousAttachment;
    /** @type {Record<string, import("../configuration-types.js").FrontendModelAttributeConfiguration>} */
    static attributes: Record<string, import("../configuration-types.js").FrontendModelAttributeConfiguration>;
    /** @type {string[]} */
    static builtInCollectionCommands: string[];
    /** @type {string[]} */
    static builtInMemberCommands: string[];
    /**
     * Returns the attachment metadata query after owner-scope authorization has
     * validated the request through beforeAction/find.
     * @param {import("./base-resource.js").FrontendModelResourceAction} action - Frontend-model action.
     * @returns {import("../database/query/model-class-query.js").default<typeof VelociousAttachment>} - Attachment query.
     */
    authorizedQuery(action: import("./base-resource.js").FrontendModelResourceAction): import("../database/query/model-class-query.js").default<typeof VelociousAttachment>;
    /**
     * Runs before action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
     * @returns {Promise<void>}
     */
    beforeAction(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"): Promise<void>;
    /**
     * Runs find.
     * @param {"find" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
     * @param {string | number} id - Attachment id.
     * @returns {Promise<VelociousAttachment | null>} - Located attachment when owner is authorized.
     */
    find(action: "find" | "update" | "destroy" | "attach" | "download" | "url", id: string | number): Promise<VelociousAttachment | null>;
    /**
     * Runs created at attribute.
     * @param {VelociousAttachment} model - Attachment model.
     * @returns {Date} - Created-at timestamp.
     */
    createdAtAttribute(model: VelociousAttachment): Date;
    /**
     * Runs updated at attribute.
     * @param {VelociousAttachment} model - Attachment model.
     * @returns {Date} - Updated-at timestamp.
     */
    updatedAtAttribute(model: VelociousAttachment): Date;
    /**
     * Returns a validated owner scope from frontend-model where params.
     * @returns {{name: string, recordId: string, recordType: string}} - Attachment owner scope.
     */
    requiredOwnerScopeFromParams(): {
        name: string;
        recordId: string;
        recordType: string;
    };
    /**
     * Reads one required string-like where value.
     * @param {object} args - Args.
     * @param {string} args.attributeName - Attribute name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.where - Where hash.
     * @returns {string} - String value.
     */
    requiredSingleWhereValue({ attributeName, where }: {
        attributeName: string;
        where: Record<string, ReturnType<typeof JSON.parse>>;
    }): string;
    /**
     * Builds owner scope from a stored attachment row.
     * @param {VelociousAttachment} attachment - Attachment row.
     * @returns {{name: string, recordId: string, recordType: string}} - Owner scope.
     */
    ownerScopeFromAttachment(attachment: VelociousAttachment): {
        name: string;
        recordId: string;
        recordType: string;
    };
    /**
     * Checks whether the current ability can read the attachment owner.
     * @param {{name: string, recordId: string, recordType: string}} ownerScope - Owner scope.
     * @returns {Promise<boolean>} - Whether owner is readable.
     */
    attachmentOwnerAuthorized(ownerScope: {
        name: string;
        recordId: string;
        recordType: string;
    }): Promise<boolean>;
    /**
     * Finds the frontend-model resource that owns an attachment scope.
     * @param {object} args - Options object.
     * @param {import("../frontend-model-controller.js").default} args.controller - Frontend-model controller.
     * @param {{name: string, recordId: string, recordType: string}} args.ownerScope - Owner scope.
     * @returns {{backendProject: import("../configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("../configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Owner resource configuration.
     */
    attachmentOwnerResource({ controller, ownerScope }: {
        controller: import("../frontend-model-controller.js").default;
        ownerScope: {
            name: string;
            recordId: string;
            recordType: string;
        };
    }): {
        backendProject: import("../configuration-types.js").BackendProjectConfiguration;
        modelName: string;
        resourceClass: import("../configuration-types.js").FrontendModelResourceClassType;
        resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
    } | null;
}
//# sourceMappingURL=velocious-attachment-resource.d.ts.map