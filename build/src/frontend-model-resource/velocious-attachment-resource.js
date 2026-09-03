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
     * @returns {{name: string, recordId: string, recordType: string, resourceName: string}} - Attachment owner scope.
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
     * @returns {{name: string, recordId: string, recordType: string, resourceName: string}} - Owner scope.
     */
    ownerScopeFromAttachment(attachment) {
        return {
            name: attachment.name(),
            recordId: attachment.recordId(),
            recordType: attachment.recordType(),
            resourceName: attachment.recordType()
        };
    }
    /**
     * Checks whether the current ability can read the attachment owner.
     * @param {{name: string, recordId: string, recordType: string, resourceName: string}} ownerScope - Owner scope.
     * @returns {Promise<boolean>} - Whether owner is readable.
     */
    async attachmentOwnerAuthorized(ownerScope) {
        const controller = /** @type {import("../frontend-model-controller.js").default} */ (this.controllerInstance());
        const ownerResource = this.attachmentOwnerResource({ controller, ownerScope });
        if (!ownerResource) {
            throw new Error(`No frontend model resource configured for attachment owner ${ownerScope.resourceName}`);
        }
        const ownerModelClass = controller.frontendModelResourceModelClass(ownerResource);
        if (!ownerModelClass) {
            throw new Error(`No model class configured for attachment owner ${ownerScope.resourceName}`);
        }
        if (ownerModelClass.getModelName() !== ownerScope.recordType) {
            throw new Error(`Attachment owner resource ${ownerScope.resourceName} does not use backing model ${ownerScope.recordType}`);
        }
        const attachmentDefinitions = ownerResource.resourceConfiguration.attachments || {};
        if (!attachmentDefinitions[ownerScope.name]) {
            throw new Error(`No attachment '${ownerScope.name}' configured for ${ownerScope.resourceName}`);
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
     * @param {{name: string, recordId: string, recordType: string, resourceName: string}} args.ownerScope - Owner scope.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvdmVsb2Npb3VzLWF0dGFjaG1lbnQtcmVzb3VyY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8seUJBQXlCLE1BQU0sb0JBQW9CLENBQUE7QUFDMUQsT0FBTyxtQkFBbUIsTUFBTSxxREFBcUQsQ0FBQTtBQUNyRixPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLEVBQUMseUJBQXlCLEVBQUUsZ0NBQWdDLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUV6Rzs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTywyQkFBNEIsU0FBUSx5QkFBeUI7SUFDaEYsTUFBTSxDQUFDLFVBQVUsR0FBRyxtQkFBbUIsQ0FBQTtJQUV2QyxzR0FBc0c7SUFDdEcsTUFBTSxDQUFDLFVBQVUsR0FBRztRQUNsQixRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQzNCLFdBQVcsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMxQyxTQUFTLEVBQUUsRUFBQyxJQUFJLEVBQUUsVUFBVSxFQUFDO1FBQzdCLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDM0IsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLE1BQU0sRUFBQztRQUNsQixJQUFJLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQ3ZCLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUM7UUFDM0IsUUFBUSxFQUFFLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUMzQixVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQzdCLFNBQVMsRUFBRSxFQUFDLElBQUksRUFB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LENBQUM7Z0JBQUUsT0FBTyxhQUFhLENBQUE7WUFFaEUseUJBQXlCLEtBQUssYUFBYSxDQUFBO1FBQzdDLENBQUM7UUFFRCxJQUFJLHlCQUF5QixFQUFFLENBQUM7WUFDOUIsTUFBTSxJQUFJLEtBQUssQ0FBQyxrQkFBa0IsVUFBVSxDQUFDLElBQUksb0JBQW9CLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFBO1FBQ2pHLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBmcm9tIFwiLi9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNBdHRhY2htZW50IGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQvYXR0YWNobWVudHMvYXR0YWNobWVudC1yZWNvcmQuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIG1vZGVsUHJpbWFyeUtleVZhbHVlRnJvbUNhY2hlS2V5fSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIEZyYW1ld29yay1vd25lZCBmcm9udGVuZCByZXNvdXJjZSBleHBvc2luZyBzYWZlIGF0dGFjaG1lbnQgbWV0YWRhdGEgd2hpbGVcbiAqIGRlbGVnYXRpbmcgcmVhZCBhdXRob3JpemF0aW9uIHRvIHRoZSBhdHRhY2hlZCBvd25lciByZWNvcmQuXG4gKiBAYXVnbWVudHMge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8dHlwZW9mIFZlbG9jaW91c0F0dGFjaG1lbnQ+fVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNBdHRhY2htZW50UmVzb3VyY2UgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHtcbiAgc3RhdGljIE1vZGVsQ2xhc3MgPSBWZWxvY2lvdXNBdHRhY2htZW50XG5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRyaWJ1dGVDb25maWd1cmF0aW9uPn0gKi9cbiAgc3RhdGljIGF0dHJpYnV0ZXMgPSB7XG4gICAgYnl0ZVNpemU6IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgY29udGVudFR5cGU6IHtudWxsOiB0cnVlLCB0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgY3JlYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifSxcbiAgICBmaWxlbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICBpZDoge3R5cGU6IFwidXVpZFwifSxcbiAgICBuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgIHBvc2l0aW9uOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgIHJlY29yZElkOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgIHJlY29yZFR5cGU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgdXBkYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifVxuICB9XG5cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSBbXCJpbmRleFwiXVxuXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIHN0YXRpYyBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSBbXCJmaW5kXCJdXG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgbWV0YWRhdGEgcXVlcnkgYWZ0ZXIgb3duZXItc2NvcGUgYXV0aG9yaXphdGlvbiBoYXNcbiAgICogdmFsaWRhdGVkIHRoZSByZXF1ZXN0IHRocm91Z2ggYmVmb3JlQWN0aW9uL2ZpbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLXJlc291cmNlLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbn0gYWN0aW9uIC0gRnJvbnRlbmQtbW9kZWwgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzQXR0YWNobWVudD59IC0gQXR0YWNobWVudCBxdWVyeS5cbiAgICovXG4gIGF1dGhvcml6ZWRRdWVyeShhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIFZlbG9jaW91c0F0dGFjaG1lbnQuYWxsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBiZWZvcmVBY3Rpb24oYWN0aW9uKSB7XG4gICAgaWYgKGFjdGlvbiAhPT0gXCJpbmRleFwiKSByZXR1cm5cblxuICAgIGNvbnN0IGF1dGhvcml6ZWQgPSBhd2FpdCB0aGlzLmF0dGFjaG1lbnRPd25lckF1dGhvcml6ZWQodGhpcy5yZXF1aXJlZE93bmVyU2NvcGVGcm9tUGFyYW1zKCkpXG5cbiAgICBpZiAoIWF1dGhvcml6ZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgb3duZXIgbm90IGZvdW5kIG9yIG5vdCBhdXRob3JpemVkXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGF0dGFjaG1lbnQgbWV0YWRhdGEgYWZ0ZXIgcmVtb3ZpbmcgdGhlIGF1dGhvcml6YXRpb24tb25seSByZXNvdXJjZSBuYW1lIGZyb20gZGF0YWJhc2UgZmlsdGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VmVsb2Npb3VzQXR0YWNobWVudFtdPn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIHJvd3MuXG4gICAqL1xuICBhc3luYyByZWNvcmRzKCkge1xuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkpXG4gICAgY29uc3QgcGFyYW1zID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUGFyYW1zKClcbiAgICBjb25zdCB3aGVyZSA9IHsuLi50aGlzLnJlcXVpcmVkV2hlcmVGcm9tUGFyYW1zKCl9XG5cbiAgICBkZWxldGUgd2hlcmUucmVzb3VyY2VOYW1lXG5cbiAgICByZXR1cm4gYXdhaXQgY29udHJvbGxlci53aXRoRnJvbnRlbmRNb2RlbFBhcmFtcyh7Li4ucGFyYW1zLCB3aGVyZX0sIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuaW5kZXhRdWVyeSgpLnRvQXJyYXkoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7XCJmaW5kXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gaWQgLSBBdHRhY2htZW50IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50IHwgbnVsbD59IC0gTG9jYXRlZCBhdHRhY2htZW50IHdoZW4gb3duZXIgaXMgYXV0aG9yaXplZC5cbiAgICovXG4gIGFzeW5jIGZpbmQoYWN0aW9uLCBpZCkge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICBjb25zdCBhdHRhY2htZW50ID0gYXdhaXQgVmVsb2Npb3VzQXR0YWNobWVudC5maW5kQnkoe2lkfSlcblxuICAgIGlmICghYXR0YWNobWVudCkgcmV0dXJuIG51bGxcbiAgICBpZiAoIWF3YWl0IHRoaXMuYXR0YWNobWVudE93bmVyQXV0aG9yaXplZCh0aGlzLm93bmVyU2NvcGVGcm9tQXR0YWNobWVudChhdHRhY2htZW50KSkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXR0YWNobWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlZCBhdCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzQXR0YWNobWVudH0gbW9kZWwgLSBBdHRhY2htZW50IG1vZGVsLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBDcmVhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIGNyZWF0ZWRBdEF0dHJpYnV0ZShtb2RlbCkge1xuICAgIHJldHVybiBuZXcgRGF0ZShtb2RlbC5jcmVhdGVkQXRNcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlZCBhdCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzQXR0YWNobWVudH0gbW9kZWwgLSBBdHRhY2htZW50IG1vZGVsLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBVcGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIHVwZGF0ZWRBdEF0dHJpYnV0ZShtb2RlbCkge1xuICAgIHJldHVybiBuZXcgRGF0ZShtb2RlbC51cGRhdGVkQXRNcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSB2YWxpZGF0ZWQgb3duZXIgc2NvcGUgZnJvbSBmcm9udGVuZC1tb2RlbCB3aGVyZSBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt7bmFtZTogc3RyaW5nLCByZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfX0gLSBBdHRhY2htZW50IG93bmVyIHNjb3BlLlxuICAgKi9cbiAgcmVxdWlyZWRPd25lclNjb3BlRnJvbVBhcmFtcygpIHtcbiAgICBjb25zdCB3aGVyZSA9IHRoaXMucmVxdWlyZWRXaGVyZUZyb21QYXJhbXMoKVxuICAgIGNvbnN0IHJlY29yZFR5cGUgPSB0aGlzLnJlcXVpcmVkU2luZ2xlV2hlcmVWYWx1ZSh7YXR0cmlidXRlTmFtZTogXCJyZWNvcmRUeXBlXCIsIHdoZXJlfSlcblxuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB0aGlzLnJlcXVpcmVkU2luZ2xlV2hlcmVWYWx1ZSh7YXR0cmlidXRlTmFtZTogXCJuYW1lXCIsIHdoZXJlfSksXG4gICAgICByZWNvcmRJZDogdGhpcy5yZXF1aXJlZFNpbmdsZVdoZXJlVmFsdWUoe2F0dHJpYnV0ZU5hbWU6IFwicmVjb3JkSWRcIiwgd2hlcmV9KSxcbiAgICAgIHJlY29yZFR5cGUsXG4gICAgICByZXNvdXJjZU5hbWU6IHRoaXMucmVxdWlyZWRTaW5nbGVXaGVyZVZhbHVlKHthdHRyaWJ1dGVOYW1lOiBcInJlc291cmNlTmFtZVwiLCB3aGVyZX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJlcXVpcmVkIGF0dGFjaG1lbnQgbWV0YWRhdGEgd2hlcmUgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEF0dGFjaG1lbnQgd2hlcmUgZmlsdGVycy5cbiAgICovXG4gIHJlcXVpcmVkV2hlcmVGcm9tUGFyYW1zKCkge1xuICAgIGNvbnN0IHdoZXJlID0gdGhpcy5wYXJhbXMoKS53aGVyZVxuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHdoZXJlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVmVsb2Npb3VzQXR0YWNobWVudCBpbmRleCByZXF1aXJlcyByZXNvdXJjZU5hbWUsIHJlY29yZFR5cGUsIHJlY29yZElkLCBhbmQgbmFtZSB3aGVyZSBmaWx0ZXJzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHdoZXJlXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgb25lIHJlcXVpcmVkIHN0cmluZy1saWtlIHdoZXJlIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mud2hlcmUgLSBXaGVyZSBoYXNoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0cmluZyB2YWx1ZS5cbiAgICovXG4gIHJlcXVpcmVkU2luZ2xlV2hlcmVWYWx1ZSh7YXR0cmlidXRlTmFtZSwgd2hlcmV9KSB7XG4gICAgY29uc3QgdmFsdWUgPSB3aGVyZVthdHRyaWJ1dGVOYW1lXVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiBTdHJpbmcodmFsdWUpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFZlbG9jaW91c0F0dGFjaG1lbnQgaW5kZXggcmVxdWlyZXMgYSBzaW5nbGUgJHthdHRyaWJ1dGVOYW1lfSB3aGVyZSBmaWx0ZXJgKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBvd25lciBzY29wZSBmcm9tIGEgc3RvcmVkIGF0dGFjaG1lbnQgcm93LlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0F0dGFjaG1lbnR9IGF0dGFjaG1lbnQgLSBBdHRhY2htZW50IHJvdy5cbiAgICogQHJldHVybnMge3tuYW1lOiBzdHJpbmcsIHJlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZywgcmVzb3VyY2VOYW1lOiBzdHJpbmd9fSAtIE93bmVyIHNjb3BlLlxuICAgKi9cbiAgb3duZXJTY29wZUZyb21BdHRhY2htZW50KGF0dGFjaG1lbnQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZTogYXR0YWNobWVudC5uYW1lKCksXG4gICAgICByZWNvcmRJZDogYXR0YWNobWVudC5yZWNvcmRJZCgpLFxuICAgICAgcmVjb3JkVHlwZTogYXR0YWNobWVudC5yZWNvcmRUeXBlKCksXG4gICAgICByZXNvdXJjZU5hbWU6IGF0dGFjaG1lbnQucmVjb3JkVHlwZSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIHRoZSBjdXJyZW50IGFiaWxpdHkgY2FuIHJlYWQgdGhlIGF0dGFjaG1lbnQgb3duZXIuXG4gICAqIEBwYXJhbSB7e25hbWU6IHN0cmluZywgcmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZ319IG93bmVyU2NvcGUgLSBPd25lciBzY29wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBvd25lciBpcyByZWFkYWJsZS5cbiAgICovXG4gIGFzeW5jIGF0dGFjaG1lbnRPd25lckF1dGhvcml6ZWQob3duZXJTY29wZSkge1xuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkpXG4gICAgY29uc3Qgb3duZXJSZXNvdXJjZSA9IHRoaXMuYXR0YWNobWVudE93bmVyUmVzb3VyY2Uoe2NvbnRyb2xsZXIsIG93bmVyU2NvcGV9KVxuXG4gICAgaWYgKCFvd25lclJlc291cmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyZWQgZm9yIGF0dGFjaG1lbnQgb3duZXIgJHtvd25lclNjb3BlLnJlc291cmNlTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG93bmVyTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhvd25lclJlc291cmNlKVxuXG4gICAgaWYgKCFvd25lck1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgYXR0YWNobWVudCBvd25lciAke293bmVyU2NvcGUucmVzb3VyY2VOYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKG93bmVyTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSAhPT0gb3duZXJTY29wZS5yZWNvcmRUeXBlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgb3duZXIgcmVzb3VyY2UgJHtvd25lclNjb3BlLnJlc291cmNlTmFtZX0gZG9lcyBub3QgdXNlIGJhY2tpbmcgbW9kZWwgJHtvd25lclNjb3BlLnJlY29yZFR5cGV9YClcbiAgICB9XG5cbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBvd25lclJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hdHRhY2htZW50cyB8fCB7fVxuXG4gICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbnNbb3duZXJTY29wZS5uYW1lXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50ICcke293bmVyU2NvcGUubmFtZX0nIGNvbmZpZ3VyZWQgZm9yICR7b3duZXJTY29wZS5yZXNvdXJjZU5hbWV9YClcbiAgICB9XG5cbiAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxSZWNvcmRDbGFzc0luaXRpYWxpemVkKG93bmVyTW9kZWxDbGFzcylcblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSBvd25lclJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXMuZmluZCB8fCBvd25lclJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXMuaW5kZXggfHwgXCJyZWFkXCJcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gb3duZXJNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IG93bmVySWRlbnRpdHkgPSBtb2RlbFByaW1hcnlLZXlWYWx1ZUZyb21DYWNoZUtleShwcmltYXJ5S2V5LCBvd25lclNjb3BlLnJlY29yZElkKVxuICAgIGNvbnN0IG93bmVyID0gYXdhaXQgb3duZXJNb2RlbENsYXNzXG4gICAgICAuYWNjZXNzaWJsZUZvcihhYmlsaXR5QWN0aW9uLCB0aGlzLmFiaWxpdHkpXG4gICAgICAuZmluZEJ5KG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgb3duZXJJZGVudGl0eSkpXG5cbiAgICByZXR1cm4gQm9vbGVhbihvd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgdGhhdCBvd25zIGFuIGF0dGFjaG1lbnQgc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbnRyb2xsZXIgLSBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmcsIHJlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZywgcmVzb3VyY2VOYW1lOiBzdHJpbmd9fSBhcmdzLm93bmVyU2NvcGUgLSBPd25lciBzY29wZS5cbiAgICogQHJldHVybnMge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSwgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSB8IG51bGx9IC0gT3duZXIgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGF0dGFjaG1lbnRPd25lclJlc291cmNlKHtjb250cm9sbGVyLCBvd25lclNjb3BlfSkge1xuICAgIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IGNvbnRyb2xsZXIuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgbGV0IHJlc291cmNlV2l0aG91dEF0dGFjaG1lbnQgPSBudWxsXG5cbiAgICBpZiAoYmFja2VuZFByb2plY3RzLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIlZlbG9jaW91c0F0dGFjaG1lbnQgcmVxdWlyZXMgYSBiYWNrZW5kIHByb2plY3RcIilcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCBvd25lclJlc291cmNlID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgbW9kZWxOYW1lOiBvd25lclNjb3BlLnJlc291cmNlTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKCFvd25lclJlc291cmNlKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBvd25lck1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3Mob3duZXJSZXNvdXJjZSlcblxuICAgICAgaWYgKCFvd25lck1vZGVsQ2xhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciBhdHRhY2htZW50IG93bmVyICR7b3duZXJTY29wZS5yZXNvdXJjZU5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gb3duZXJSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0YWNobWVudHMgfHwge31cblxuICAgICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uc1tvd25lclNjb3BlLm5hbWVdKSByZXR1cm4gb3duZXJSZXNvdXJjZVxuXG4gICAgICByZXNvdXJjZVdpdGhvdXRBdHRhY2htZW50IHx8PSBvd25lclJlc291cmNlXG4gICAgfVxuXG4gICAgaWYgKHJlc291cmNlV2l0aG91dEF0dGFjaG1lbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCAnJHtvd25lclNjb3BlLm5hbWV9JyBjb25maWd1cmVkIGZvciAke293bmVyU2NvcGUucmVzb3VyY2VOYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuIl19