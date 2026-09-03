// @ts-check
import FrontendModelBaseResource from "./base-resource.js";
import VelociousAttachment from "../database/record/attachments/attachment-record.js";
import isPlainObject from "../utils/plain-object.js";
import { modelPrimaryKeyConditions, modelPrimaryKeyValueFromCacheKey } from "../utils/model-primary-key.js";
/**
 * Framework-owned frontend resource exposing safe attachment metadata while
 * delegating read authorization to the attached owner record.
 * @augments {FrontendModelBaseResource<typeof VelociousAttachment>}
 */
export default class VelociousAttachmentResource extends FrontendModelBaseResource {
    static ModelClass = VelociousAttachment;
    /** @type {Record<string, import("../configuration-types.js").FrontendModelAttributeConfiguration>} */
    static attributes = {
        byteSize: { type: "integer" },
        contentType: { null: true, type: "varchar" },
        createdAt: { type: "datetime" },
        filename: { type: "varchar" },
        id: { type: "uuid" },
        name: { type: "varchar" },
        position: { type: "integer" },
        recordId: { type: "varchar" },
        recordType: { type: "varchar" },
        updatedAt: { type: "datetime" }
    };
    /** @type {string[]} */
    static builtInCollectionCommands = ["index"];
    /** @type {string[]} */
    static builtInMemberCommands = ["find"];
    /**
     * Returns the attachment metadata query after owner-scope authorization has
     * validated the request through beforeAction/find.
     * @param {import("./base-resource.js").FrontendModelResourceAction} action - Frontend-model action.
     * @returns {import("../database/query/model-class-query.js").default<typeof VelociousAttachment>} - Attachment query.
     */
    authorizedQuery(action) {
        void action;
        return VelociousAttachment.all();
    }
    /**
     * Runs before action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
     * @returns {Promise<void>}
     */
    async beforeAction(action) {
        if (action !== "index")
            return;
        const authorized = await this.attachmentOwnerAuthorized(this.requiredOwnerScopeFromParams());
        if (!authorized) {
            throw new Error("Attachment owner not found or not authorized");
        }
    }
    /**
     * Runs find.
     * @param {"find" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
     * @param {string | number} id - Attachment id.
     * @returns {Promise<VelociousAttachment | null>} - Located attachment when owner is authorized.
     */
    async find(action, id) {
        void action;
        const attachment = await VelociousAttachment.findBy({ id });
        if (!attachment)
            return null;
        if (!await this.attachmentOwnerAuthorized(this.ownerScopeFromAttachment(attachment)))
            return null;
        return attachment;
    }
    /**
     * Runs created at attribute.
     * @param {VelociousAttachment} model - Attachment model.
     * @returns {Date} - Created-at timestamp.
     */
    createdAtAttribute(model) {
        return new Date(model.createdAtMs());
    }
    /**
     * Runs updated at attribute.
     * @param {VelociousAttachment} model - Attachment model.
     * @returns {Date} - Updated-at timestamp.
     */
    updatedAtAttribute(model) {
        return new Date(model.updatedAtMs());
    }
    /**
     * Returns a validated owner scope from frontend-model where params.
     * @returns {{name: string, recordId: string, recordType: string}} - Attachment owner scope.
     */
    requiredOwnerScopeFromParams() {
        const where = this.params().where;
        if (!isPlainObject(where)) {
            throw new Error("VelociousAttachment index requires recordType, recordId, and name where filters");
        }
        return {
            name: this.requiredSingleWhereValue({ attributeName: "name", where }),
            recordId: this.requiredSingleWhereValue({ attributeName: "recordId", where }),
            recordType: this.requiredSingleWhereValue({ attributeName: "recordType", where })
        };
    }
    /**
     * Reads one required string-like where value.
     * @param {object} args - Args.
     * @param {string} args.attributeName - Attribute name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.where - Where hash.
     * @returns {string} - String value.
     */
    requiredSingleWhereValue({ attributeName, where }) {
        const value = where[attributeName];
        if (typeof value === "string" || typeof value === "number")
            return String(value);
        throw new Error(`VelociousAttachment index requires a single ${attributeName} where filter`);
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
        };
    }
    /**
     * Checks whether the current ability can read the attachment owner.
     * @param {{name: string, recordId: string, recordType: string}} ownerScope - Owner scope.
     * @returns {Promise<boolean>} - Whether owner is readable.
     */
    async attachmentOwnerAuthorized(ownerScope) {
        const controller = /** @type {import("../frontend-model-controller.js").default} */ (this.controllerInstance());
        const ownerResource = this.attachmentOwnerResource({ controller, ownerScope });
        if (!ownerResource) {
            throw new Error(`No frontend model resource configured for attachment owner ${ownerScope.recordType}`);
        }
        const ownerModelClass = controller.frontendModelResourceModelClass(ownerResource);
        if (!ownerModelClass) {
            throw new Error(`No model class configured for attachment owner ${ownerScope.recordType}`);
        }
        const attachmentDefinitions = ownerModelClass.getAttachmentsMap();
        if (!attachmentDefinitions[ownerScope.name]) {
            throw new Error(`No attachment '${ownerScope.name}' configured for ${ownerScope.recordType}`);
        }
        await controller.ensureFrontendModelRecordClassInitialized(ownerModelClass);
        const abilityAction = ownerResource.resourceConfiguration.abilities.find || ownerResource.resourceConfiguration.abilities.index || "read";
        const primaryKey = ownerModelClass.primaryKey();
        const ownerIdentity = modelPrimaryKeyValueFromCacheKey(primaryKey, ownerScope.recordId);
        const owner = await ownerModelClass
            .accessibleFor(abilityAction, this.ability)
            .findBy(modelPrimaryKeyConditions(primaryKey, ownerIdentity));
        return Boolean(owner);
    }
    /**
     * Finds the frontend-model resource that owns an attachment scope.
     * @param {object} args - Options object.
     * @param {import("../frontend-model-controller.js").default} args.controller - Frontend-model controller.
     * @param {{name: string, recordId: string, recordType: string}} args.ownerScope - Owner scope.
     * @returns {{backendProject: import("../configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("../configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Owner resource configuration.
     */
    attachmentOwnerResource({ controller, ownerScope }) {
        const backendProjects = controller.getConfiguration().getBackendProjects();
        let resourceWithoutAttachment = null;
        if (backendProjects.length < 1)
            throw new Error("VelociousAttachment requires a backend project");
        for (const backendProject of backendProjects) {
            const ownerResource = controller.frontendModelResourceConfigurationForBackendProjectModelName({
                backendProject,
                modelName: ownerScope.recordType
            });
            if (!ownerResource)
                continue;
            const ownerModelClass = controller.frontendModelResourceModelClass(ownerResource);
            if (!ownerModelClass) {
                throw new Error(`No model class configured for attachment owner ${ownerScope.recordType}`);
            }
            const attachmentDefinitions = ownerModelClass.getAttachmentsMap();
            if (attachmentDefinitions[ownerScope.name])
                return ownerResource;
            resourceWithoutAttachment ||= ownerResource;
        }
        if (resourceWithoutAttachment) {
            throw new Error(`No attachment '${ownerScope.name}' configured for ${ownerScope.recordType}`);
        }
        return null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvdmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8seUJBQXlCLE1BQU0sb0JBQW9CLENBQUE7QUFDMUQsT0FBTyxtQkFBbUIsTUFBTSxxREFBcUQsQ0FBQTtBQUNyRixPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLEVBQUMseUJBQXlCLEVBQUUsZ0NBQWdDLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUV6Rzs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTywyQkFBNEIsU0FBUSx5QkFBeUI7SUFDaEYsTUFBTSxDQUFDLFVBQVUsR0FBRyxtQkFBbUIsQ0FBQTtJQUV2QyxzR0FBc0c7SUFDdEcsTUFBTSxDQUFDLFVBQVUsR0FBRztRQUNsQixRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQzNCLFdBQVcsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMxQyxTQUFTLEVBQUUsRUFBQyxJQUFJLEVBQUUsVUFBVSxFQUFDO1FBQzdCLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDM0IsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLE1BQU0sRUFBQztRQUNsQixJQUFJLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQ3ZCLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDM0IsUUFBUSxFQUFFLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMzQixVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQzdCLFNBQVMsRUFBRSxFQUFDLElBQUksRUFB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QUFNLHFCQUFxQixHQUFHLGVBQWUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBRWpFLElBQUkscUJBQXFCLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQztnQkFBRSxPQUFPLGFBQWEsQ0FBQTtZQUVoRSx5QkFBeUIsS0FBSyxhQUFhLENBQUE7UUFDN0MsQ0FBQztRQUVELElBQUkseUJBQXlCLEVBQUUsQ0FBQztZQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLGtCQUFrQixVQUFVLENBQUMsSUFBSSxvQkFBb0IsVUFBVSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFDL0YsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGZyb20gXCIuL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0IFZlbG9jaW91c0F0dGFjaG1lbnQgZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC9hdHRhY2htZW50cy9hdHRhY2htZW50LXJlY29yZC5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXl9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKlxuICogRnJhbWV3b3JrLW93bmVkIGZyb250ZW5kIHJlc291cmNlIGV4cG9zaW5nIHNhZmUgYXR0YWNobWVudCBtZXRhZGF0YSB3aGlsZVxuICogZGVsZWdhdGluZyByZWFkIGF1dGhvcml6YXRpb24gdG8gdGhlIGF0dGFjaGVkIG93bmVyIHJlY29yZC5cbiAqIEBhdWdtZW50cyB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTx0eXBlb2YgVmVsb2Npb3VzQXR0YWNobWVudD59XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0F0dGFjaG1lbnRSZXNvdXJjZSBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uge1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IFZlbG9jaW91c0F0dGFjaG1lbnRcblxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUNvbmZpZ3VyYXRpb24+fSAqL1xuICBzdGF0aWMgYXR0cmlidXRlcyA9IHtcbiAgICBieXRlU2l6ZToge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICBjb250ZW50VHlwZToge251bGw6IHRydWUsIHR5cGU6IFwidmFyY2hhclwifSxcbiAgICBjcmVhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9LFxuICAgIGZpbGVuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgIGlkOiB7dHlwZTogXCJ1dWlkXCJ9LFxuICAgIG5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgcG9zaXRpb246IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgcmVjb3JkSWQ6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgcmVjb3JkVHlwZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICB1cGRhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9XG4gIH1cblxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IFtcImluZGV4XCJdXG5cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IFtcImZpbmRcIl1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBtZXRhZGF0YSBxdWVyeSBhZnRlciBvd25lci1zY29wZSBhdXRob3JpemF0aW9uIGhhc1xuICAgKiB2YWxpZGF0ZWQgdGhlIHJlcXVlc3QgdGhyb3VnaCBiZWZvcmVBY3Rpb24vZmluZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9ufSBhY3Rpb24gLSBGcm9udGVuZC1tb2RlbCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNBdHRhY2htZW50Pn0gLSBBdHRhY2htZW50IHF1ZXJ5LlxuICAgKi9cbiAgYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gVmVsb2Npb3VzQXR0YWNobWVudC5hbGwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGJlZm9yZUFjdGlvbihhY3Rpb24pIHtcbiAgICBpZiAoYWN0aW9uICE9PSBcImluZGV4XCIpIHJldHVyblxuXG4gICAgY29uc3QgYXV0aG9yaXplZCA9IGF3YWl0IHRoaXMuYXR0YWNobWVudE93bmVyQXV0aG9yaXplZCh0aGlzLnJlcXVpcmVkT3duZXJTY29wZUZyb21QYXJhbXMoKSlcblxuICAgIGlmICghYXV0aG9yaXplZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBvd25lciBub3QgZm91bmQgb3Igbm90IGF1dGhvcml6ZWRcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge1wiZmluZFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VmVsb2Npb3VzQXR0YWNobWVudCB8IG51bGw+fSAtIExvY2F0ZWQgYXR0YWNobWVudCB3aGVuIG93bmVyIGlzIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBmaW5kKGFjdGlvbiwgaWQpIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgY29uc3QgYXR0YWNobWVudCA9IGF3YWl0IFZlbG9jaW91c0F0dGFjaG1lbnQuZmluZEJ5KHtpZH0pXG5cbiAgICBpZiAoIWF0dGFjaG1lbnQpIHJldHVybiBudWxsXG4gICAgaWYgKCFhd2FpdCB0aGlzLmF0dGFjaG1lbnRPd25lckF1dGhvcml6ZWQodGhpcy5vd25lclNjb3BlRnJvbUF0dGFjaG1lbnQoYXR0YWNobWVudCkpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZWQgYXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0F0dGFjaG1lbnR9IG1vZGVsIC0gQXR0YWNobWVudCBtb2RlbC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gQ3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICBjcmVhdGVkQXRBdHRyaWJ1dGUobW9kZWwpIHtcbiAgICByZXR1cm4gbmV3IERhdGUobW9kZWwuY3JlYXRlZEF0TXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZWQgYXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0F0dGFjaG1lbnR9IG1vZGVsIC0gQXR0YWNobWVudCBtb2RlbC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gVXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICB1cGRhdGVkQXRBdHRyaWJ1dGUobW9kZWwpIHtcbiAgICByZXR1cm4gbmV3IERhdGUobW9kZWwudXBkYXRlZEF0TXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgdmFsaWRhdGVkIG93bmVyIHNjb3BlIGZyb20gZnJvbnRlbmQtbW9kZWwgd2hlcmUgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7e25hbWU6IHN0cmluZywgcmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nfX0gLSBBdHRhY2htZW50IG93bmVyIHNjb3BlLlxuICAgKi9cbiAgcmVxdWlyZWRPd25lclNjb3BlRnJvbVBhcmFtcygpIHtcbiAgICBjb25zdCB3aGVyZSA9IHRoaXMucGFyYW1zKCkud2hlcmVcblxuICAgIGlmICghaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlZlbG9jaW91c0F0dGFjaG1lbnQgaW5kZXggcmVxdWlyZXMgcmVjb3JkVHlwZSwgcmVjb3JkSWQsIGFuZCBuYW1lIHdoZXJlIGZpbHRlcnNcIilcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbmFtZTogdGhpcy5yZXF1aXJlZFNpbmdsZVdoZXJlVmFsdWUoe2F0dHJpYnV0ZU5hbWU6IFwibmFtZVwiLCB3aGVyZX0pLFxuICAgICAgcmVjb3JkSWQ6IHRoaXMucmVxdWlyZWRTaW5nbGVXaGVyZVZhbHVlKHthdHRyaWJ1dGVOYW1lOiBcInJlY29yZElkXCIsIHdoZXJlfSksXG4gICAgICByZWNvcmRUeXBlOiB0aGlzLnJlcXVpcmVkU2luZ2xlV2hlcmVWYWx1ZSh7YXR0cmlidXRlTmFtZTogXCJyZWNvcmRUeXBlXCIsIHdoZXJlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgb25lIHJlcXVpcmVkIHN0cmluZy1saWtlIHdoZXJlIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mud2hlcmUgLSBXaGVyZSBoYXNoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0cmluZyB2YWx1ZS5cbiAgICovXG4gIHJlcXVpcmVkU2luZ2xlV2hlcmVWYWx1ZSh7YXR0cmlidXRlTmFtZSwgd2hlcmV9KSB7XG4gICAgY29uc3QgdmFsdWUgPSB3aGVyZVthdHRyaWJ1dGVOYW1lXVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiBTdHJpbmcodmFsdWUpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFZlbG9jaW91c0F0dGFjaG1lbnQgaW5kZXggcmVxdWlyZXMgYSBzaW5nbGUgJHthdHRyaWJ1dGVOYW1lfSB3aGVyZSBmaWx0ZXJgKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBvd25lciBzY29wZSBmcm9tIGEgc3RvcmVkIGF0dGFjaG1lbnQgcm93LlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0F0dGFjaG1lbnR9IGF0dGFjaG1lbnQgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge3tuYW1lOiBzdHJpbmcsIHJlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZ319IC0gT3duZXIgc2NvcGUuXG4gICAqL1xuICBvd25lclNjb3BlRnJvbUF0dGFjaG1lbnQoYXR0YWNobWVudCkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiBhdHRhY2htZW50Lm5hbWUoKSxcbiAgICAgIHJlY29yZElkOiBhdHRhY2htZW50LnJlY29yZElkKCksXG4gICAgICByZWNvcmRUeXBlOiBhdHRhY2htZW50LnJlY29yZFR5cGUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCBhYmlsaXR5IGNhbiByZWFkIHRoZSBhdHRhY2htZW50IG93bmVyLlxuICAgKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIHJlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZ319IG93bmVyU2NvcGUgLSBPd25lciBzY29wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBvd25lciBpcyByZWFkYWJsZS5cbiAgICovXG4gIGFzeW5jIGF0dGFjaG1lbnRPd25lckF1dGhvcml6ZWQob3duZXJTY29wZSkge1xuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkpXG4gICAgY29uc3Qgb3duZXJSZXNvdXJjZSA9IHRoaXMuYXR0YWNobWVudE93bmVyUmVzb3VyY2Uoe2NvbnRyb2xsZXIsIG93bmVyU2NvcGV9KVxuXG4gICAgaWYgKCFvd25lclJlc291cmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyZWQgZm9yIGF0dGFjaG1lbnQgb3duZXIgJHtvd25lclNjb3BlLnJlY29yZFR5cGV9YClcbiAgICB9XG5cbiAgICBjb25zdCBvd25lck1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3Mob3duZXJSZXNvdXJjZSlcblxuICAgIGlmICghb3duZXJNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yIGF0dGFjaG1lbnQgb3duZXIgJHtvd25lclNjb3BlLnJlY29yZFR5cGV9YClcbiAgICB9XG5cbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBvd25lck1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbnNbb3duZXJTY29wZS5uYW1lXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50ICcke293bmVyU2NvcGUubmFtZX0nIGNvbmZpZ3VyZWQgZm9yICR7b3duZXJTY29wZS5yZWNvcmRUeXBlfWApXG4gICAgfVxuXG4gICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsUmVjb3JkQ2xhc3NJbml0aWFsaXplZChvd25lck1vZGVsQ2xhc3MpXG5cbiAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gb3duZXJSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzLmZpbmQgfHwgb3duZXJSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzLmluZGV4IHx8IFwicmVhZFwiXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IG93bmVyTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBvd25lcklkZW50aXR5ID0gbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXkocHJpbWFyeUtleSwgb3duZXJTY29wZS5yZWNvcmRJZClcbiAgICBjb25zdCBvd25lciA9IGF3YWl0IG93bmVyTW9kZWxDbGFzc1xuICAgICAgLmFjY2Vzc2libGVGb3IoYWJpbGl0eUFjdGlvbiwgdGhpcy5hYmlsaXR5KVxuICAgICAgLmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIG93bmVySWRlbnRpdHkpKVxuXG4gICAgcmV0dXJuIEJvb2xlYW4ob3duZXIpXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHRoYXQgb3ducyBhbiBhdHRhY2htZW50IHNjb3BlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gYXJncy5jb250cm9sbGVyIC0gRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlci5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nLCByZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmd9fSBhcmdzLm93bmVyU2NvcGUgLSBPd25lciBzY29wZS5cbiAgICogQHJldHVybnMge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSwgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSB8IG51bGx9IC0gT3duZXIgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGF0dGFjaG1lbnRPd25lclJlc291cmNlKHtjb250cm9sbGVyLCBvd25lclNjb3BlfSkge1xuICAgIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IGNvbnRyb2xsZXIuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgbGV0IHJlc291cmNlV2l0aG91dEF0dGFjaG1lbnQgPSBudWxsXG5cbiAgICBpZiAoYmFja2VuZFByb2plY3RzLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIlZlbG9jaW91c0F0dGFjaG1lbnQgcmVxdWlyZXMgYSBiYWNrZW5kIHByb2plY3RcIilcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCBvd25lclJlc291cmNlID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgbW9kZWxOYW1lOiBvd25lclNjb3BlLnJlY29yZFR5cGVcbiAgICAgIH0pXG5cbiAgICAgIGlmICghb3duZXJSZXNvdXJjZSkgY29udGludWVcblxuICAgICAgY29uc3Qgb3duZXJNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKG93bmVyUmVzb3VyY2UpXG5cbiAgICAgIGlmICghb3duZXJNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgYXR0YWNobWVudCBvd25lciAke293bmVyU2NvcGUucmVjb3JkVHlwZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBvd25lck1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb25zW293bmVyU2NvcGUubmFtZV0pIHJldHVybiBvd25lclJlc291cmNlXG5cbiAgICAgIHJlc291cmNlV2l0aG91dEF0dGFjaG1lbnQgfHw9IG93bmVyUmVzb3VyY2VcbiAgICB9XG5cbiAgICBpZiAocmVzb3VyY2VXaXRob3V0QXR0YWNobWVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50ICcke293bmVyU2NvcGUubmFtZX0nIGNvbmZpZ3VyZWQgZm9yICR7b3duZXJTY29wZS5yZWNvcmRUeXBlfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuIl19