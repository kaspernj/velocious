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
            if (ownerModelClass.getModelName() !== ownerScope.recordType)
                continue;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvdmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8seUJBQXlCLE1BQU0sb0JBQW9CLENBQUE7QUFDMUQsT0FBTyxtQkFBbUIsTUFBTSxxREFBcUQsQ0FBQTtBQUNyRixPQUFPLEVBQUMsdUNBQXVDLEVBQUMsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNqRyxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLEVBQUMseUJBQXlCLEVBQUUsZ0NBQWdDLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUV6Ryx3SEFBd0g7QUFDeEgsMFVBQTBVO0FBRTFVOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDJCQUE0QixTQUFRLHlCQUF5QjtJQUNoRixNQUFNLENBQUMsVUFBVSxHQUFHLG1CQUFtQixDQUFBO0lBRXZDLHNHQUFzRztJQUN0RyxNQUFNLENBQUMsVUFBVSxHQUFHO1FBQ2xCLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDM0IsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQzFDLFNBQVMsRUFBRSxFQUFDLElBQUksRUFBRSxVQUFVLEVBQUM7UUFDN0IsUUFBUSxFQUFFLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMzQixFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUUsTUFBTSxFQUFDO1FBQ2xCLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDdkIsUUFBUSxFQUFFLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMzQixRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFD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cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGZyb20gXCIuL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0IFZlbG9jaW91c0F0dGFjaG1lbnQgZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC9hdHRhY2htZW50cy9hdHRhY2htZW50LXJlY29yZC5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCBtb2RlbFByaW1hcnlLZXlWYWx1ZUZyb21DYWNoZUtleX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqIEB0eXBlZGVmIHt7bmFtZTogc3RyaW5nLCByZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nIHwgbnVsbH19IEF0dGFjaG1lbnRPd25lclNjb3BlICovXG4vKiogQHR5cGVkZWYge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSwgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufX0gQXR0YWNobWVudE93bmVyUmVzb3VyY2UgKi9cblxuLyoqXG4gKiBGcmFtZXdvcmstb3duZWQgZnJvbnRlbmQgcmVzb3VyY2UgZXhwb3Npbmcgc2FmZSBhdHRhY2htZW50IG1ldGFkYXRhIHdoaWxlXG4gKiBkZWxlZ2F0aW5nIHJlYWQgYXV0aG9yaXphdGlvbiB0byB0aGUgYXR0YWNoZWQgb3duZXIgcmVjb3JkLlxuICogQGF1Z21lbnRzIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPHR5cGVvZiBWZWxvY2lvdXNBdHRhY2htZW50Pn1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQXR0YWNobWVudFJlc291cmNlIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB7XG4gIHN0YXRpYyBNb2RlbENsYXNzID0gVmVsb2Npb3VzQXR0YWNobWVudFxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0cmlidXRlQ29uZmlndXJhdGlvbj59ICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzID0ge1xuICAgIGJ5dGVTaXplOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgIGNvbnRlbnRUeXBlOiB7bnVsbDogdHJ1ZSwgdHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgIGNyZWF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn0sXG4gICAgZmlsZW5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgaWQ6IHt0eXBlOiBcInV1aWRcIn0sXG4gICAgbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICBwb3NpdGlvbjoge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICByZWNvcmRJZDoge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICByZWNvcmRUeXBlOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgIHVwZGF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn1cbiAgfVxuXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIHN0YXRpYyBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gW1wiaW5kZXhcIl1cblxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBzdGF0aWMgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gW1wiZmluZFwiXVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IG1ldGFkYXRhIHF1ZXJ5IGFmdGVyIG93bmVyLXNjb3BlIGF1dGhvcml6YXRpb24gaGFzXG4gICAqIHZhbGlkYXRlZCB0aGUgcmVxdWVzdCB0aHJvdWdoIGJlZm9yZUFjdGlvbi9maW5kLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS1yZXNvdXJjZS5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb259IGFjdGlvbiAtIEZyb250ZW5kLW1vZGVsIGFjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0F0dGFjaG1lbnQ+fSAtIEF0dGFjaG1lbnQgcXVlcnkuXG4gICAqL1xuICBhdXRob3JpemVkUXVlcnkoYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBWZWxvY2lvdXNBdHRhY2htZW50LmFsbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgYWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYmVmb3JlQWN0aW9uKGFjdGlvbikge1xuICAgIGlmIChhY3Rpb24gIT09IFwiaW5kZXhcIikgcmV0dXJuXG5cbiAgICBjb25zdCBhdXRob3JpemVkID0gYXdhaXQgdGhpcy5hdHRhY2htZW50T3duZXJBdXRob3JpemVkKHRoaXMucmVxdWlyZWRPd25lclNjb3BlRnJvbVBhcmFtcygpKVxuXG4gICAgaWYgKCFhdXRob3JpemVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IG93bmVyIG5vdCBmb3VuZCBvciBub3QgYXV0aG9yaXplZFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhdHRhY2htZW50IG1ldGFkYXRhIGFmdGVyIHJlbW92aW5nIHRoZSBhdXRob3JpemF0aW9uLW9ubHkgcmVzb3VyY2UgbmFtZSBmcm9tIGRhdGFiYXNlIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnRbXT59IC0gQXR0YWNobWVudCBtZXRhZGF0YSByb3dzLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkcygpIHtcbiAgICBjb25zdCBjb250cm9sbGVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLmNvbnRyb2xsZXJJbnN0YW5jZSgpKVxuICAgIGNvbnN0IHBhcmFtcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG4gICAgY29uc3Qgd2hlcmUgPSB7Li4udGhpcy5yZXF1aXJlZFdoZXJlRnJvbVBhcmFtcygpfVxuXG4gICAgZGVsZXRlIHdoZXJlLnJlc291cmNlTmFtZVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbnRyb2xsZXIud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoey4uLnBhcmFtcywgd2hlcmV9LCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmluZGV4UXVlcnkoKS50b0FycmF5KCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge1wiZmluZFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VmVsb2Npb3VzQXR0YWNobWVudCB8IG51bGw+fSAtIExvY2F0ZWQgYXR0YWNobWVudCB3aGVuIG93bmVyIGlzIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBmaW5kKGFjdGlvbiwgaWQpIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgY29uc3QgYXR0YWNobWVudCA9IGF3YWl0IFZlbG9jaW91c0F0dGFjaG1lbnQuZmluZEJ5KHtpZH0pXG5cbiAgICBpZiAoIWF0dGFjaG1lbnQpIHJldHVybiBudWxsXG4gICAgaWYgKCFhd2FpdCB0aGlzLmF0dGFjaG1lbnRPd25lckF1dGhvcml6ZWQodGhpcy5vd25lclNjb3BlRnJvbUF0dGFjaG1lbnQoYXR0YWNobWVudCkpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZWQgYXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0F0dGFjaG1lbnR9IG1vZGVsIC0gQXR0YWNobWVudCBtb2RlbC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gQ3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICBjcmVhdGVkQXRBdHRyaWJ1dGUobW9kZWwpIHtcbiAgICByZXR1cm4gbmV3IERhdGUobW9kZWwuY3JlYXRlZEF0TXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZWQgYXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0F0dGFjaG1lbnR9IG1vZGVsIC0gQXR0YWNobWVudCBtb2RlbC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gVXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICB1cGRhdGVkQXRBdHRyaWJ1dGUobW9kZWwpIHtcbiAgICByZXR1cm4gbmV3IERhdGUobW9kZWwudXBkYXRlZEF0TXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgdmFsaWRhdGVkIG93bmVyIHNjb3BlIGZyb20gZnJvbnRlbmQtbW9kZWwgd2hlcmUgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7QXR0YWNobWVudE93bmVyU2NvcGV9IC0gQXR0YWNobWVudCBvd25lciBzY29wZS5cbiAgICovXG4gIHJlcXVpcmVkT3duZXJTY29wZUZyb21QYXJhbXMoKSB7XG4gICAgY29uc3Qgd2hlcmUgPSB0aGlzLnJlcXVpcmVkV2hlcmVGcm9tUGFyYW1zKClcbiAgICBjb25zdCByZWNvcmRUeXBlID0gdGhpcy5yZXF1aXJlZFNpbmdsZVdoZXJlVmFsdWUoe2F0dHJpYnV0ZU5hbWU6IFwicmVjb3JkVHlwZVwiLCB3aGVyZX0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgbmFtZTogdGhpcy5yZXF1aXJlZFNpbmdsZVdoZXJlVmFsdWUoe2F0dHJpYnV0ZU5hbWU6IFwibmFtZVwiLCB3aGVyZX0pLFxuICAgICAgcmVjb3JkSWQ6IHRoaXMucmVxdWlyZWRTaW5nbGVXaGVyZVZhbHVlKHthdHRyaWJ1dGVOYW1lOiBcInJlY29yZElkXCIsIHdoZXJlfSksXG4gICAgICByZWNvcmRUeXBlLFxuICAgICAgcmVzb3VyY2VOYW1lOiB0aGlzLnJlcXVpcmVkU2luZ2xlV2hlcmVWYWx1ZSh7YXR0cmlidXRlTmFtZTogXCJyZXNvdXJjZU5hbWVcIiwgd2hlcmV9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSByZXF1aXJlZCBhdHRhY2htZW50IG1ldGFkYXRhIHdoZXJlIG9iamVjdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBBdHRhY2htZW50IHdoZXJlIGZpbHRlcnMuXG4gICAqL1xuICByZXF1aXJlZFdoZXJlRnJvbVBhcmFtcygpIHtcbiAgICBjb25zdCB3aGVyZSA9IHRoaXMucGFyYW1zKCkud2hlcmVcblxuICAgIGlmICghaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlZlbG9jaW91c0F0dGFjaG1lbnQgaW5kZXggcmVxdWlyZXMgcmVzb3VyY2VOYW1lLCByZWNvcmRUeXBlLCByZWNvcmRJZCwgYW5kIG5hbWUgd2hlcmUgZmlsdGVyc1wiKVxuICAgIH1cblxuICAgIHJldHVybiB3aGVyZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIG9uZSByZXF1aXJlZCBzdHJpbmctbGlrZSB3aGVyZSB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLndoZXJlIC0gV2hlcmUgaGFzaC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTdHJpbmcgdmFsdWUuXG4gICAqL1xuICByZXF1aXJlZFNpbmdsZVdoZXJlVmFsdWUoe2F0dHJpYnV0ZU5hbWUsIHdoZXJlfSkge1xuICAgIGNvbnN0IHZhbHVlID0gd2hlcmVbYXR0cmlidXRlTmFtZV1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gU3RyaW5nKHZhbHVlKVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBWZWxvY2lvdXNBdHRhY2htZW50IGluZGV4IHJlcXVpcmVzIGEgc2luZ2xlICR7YXR0cmlidXRlTmFtZX0gd2hlcmUgZmlsdGVyYClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgb3duZXIgc2NvcGUgZnJvbSBhIHN0b3JlZCBhdHRhY2htZW50IHJvdy5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNBdHRhY2htZW50fSBhdHRhY2htZW50IC0gQXR0YWNobWVudCByb3cuXG4gICAqIEByZXR1cm5zIHtBdHRhY2htZW50T3duZXJTY29wZX0gLSBPd25lciBzY29wZS5cbiAgICovXG4gIG93bmVyU2NvcGVGcm9tQXR0YWNobWVudChhdHRhY2htZW50KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IGF0dGFjaG1lbnQubmFtZSgpLFxuICAgICAgcmVjb3JkSWQ6IGF0dGFjaG1lbnQucmVjb3JkSWQoKSxcbiAgICAgIHJlY29yZFR5cGU6IGF0dGFjaG1lbnQucmVjb3JkVHlwZSgpLFxuICAgICAgcmVzb3VyY2VOYW1lOiBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIHRoZSBjdXJyZW50IGFiaWxpdHkgY2FuIHJlYWQgdGhlIGF0dGFjaG1lbnQgb3duZXIuXG4gICAqIEBwYXJhbSB7QXR0YWNobWVudE93bmVyU2NvcGV9IG93bmVyU2NvcGUgLSBPd25lciBzY29wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBvd25lciBpcyByZWFkYWJsZS5cbiAgICovXG4gIGFzeW5jIGF0dGFjaG1lbnRPd25lckF1dGhvcml6ZWQob3duZXJTY29wZSkge1xuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkpXG4gICAgY29uc3Qgb3duZXJSZXNvdXJjZXMgPSB0aGlzLmF0dGFjaG1lbnRPd25lclJlc291cmNlcyh7Y29udHJvbGxlciwgb3duZXJTY29wZX0pXG5cbiAgICBpZiAob3duZXJSZXNvdXJjZXMubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmVkIGZvciBhdHRhY2htZW50IG93bmVyICR7b3duZXJTY29wZS5yZXNvdXJjZU5hbWUgPz8gb3duZXJTY29wZS5yZWNvcmRUeXBlfWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvd25lclJlc291cmNlIG9mIG93bmVyUmVzb3VyY2VzKSB7XG4gICAgICBjb25zdCBvd25lck1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3Mob3duZXJSZXNvdXJjZSlcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsUmVjb3JkQ2xhc3NJbml0aWFsaXplZChvd25lck1vZGVsQ2xhc3MpXG5cbiAgICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSBvd25lclJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXMuZmluZCB8fCBvd25lclJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXMuaW5kZXggfHwgXCJyZWFkXCJcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBvd25lck1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgICBjb25zdCBvd25lcklkZW50aXR5ID0gbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXkocHJpbWFyeUtleSwgb3duZXJTY29wZS5yZWNvcmRJZClcbiAgICAgIGNvbnN0IG93bmVyID0gYXdhaXQgb3duZXJNb2RlbENsYXNzXG4gICAgICAgIC5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24sIHRoaXMuYWJpbGl0eSlcbiAgICAgICAgLmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIG93bmVySWRlbnRpdHkpKVxuXG4gICAgICBpZiAob3duZXIpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGV4cGxpY2l0IG93bmVyIHJlc291cmNlIGZvciBzY29wZWQgcXVlcmllcyBvciBldmVyeSBtYXRjaGluZyBhbGlhcyBmb3IgbWVtYmVyIGxvb2t1cHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbnRyb2xsZXIgLSBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge0F0dGFjaG1lbnRPd25lclNjb3BlfSBhcmdzLm93bmVyU2NvcGUgLSBPd25lciBzY29wZS5cbiAgICogQHJldHVybnMge0F0dGFjaG1lbnRPd25lclJlc291cmNlW119IC0gTWF0Y2hpbmcgb3duZXIgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXR0YWNobWVudE93bmVyUmVzb3VyY2VzKHtjb250cm9sbGVyLCBvd25lclNjb3BlfSkge1xuICAgIGlmIChvd25lclNjb3BlLnJlc291cmNlTmFtZSkge1xuICAgICAgY29uc3Qgb3duZXJSZXNvdXJjZSA9IHRoaXMuYXR0YWNobWVudE93bmVyUmVzb3VyY2Uoe1xuICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICBvd25lclNjb3BlOiB7Li4ub3duZXJTY29wZSwgcmVzb3VyY2VOYW1lOiBvd25lclNjb3BlLnJlc291cmNlTmFtZX1cbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBvd25lclJlc291cmNlID8gW293bmVyUmVzb3VyY2VdIDogW11cbiAgICB9XG5cbiAgICBjb25zdCBvd25lclJlc291cmNlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbnRyb2xsZXIuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgICBmb3IgKGNvbnN0IHJlc291cmNlTmFtZSBvZiBPYmplY3Qua2V5cyhmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpKSkge1xuICAgICAgICBjb25zdCBvd25lclJlc291cmNlID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWU6IHJlc291cmNlTmFtZX0pXG5cbiAgICAgICAgaWYgKCFvd25lclJlc291cmNlKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IG93bmVyTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhvd25lclJlc291cmNlKVxuXG4gICAgICAgIGlmIChvd25lck1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkgIT09IG93bmVyU2NvcGUucmVjb3JkVHlwZSkgY29udGludWVcbiAgICAgICAgaWYgKCFvd25lclJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hdHRhY2htZW50cz8uW293bmVyU2NvcGUubmFtZV0pIGNvbnRpbnVlXG5cbiAgICAgICAgb3duZXJSZXNvdXJjZXMucHVzaChvd25lclJlc291cmNlKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvd25lclJlc291cmNlc1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSB0aGF0IG93bnMgYW4gYXR0YWNobWVudCBzY29wZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29udHJvbGxlciAtIEZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIuXG4gICAqIEBwYXJhbSB7e25hbWU6IHN0cmluZywgcmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZ319IGFyZ3Mub3duZXJTY29wZSAtIE93bmVyIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7QXR0YWNobWVudE93bmVyUmVzb3VyY2UgfCBudWxsfSAtIE93bmVyIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBhdHRhY2htZW50T3duZXJSZXNvdXJjZSh7Y29udHJvbGxlciwgb3duZXJTY29wZX0pIHtcbiAgICBjb25zdCBiYWNrZW5kUHJvamVjdHMgPSBjb250cm9sbGVyLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKVxuICAgIGxldCByZXNvdXJjZVdpdGhvdXRBdHRhY2htZW50ID0gbnVsbFxuXG4gICAgaWYgKGJhY2tlbmRQcm9qZWN0cy5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJWZWxvY2lvdXNBdHRhY2htZW50IHJlcXVpcmVzIGEgYmFja2VuZCBwcm9qZWN0XCIpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgY29uc3Qgb3duZXJSZXNvdXJjZSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtcbiAgICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICAgIG1vZGVsTmFtZTogb3duZXJTY29wZS5yZXNvdXJjZU5hbWVcbiAgICAgIH0pXG5cbiAgICAgIGlmICghb3duZXJSZXNvdXJjZSkgY29udGludWVcblxuICAgICAgY29uc3Qgb3duZXJNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKG93bmVyUmVzb3VyY2UpXG5cbiAgICAgIGlmICghb3duZXJNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgYXR0YWNobWVudCBvd25lciAke293bmVyU2NvcGUucmVzb3VyY2VOYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGlmIChvd25lck1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkgIT09IG93bmVyU2NvcGUucmVjb3JkVHlwZSkgY29udGludWVcblxuICAgICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gb3duZXJSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0YWNobWVudHMgfHwge31cblxuICAgICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uc1tvd25lclNjb3BlLm5hbWVdKSByZXR1cm4gb3duZXJSZXNvdXJjZVxuXG4gICAgICByZXNvdXJjZVdpdGhvdXRBdHRhY2htZW50IHx8PSBvd25lclJlc291cmNlXG4gICAgfVxuXG4gICAgaWYgKHJlc291cmNlV2l0aG91dEF0dGFjaG1lbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCAnJHtvd25lclNjb3BlLm5hbWV9JyBjb25maWd1cmVkIGZvciAke293bmVyU2NvcGUucmVzb3VyY2VOYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuIl19