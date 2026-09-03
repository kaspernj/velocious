// @ts-check
import FrontendModelBaseResource from "./base-resource.js";
import VelociousAttachment from "../database/record/attachments/attachment-record.js";
import { frontendModelResourcesForBackendProject } from "../frontend-models/resource-definition.js";
import isPlainObject from "../utils/plain-object.js";
import { modelPrimaryKeyConditions, modelPrimaryKeyValueFromCacheKey } from "../utils/model-primary-key.js";
/** @typedef {{name: string, recordId: string, recordType: string, resourceName: string | null}} AttachmentOwnerScope */
/** @typedef {{backendProject: import("../configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("../configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration}} AttachmentOwnerResource */
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
     * Loads attachment metadata after removing the authorization-only resource name from database filters.
     * @returns {Promise<VelociousAttachment[]>} - Attachment metadata rows.
     */
    async records() {
        const controller = /** @type {import("../frontend-model-controller.js").default} */ (this.controllerInstance());
        const params = controller.frontendModelParams();
        const where = { ...this.requiredWhereFromParams() };
        delete where.resourceName;
        return await controller.withFrontendModelParams({ ...params, where }, async () => await this.indexQuery().toArray());
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
     * @returns {AttachmentOwnerScope} - Attachment owner scope.
     */
    requiredOwnerScopeFromParams() {
        const where = this.requiredWhereFromParams();
        const recordType = this.requiredSingleWhereValue({ attributeName: "recordType", where });
        return {
            name: this.requiredSingleWhereValue({ attributeName: "name", where }),
            recordId: this.requiredSingleWhereValue({ attributeName: "recordId", where }),
            recordType,
            resourceName: this.requiredSingleWhereValue({ attributeName: "resourceName", where })
        };
    }
    /**
     * Returns the required attachment metadata where object.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Attachment where filters.
     */
    requiredWhereFromParams() {
        const where = this.params().where;
        if (!isPlainObject(where)) {
            throw new Error("VelociousAttachment index requires resourceName, recordType, recordId, and name where filters");
        }
        return where;
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
     * @returns {AttachmentOwnerScope} - Owner scope.
     */
    ownerScopeFromAttachment(attachment) {
        return {
            name: attachment.name(),
            recordId: attachment.recordId(),
            recordType: attachment.recordType(),
            resourceName: null
        };
    }
    /**
     * Checks whether the current ability can read the attachment owner.
     * @param {AttachmentOwnerScope} ownerScope - Owner scope.
     * @returns {Promise<boolean>} - Whether owner is readable.
     */
    async attachmentOwnerAuthorized(ownerScope) {
        const controller = /** @type {import("../frontend-model-controller.js").default} */ (this.controllerInstance());
        const ownerResources = this.attachmentOwnerResources({ controller, ownerScope });
        if (ownerResources.length < 1) {
            throw new Error(`No frontend model resource configured for attachment owner ${ownerScope.resourceName ?? ownerScope.recordType}`);
        }
        for (const ownerResource of ownerResources) {
            const ownerModelClass = controller.frontendModelResourceModelClass(ownerResource);
            await controller.ensureFrontendModelRecordClassInitialized(ownerModelClass);
            const abilityAction = ownerResource.resourceConfiguration.abilities.find || ownerResource.resourceConfiguration.abilities.index || "read";
            const primaryKey = ownerModelClass.primaryKey();
            const ownerIdentity = modelPrimaryKeyValueFromCacheKey(primaryKey, ownerScope.recordId);
            const owner = await ownerModelClass
                .accessibleFor(abilityAction, this.ability)
                .findBy(modelPrimaryKeyConditions(primaryKey, ownerIdentity));
            if (owner)
                return true;
        }
        return false;
    }
    /**
     * Resolves the explicit owner resource for scoped queries or every matching alias for member lookups.
     * @param {object} args - Options object.
     * @param {import("../frontend-model-controller.js").default} args.controller - Frontend-model controller.
     * @param {AttachmentOwnerScope} args.ownerScope - Owner scope.
     * @returns {AttachmentOwnerResource[]} - Matching owner resources.
     */
    attachmentOwnerResources({ controller, ownerScope }) {
        if (ownerScope.resourceName) {
            const ownerResource = this.attachmentOwnerResource({
                controller,
                ownerScope: { ...ownerScope, resourceName: ownerScope.resourceName }
            });
            return ownerResource ? [ownerResource] : [];
        }
        const ownerResources = [];
        for (const backendProject of controller.getConfiguration().getBackendProjects()) {
            for (const resourceName of Object.keys(frontendModelResourcesForBackendProject(backendProject))) {
                const ownerResource = controller.frontendModelResourceConfigurationForBackendProjectModelName({ backendProject, modelName: resourceName });
                if (!ownerResource)
                    continue;
                const ownerModelClass = controller.frontendModelResourceModelClass(ownerResource);
                if (ownerModelClass.getModelName() !== ownerScope.recordType)
                    continue;
                if (!ownerResource.resourceConfiguration.attachments?.[ownerScope.name])
                    continue;
                ownerResources.push(ownerResource);
            }
        }
        return ownerResources;
    }
    /**
     * Finds the frontend-model resource that owns an attachment scope.
     * @param {object} args - Options object.
     * @param {import("../frontend-model-controller.js").default} args.controller - Frontend-model controller.
     * @param {{name: string, recordId: string, recordType: string, resourceName: string}} args.ownerScope - Owner scope.
     * @returns {AttachmentOwnerResource | null} - Owner resource configuration.
     */
    attachmentOwnerResource({ controller, ownerScope }) {
        const backendProjects = controller.getConfiguration().getBackendProjects();
        let resourceWithoutAttachment = null;
        if (backendProjects.length < 1)
            throw new Error("VelociousAttachment requires a backend project");
        for (const backendProject of backendProjects) {
            const ownerResource = controller.frontendModelResourceConfigurationForBackendProjectModelName({
                backendProject,
                modelName: ownerScope.resourceName
            });
            if (!ownerResource)
                continue;
            const ownerModelClass = controller.frontendModelResourceModelClass(ownerResource);
            if (!ownerModelClass) {
                throw new Error(`No model class configured for attachment owner ${ownerScope.resourceName}`);
            }
            const attachmentDefinitions = ownerResource.resourceConfiguration.attachments || {};
            if (attachmentDefinitions[ownerScope.name])
                return ownerResource;
            resourceWithoutAttachment ||= ownerResource;
        }
        if (resourceWithoutAttachment) {
            throw new Error(`No attachment '${ownerScope.name}' configured for ${ownerScope.resourceName}`);
        }
        return null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvdmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8seUJBQXlCLE1BQU0sb0JBQW9CLENBQUE7QUFDMUQsT0FBTyxtQkFBbUIsTUFBTSxxREFBcUQsQ0FBQTtBQUNyRixPQUFPLEVBQUMsdUNBQXVDLEVBQUMsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNqRyxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLEVBQUMseUJBQXlCLEVBQUUsZ0NBQWdDLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUV6Ryx3SEFBd0g7QUFDeEgsMFVBQTBVO0FBRTFVOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDJCQUE0QixTQUFRLHlCQUF5QjtJQUNoRixNQUFNLENBQUMsVUFBVSxHQUFHLG1CQUFtQixDQUFBO0lBRXZDLHNHQUFzRztJQUN0RyxNQUFNLENBQUMsVUFBVSxHQUFHO1FBQ2xCLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDM0IsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQzFDLFNBQVMsRUFBRSxFQUFDLElBQUksRUFBRSxVQUFVLEVBQUM7UUFDN0IsUUFBUSxFQUFFLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMzQixFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUUsTUFBTSxFQUFDO1FBQ2xCLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDdkIsUUFBUSxFQUFFLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMzQixRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFD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ZSBmcm9tIFwiLi9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNBdHRhY2htZW50IGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQvYXR0YWNobWVudHMvYXR0YWNobWVudC1yZWNvcmQuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXl9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7e25hbWU6IHN0cmluZywgcmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZyB8IG51bGx9fSBBdHRhY2htZW50T3duZXJTY29wZSAqL1xuLyoqIEB0eXBlZGVmIHt7YmFja2VuZFByb2plY3Q6IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uLCBtb2RlbE5hbWU6IHN0cmluZywgcmVzb3VyY2VDbGFzczogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUsIHJlc291cmNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn19IEF0dGFjaG1lbnRPd25lclJlc291cmNlICovXG5cbi8qKlxuICogRnJhbWV3b3JrLW93bmVkIGZyb250ZW5kIHJlc291cmNlIGV4cG9zaW5nIHNhZmUgYXR0YWNobWVudCBtZXRhZGF0YSB3aGlsZVxuICogZGVsZWdhdGluZyByZWFkIGF1dGhvcml6YXRpb24gdG8gdGhlIGF0dGFjaGVkIG93bmVyIHJlY29yZC5cbiAqIEBhdWdtZW50cyB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTx0eXBlb2YgVmVsb2Npb3VzQXR0YWNobWVudD59XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0F0dGFjaG1lbnRSZXNvdXJjZSBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uge1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IFZlbG9jaW91c0F0dGFjaG1lbnRcblxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUNvbmZpZ3VyYXRpb24+fSAqL1xuICBzdGF0aWMgYXR0cmlidXRlcyA9IHtcbiAgICBieXRlU2l6ZToge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICBjb250ZW50VHlwZToge251bGw6IHRydWUsIHR5cGU6IFwidmFyY2hhclwifSxcbiAgICBjcmVhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9LFxuICAgIGZpbGVuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgIGlkOiB7dHlwZTogXCJ1dWlkXCJ9LFxuICAgIG5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgcG9zaXRpb246IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgcmVjb3JkSWQ6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgcmVjb3JkVHlwZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICB1cGRhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9XG4gIH1cblxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IFtcImluZGV4XCJdXG5cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IFtcImZpbmRcIl1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBtZXRhZGF0YSBxdWVyeSBhZnRlciBvd25lci1zY29wZSBhdXRob3JpemF0aW9uIGhhc1xuICAgKiB2YWxpZGF0ZWQgdGhlIHJlcXVlc3QgdGhyb3VnaCBiZWZvcmVBY3Rpb24vZmluZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UtcmVzb3VyY2UuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9ufSBhY3Rpb24gLSBGcm9udGVuZC1tb2RlbCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNBdHRhY2htZW50Pn0gLSBBdHRhY2htZW50IHF1ZXJ5LlxuICAgKi9cbiAgYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gVmVsb2Npb3VzQXR0YWNobWVudC5hbGwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGJlZm9yZUFjdGlvbihhY3Rpb24pIHtcbiAgICBpZiAoYWN0aW9uICE9PSBcImluZGV4XCIpIHJldHVyblxuXG4gICAgY29uc3QgYXV0aG9yaXplZCA9IGF3YWl0IHRoaXMuYXR0YWNobWVudE93bmVyQXV0aG9yaXplZCh0aGlzLnJlcXVpcmVkT3duZXJTY29wZUZyb21QYXJhbXMoKSlcblxuICAgIGlmICghYXV0aG9yaXplZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBvd25lciBub3QgZm91bmQgb3Igbm90IGF1dGhvcml6ZWRcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYXR0YWNobWVudCBtZXRhZGF0YSBhZnRlciByZW1vdmluZyB0aGUgYXV0aG9yaXphdGlvbi1vbmx5IHJlc291cmNlIG5hbWUgZnJvbSBkYXRhYmFzZSBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50W10+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cy5cbiAgICovXG4gIGFzeW5jIHJlY29yZHMoKSB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5jb250cm9sbGVySW5zdGFuY2UoKSlcbiAgICBjb25zdCBwYXJhbXMgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuICAgIGNvbnN0IHdoZXJlID0gey4uLnRoaXMucmVxdWlyZWRXaGVyZUZyb21QYXJhbXMoKX1cblxuICAgIGRlbGV0ZSB3aGVyZS5yZXNvdXJjZU5hbWVcblxuICAgIHJldHVybiBhd2FpdCBjb250cm9sbGVyLndpdGhGcm9udGVuZE1vZGVsUGFyYW1zKHsuLi5wYXJhbXMsIHdoZXJlfSwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5pbmRleFF1ZXJ5KCkudG9BcnJheSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZC5cbiAgICogQHBhcmFtIHtcImZpbmRcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBpZCAtIEF0dGFjaG1lbnQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnQgfCBudWxsPn0gLSBMb2NhdGVkIGF0dGFjaG1lbnQgd2hlbiBvd25lciBpcyBhdXRob3JpemVkLlxuICAgKi9cbiAgYXN5bmMgZmluZChhY3Rpb24sIGlkKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIGNvbnN0IGF0dGFjaG1lbnQgPSBhd2FpdCBWZWxvY2lvdXNBdHRhY2htZW50LmZpbmRCeSh7aWR9KVxuXG4gICAgaWYgKCFhdHRhY2htZW50KSByZXR1cm4gbnVsbFxuICAgIGlmICghYXdhaXQgdGhpcy5hdHRhY2htZW50T3duZXJBdXRob3JpemVkKHRoaXMub3duZXJTY29wZUZyb21BdHRhY2htZW50KGF0dGFjaG1lbnQpKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhdHRhY2htZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGVkIGF0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNBdHRhY2htZW50fSBtb2RlbCAtIEF0dGFjaG1lbnQgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIENyZWF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgY3JlYXRlZEF0QXR0cmlidXRlKG1vZGVsKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKG1vZGVsLmNyZWF0ZWRBdE1zKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGVkIGF0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNBdHRhY2htZW50fSBtb2RlbCAtIEF0dGFjaG1lbnQgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIFVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgdXBkYXRlZEF0QXR0cmlidXRlKG1vZGVsKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKG1vZGVsLnVwZGF0ZWRBdE1zKCkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHZhbGlkYXRlZCBvd25lciBzY29wZSBmcm9tIGZyb250ZW5kLW1vZGVsIHdoZXJlIHBhcmFtcy5cbiAgICogQHJldHVybnMge0F0dGFjaG1lbnRPd25lclNjb3BlfSAtIEF0dGFjaG1lbnQgb3duZXIgc2NvcGUuXG4gICAqL1xuICByZXF1aXJlZE93bmVyU2NvcGVGcm9tUGFyYW1zKCkge1xuICAgIGNvbnN0IHdoZXJlID0gdGhpcy5yZXF1aXJlZFdoZXJlRnJvbVBhcmFtcygpXG4gICAgY29uc3QgcmVjb3JkVHlwZSA9IHRoaXMucmVxdWlyZWRTaW5nbGVXaGVyZVZhbHVlKHthdHRyaWJ1dGVOYW1lOiBcInJlY29yZFR5cGVcIiwgd2hlcmV9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IHRoaXMucmVxdWlyZWRTaW5nbGVXaGVyZVZhbHVlKHthdHRyaWJ1dGVOYW1lOiBcIm5hbWVcIiwgd2hlcmV9KSxcbiAgICAgIHJlY29yZElkOiB0aGlzLnJlcXVpcmVkU2luZ2xlV2hlcmVWYWx1ZSh7YXR0cmlidXRlTmFtZTogXCJyZWNvcmRJZFwiLCB3aGVyZX0pLFxuICAgICAgcmVjb3JkVHlwZSxcbiAgICAgIHJlc291cmNlTmFtZTogdGhpcy5yZXF1aXJlZFNpbmdsZVdoZXJlVmFsdWUoe2F0dHJpYnV0ZU5hbWU6IFwicmVzb3VyY2VOYW1lXCIsIHdoZXJlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcmVxdWlyZWQgYXR0YWNobWVudCBtZXRhZGF0YSB3aGVyZSBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQXR0YWNobWVudCB3aGVyZSBmaWx0ZXJzLlxuICAgKi9cbiAgcmVxdWlyZWRXaGVyZUZyb21QYXJhbXMoKSB7XG4gICAgY29uc3Qgd2hlcmUgPSB0aGlzLnBhcmFtcygpLndoZXJlXG5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3Qod2hlcmUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJWZWxvY2lvdXNBdHRhY2htZW50IGluZGV4IHJlcXVpcmVzIHJlc291cmNlTmFtZSwgcmVjb3JkVHlwZSwgcmVjb3JkSWQsIGFuZCBuYW1lIHdoZXJlIGZpbHRlcnNcIilcbiAgICB9XG5cbiAgICByZXR1cm4gd2hlcmVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBvbmUgcmVxdWlyZWQgc3RyaW5nLWxpa2Ugd2hlcmUgdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy53aGVyZSAtIFdoZXJlIGhhc2guXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RyaW5nIHZhbHVlLlxuICAgKi9cbiAgcmVxdWlyZWRTaW5nbGVXaGVyZVZhbHVlKHthdHRyaWJ1dGVOYW1lLCB3aGVyZX0pIHtcbiAgICBjb25zdCB2YWx1ZSA9IHdoZXJlW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIFN0cmluZyh2YWx1ZSlcblxuICAgIHRocm93IG5ldyBFcnJvcihgVmVsb2Npb3VzQXR0YWNobWVudCBpbmRleCByZXF1aXJlcyBhIHNpbmdsZSAke2F0dHJpYnV0ZU5hbWV9IHdoZXJlIGZpbHRlcmApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG93bmVyIHNjb3BlIGZyb20gYSBzdG9yZWQgYXR0YWNobWVudCByb3cuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzQXR0YWNobWVudH0gYXR0YWNobWVudCAtIEF0dGFjaG1lbnQgcm93LlxuICAgKiBAcmV0dXJucyB7QXR0YWNobWVudE93bmVyU2NvcGV9IC0gT3duZXIgc2NvcGUuXG4gICAqL1xuICBvd25lclNjb3BlRnJvbUF0dGFjaG1lbnQoYXR0YWNobWVudCkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiBhdHRhY2htZW50Lm5hbWUoKSxcbiAgICAgIHJlY29yZElkOiBhdHRhY2htZW50LnJlY29yZElkKCksXG4gICAgICByZWNvcmRUeXBlOiBhdHRhY2htZW50LnJlY29yZFR5cGUoKSxcbiAgICAgIHJlc291cmNlTmFtZTogbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCBhYmlsaXR5IGNhbiByZWFkIHRoZSBhdHRhY2htZW50IG93bmVyLlxuICAgKiBAcGFyYW0ge0F0dGFjaG1lbnRPd25lclNjb3BlfSBvd25lclNjb3BlIC0gT3duZXIgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgb3duZXIgaXMgcmVhZGFibGUuXG4gICAqL1xuICBhc3luYyBhdHRhY2htZW50T3duZXJBdXRob3JpemVkKG93bmVyU2NvcGUpIHtcbiAgICBjb25zdCBjb250cm9sbGVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLmNvbnRyb2xsZXJJbnN0YW5jZSgpKVxuICAgIGNvbnN0IG93bmVyUmVzb3VyY2VzID0gdGhpcy5hdHRhY2htZW50T3duZXJSZXNvdXJjZXMoe2NvbnRyb2xsZXIsIG93bmVyU2NvcGV9KVxuXG4gICAgaWYgKG93bmVyUmVzb3VyY2VzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJlZCBmb3IgYXR0YWNobWVudCBvd25lciAke293bmVyU2NvcGUucmVzb3VyY2VOYW1lID8/IG93bmVyU2NvcGUucmVjb3JkVHlwZX1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgb3duZXJSZXNvdXJjZSBvZiBvd25lclJlc291cmNlcykge1xuICAgICAgY29uc3Qgb3duZXJNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKG93bmVyUmVzb3VyY2UpXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbFJlY29yZENsYXNzSW5pdGlhbGl6ZWQob3duZXJNb2RlbENsYXNzKVxuXG4gICAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gb3duZXJSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzLmZpbmQgfHwgb3duZXJSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzLmluZGV4IHx8IFwicmVhZFwiXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gb3duZXJNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgICAgY29uc3Qgb3duZXJJZGVudGl0eSA9IG1vZGVsUHJpbWFyeUtleVZhbHVlRnJvbUNhY2hlS2V5KHByaW1hcnlLZXksIG93bmVyU2NvcGUucmVjb3JkSWQpXG4gICAgICBjb25zdCBvd25lciA9IGF3YWl0IG93bmVyTW9kZWxDbGFzc1xuICAgICAgICAuYWNjZXNzaWJsZUZvcihhYmlsaXR5QWN0aW9uLCB0aGlzLmFiaWxpdHkpXG4gICAgICAgIC5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBvd25lcklkZW50aXR5KSlcblxuICAgICAgaWYgKG93bmVyKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBleHBsaWNpdCBvd25lciByZXNvdXJjZSBmb3Igc2NvcGVkIHF1ZXJpZXMgb3IgZXZlcnkgbWF0Y2hpbmcgYWxpYXMgZm9yIG1lbWJlciBsb29rdXBzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gYXJncy5jb250cm9sbGVyIC0gRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlci5cbiAgICogQHBhcmFtIHtBdHRhY2htZW50T3duZXJTY29wZX0gYXJncy5vd25lclNjb3BlIC0gT3duZXIgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtBdHRhY2htZW50T3duZXJSZXNvdXJjZVtdfSAtIE1hdGNoaW5nIG93bmVyIHJlc291cmNlcy5cbiAgICovXG4gIGF0dGFjaG1lbnRPd25lclJlc291cmNlcyh7Y29udHJvbGxlciwgb3duZXJTY29wZX0pIHtcbiAgICBpZiAob3duZXJTY29wZS5yZXNvdXJjZU5hbWUpIHtcbiAgICAgIGNvbnN0IG93bmVyUmVzb3VyY2UgPSB0aGlzLmF0dGFjaG1lbnRPd25lclJlc291cmNlKHtcbiAgICAgICAgY29udHJvbGxlcixcbiAgICAgICAgb3duZXJTY29wZTogey4uLm93bmVyU2NvcGUsIHJlc291cmNlTmFtZTogb3duZXJTY29wZS5yZXNvdXJjZU5hbWV9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gb3duZXJSZXNvdXJjZSA/IFtvd25lclJlc291cmNlXSA6IFtdXG4gICAgfVxuXG4gICAgY29uc3Qgb3duZXJSZXNvdXJjZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb250cm9sbGVyLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgICAgZm9yIChjb25zdCByZXNvdXJjZU5hbWUgb2YgT2JqZWN0LmtleXMoZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KSkpIHtcbiAgICAgICAgY29uc3Qgb3duZXJSZXNvdXJjZSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtiYWNrZW5kUHJvamVjdCwgbW9kZWxOYW1lOiByZXNvdXJjZU5hbWV9KVxuXG4gICAgICAgIGlmICghb3duZXJSZXNvdXJjZSkgY29udGludWVcblxuICAgICAgICBjb25zdCBvd25lck1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3Mob3duZXJSZXNvdXJjZSlcblxuICAgICAgICBpZiAob3duZXJNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpICE9PSBvd25lclNjb3BlLnJlY29yZFR5cGUpIGNvbnRpbnVlXG4gICAgICAgIGlmICghb3duZXJSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0YWNobWVudHM/Lltvd25lclNjb3BlLm5hbWVdKSBjb250aW51ZVxuXG4gICAgICAgIG93bmVyUmVzb3VyY2VzLnB1c2gob3duZXJSZXNvdXJjZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gb3duZXJSZXNvdXJjZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgdGhhdCBvd25zIGFuIGF0dGFjaG1lbnQgc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbnRyb2xsZXIgLSBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIHJlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZywgcmVzb3VyY2VOYW1lOiBzdHJpbmd9fSBhcmdzLm93bmVyU2NvcGUgLSBPd25lciBzY29wZS5cbiAgICogQHJldHVybnMge0F0dGFjaG1lbnRPd25lclJlc291cmNlIHwgbnVsbH0gLSBPd25lciByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgYXR0YWNobWVudE93bmVyUmVzb3VyY2Uoe2NvbnRyb2xsZXIsIG93bmVyU2NvcGV9KSB7XG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29udHJvbGxlci5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKClcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0QXR0YWNobWVudCA9IG51bGxcblxuICAgIGlmIChiYWNrZW5kUHJvamVjdHMubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiVmVsb2Npb3VzQXR0YWNobWVudCByZXF1aXJlcyBhIGJhY2tlbmQgcHJvamVjdFwiKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGNvbnN0IG93bmVyUmVzb3VyY2UgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JCYWNrZW5kUHJvamVjdE1vZGVsTmFtZSh7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICBtb2RlbE5hbWU6IG93bmVyU2NvcGUucmVzb3VyY2VOYW1lXG4gICAgICB9KVxuXG4gICAgICBpZiAoIW93bmVyUmVzb3VyY2UpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IG93bmVyTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhvd25lclJlc291cmNlKVxuXG4gICAgICBpZiAoIW93bmVyTW9kZWxDbGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yIGF0dGFjaG1lbnQgb3duZXIgJHtvd25lclNjb3BlLnJlc291cmNlTmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBvd25lclJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hdHRhY2htZW50cyB8fCB7fVxuXG4gICAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb25zW293bmVyU2NvcGUubmFtZV0pIHJldHVybiBvd25lclJlc291cmNlXG5cbiAgICAgIHJlc291cmNlV2l0aG91dEF0dGFjaG1lbnQgfHw9IG93bmVyUmVzb3VyY2VcbiAgICB9XG5cbiAgICBpZiAocmVzb3VyY2VXaXRob3V0QXR0YWNobWVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50ICcke293bmVyU2NvcGUubmFtZX0nIGNvbmZpZ3VyZWQgZm9yICR7b3duZXJTY29wZS5yZXNvdXJjZU5hbWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG4iXX0=