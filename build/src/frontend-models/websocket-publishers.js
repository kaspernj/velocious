// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceDefinitionIsClass } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyCacheKey, readModelPrimaryKeyValue } from "../utils/model-primary-key.js";
/** @typedef {{primaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition}} FrontendModelPublisherResource */
/** @typedef {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update", __frontendModelWebsocketPreviousIds?: Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>}} FrontendModelWebsocketRecord */
const modelClassesWithRegisteredHooks = new WeakSet();
const channelClassRegisteredConfigurations = new WeakSet();
/** @type {WeakMap<import("../configuration.js").default, WeakMap<typeof import("../database/record/index.js").default, Map<string, FrontendModelPublisherResource>>>} */
const publisherResourcesByConfiguration = new WeakMap();
/** Shared channel name for all frontend-model lifecycle subscriptions. */
export const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models";
/**
 * Runs transport serialization options for a configuration.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {import("./transport-serialization.js").FrontendModelTransportSerializationOptions} - Serialization options.
 */
function transportSerializationOptionsForConfiguration(configuration) {
    return {
        timeZone: configuration.getEnvironmentHandler().getTimeZone(configuration)
    };
}
/**
 * Runs the frontendModelBroadcastChannelName helper.
 * @param {string} modelName - Model class name.
 * @returns {string} - Broadcast channel name (legacy, retained for migration compatibility).
 */
export function frontendModelBroadcastChannelName(modelName) {
    return `frontend-models:${modelName}`;
}
/**
 * Runs frontend model resources from ability resources list.
 * @param {import("../configuration-types.js").AbilityResourceClassType[]} abilityResources - Ability resource classes.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
function frontendModelResourcesFromAbilityResourcesList(abilityResources) {
    /**
     * Resources.
     * @type {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} */
    const resources = {};
    if (!Array.isArray(abilityResources)) {
        throw new Error(`Expected ability resources to be an array but got: ${typeof abilityResources}`);
    }
    if (abilityResources.length === 0)
        return resources;
    for (const resourceClass of abilityResources) {
        if (typeof resourceClass !== "function") {
            throw new Error(`Expected ability resource to be a class but got: ${typeof resourceClass}`);
        }
        if (frontendModelResourceDefinitionIsClass(resourceClass)) {
            // An abstract base resource (no static ModelClass — e.g. an app's shared
            // `BaseResource` that other resources extend) backs no model, so it isn't a
            // publishable frontend model. Skip it instead of letting `modelClass()`
            // throw `requires a static ModelClass` during ability-resource discovery.
            if (!resourceClass.ModelClass)
                continue;
            const modelName = resourceClass.resourceConfig().modelName || resourceClass.modelClass().getModelName();
            resources[modelName] = resourceClass;
        }
        else if (resourceClass.prototype instanceof AuthorizationBaseResource) {
            // Authorization-only resource — valid but not relevant for WebSocket publishing
        }
        else {
            throw new Error(`Unexpected ability resource class: ${resourceClass.name}. Expected AuthorizationBaseResource or FrontendModelBaseResource subclass.`);
        }
    }
    return resources;
}
/**
 * Runs the ensureFrontendModelWebsocketPublishersRegistered helper.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {Promise<void>}
 */
export async function ensureFrontendModelWebsocketPublishersRegistered(configuration) {
    /**
     * All frontend models.
     * @type {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} */
    let allFrontendModels = {};
    for (const backendProject of configuration.getBackendProjects()) {
        const projectResources = frontendModelResourcesWithBuiltInsForBackendProject(backendProject);
        allFrontendModels = { ...allFrontendModels, ...projectResources };
    }
    // Always merge the ability resolver's resource list too. A project can expose some
    // resources as discoverable `src/resources/*.js` files (configured or auto-discovered)
    // and others only through `getAbilityResources()`; both sets need lifecycle publishers,
    // so resource discovery must not suppress this list.
    const abilityResources = configuration.getAbilityResources();
    allFrontendModels = {
        ...allFrontendModels,
        ...frontendModelResourcesFromAbilityResourcesList(abilityResources)
    };
    // Phase 3: register the V2 channel class once per configuration so
    // `subscribeChannel("frontend-models", {params: {model}})` finds it.
    // Dynamic import keeps server-only WebsocketRequest + Node utilities
    // out of browser bundles that transitively pull in this module via
    // configuration → logger.
    if (!channelClassRegisteredConfigurations.has(configuration)) {
        channelClassRegisteredConfigurations.add(configuration);
        const { default: FrontendModelWebsocketChannel } = await import("./websocket-channel.js");
        configuration.registerWebsocketChannel(FRONTEND_MODELS_CHANNEL_NAME, FrontendModelWebsocketChannel);
    }
    for (const [modelName, resourceClass] of Object.entries(allFrontendModels)) {
        // An abstract base resource (no static ModelClass — e.g. an app's shared
        // `BaseResource` that other resources extend) backs no model, so there is
        // nothing to publish realtime events for. Skip it instead of throwing.
        if (!resourceClass.ModelClass)
            continue;
        const modelClass = resourceClass.modelClass();
        const resourceConfiguration = resourceClass.resourceConfig();
        const configuredPrimaryKey = resourceConfiguration.primaryKey;
        const modelPrimaryKey = modelClass.primaryKey();
        const primaryKey = configuredPrimaryKey || (Array.isArray(modelPrimaryKey)
            ? modelPrimaryKey.map((columnName) => modelClass.resolveAttributeName(columnName) || columnName)
            : modelClass.resolveAttributeName(modelPrimaryKey) || modelPrimaryKey);
        let publisherResourcesByModelClass = publisherResourcesByConfiguration.get(configuration);
        if (!publisherResourcesByModelClass) {
            publisherResourcesByModelClass = new WeakMap();
            publisherResourcesByConfiguration.set(configuration, publisherResourcesByModelClass);
        }
        let publisherResources = publisherResourcesByModelClass.get(modelClass);
        if (!publisherResources) {
            publisherResources = new Map();
            publisherResourcesByModelClass.set(modelClass, publisherResources);
        }
        publisherResources.set(modelName, {
            primaryKey
        });
        // Register lifecycle hooks once per model class, not per configuration. A model class belongs to a
        // single backend project/config in production, so per-config registration only differs in tests where
        // the same model class is reachable from multiple configs — there it attaches duplicate beforeCreate/
        // afterSave/afterDestroy hooks that double-fire broadcasts (and leak across specs). The hooks read the
        // model's runtime configuration when broadcasting, so a single registration is sufficient.
        if (modelClassesWithRegisteredHooks.has(modelClass))
            continue;
        modelClassesWithRegisteredHooks.add(modelClass);
        modelClass.beforeCreate((model) => {
            /** @type {FrontendModelWebsocketRecord} */ (model).__frontendModelWebsocketAction = "create";
        });
        modelClass.beforeUpdate((model) => {
            const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model);
            websocketModel.__frontendModelWebsocketAction = "update";
            websocketModel.__frontendModelWebsocketPreviousIds = frontendModelPreviousResourceIdentities(model);
        });
        modelClass.afterSave((model) => {
            const modelWithWebsocketAction = /** @type {FrontendModelWebsocketRecord} */ (model);
            const action = modelWithWebsocketAction.__frontendModelWebsocketAction;
            if (action !== "create" && action !== "update")
                return;
            const previousIds = modelWithWebsocketAction.__frontendModelWebsocketPreviousIds;
            void model.connection().afterCommit(async () => {
                broadcastFrontendModelEvents(model, action, previousIds);
            });
            delete modelWithWebsocketAction.__frontendModelWebsocketAction;
            delete modelWithWebsocketAction.__frontendModelWebsocketPreviousIds;
        });
        modelClass.afterDestroy((model) => {
            void model.connection().afterCommit(async () => {
                broadcastFrontendModelEvents(model, "destroy");
            });
        });
    }
}
/**
 * Returns every resource identity represented by the record before its pending update.
 * @param {import("../database/record/index.js").default} model - Backing model before update.
 * @returns {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} - Previous identities by resource name.
 */
function frontendModelPreviousResourceIdentities(model) {
    const publisherResources = publisherResourcesByConfiguration.get(model._getConfiguration())?.get(model.getModelClass());
    /** @type {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} */
    const previousIds = new Map();
    if (!publisherResources)
        return previousIds;
    for (const [modelName, { primaryKey }] of publisherResources) {
        const previousId = frontendModelResourceIdentity({ model, previous: true, primaryKey });
        if (previousId !== null)
            previousIds.set(modelName, previousId);
    }
    return previousIds;
}
/**
 * Reads a resource identity only when every identity attribute was loaded on the backing record.
 * @param {object} args - Identity arguments.
 * @param {import("../database/record/index.js").default} args.model - Backing model.
 * @param {boolean} [args.previous] - Read values from before pending changes.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.primaryKey - Resource identity definition.
 * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyValue | null} - Complete identity or null when unavailable.
 */
function frontendModelResourceIdentity({ model, previous = false, primaryKey }) {
    const attributes = model.attributes();
    const changes = model.changes();
    /** @type {Record<string, import("../utils/model-primary-key.js").ModelPrimaryKeyScalar>} */
    const identityAttributes = {};
    const primaryKeyAttributes = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
    for (const attributeName of primaryKeyAttributes) {
        const columnName = model.getModelClass().getColumnNameForAttributeName(attributeName);
        let value;
        if (previous && Object.hasOwn(changes, columnName)) {
            value = changes[columnName][0];
        }
        else {
            if (!Object.hasOwn(attributes, attributeName))
                return null;
            value = attributes[attributeName];
        }
        if (typeof value !== "string" && typeof value !== "number")
            return null;
        identityAttributes[attributeName] = value;
    }
    return readModelPrimaryKeyValue(primaryKey, (attributeName) => identityAttributes[attributeName]);
}
/**
 * Fans one backing-record lifecycle event out through every configured frontend-resource identity.
 * @param {import("../database/record/index.js").default} model - Backing model instance.
 * @param {"create" | "update" | "destroy"} action - Lifecycle action.
 * @param {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} [previousIds] - Previous update identities by resource name.
 * @returns {void}
 */
function broadcastFrontendModelEvents(model, action, previousIds) {
    const configuration = model._getConfiguration();
    const publisherResources = publisherResourcesByConfiguration.get(configuration)?.get(model.getModelClass());
    if (!publisherResources)
        return;
    for (const [modelName, { primaryKey }] of publisherResources) {
        const id = frontendModelResourceIdentity({ model, primaryKey });
        if (id === null)
            continue;
        const previousId = previousIds?.get(modelName);
        const identityChanged = previousId !== undefined
            && modelPrimaryKeyCacheKey(primaryKey, previousId) !== modelPrimaryKeyCacheKey(primaryKey, id);
        broadcastFrontendModelEvent(configuration, modelName, {
            action,
            id,
            ...(identityChanged ? { previousId } : {})
        });
    }
}
/**
 * Fans a lifecycle event out to all V2 "frontend-models" subscribers
 * whose `params.model` matches. Record attributes go through the
 * transport serializer so Date/undefined/etc. survive the JSON hop.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @param {string} modelName - Model class name.
 * @param {{action: "create" | "update" | "destroy", id: ReturnType<typeof JSON.parse>, previousId?: ReturnType<typeof JSON.parse>, record?: Record<string, ReturnType<typeof JSON.parse>>}} event - Lifecycle event.
 * @returns {void}
 */
function broadcastFrontendModelEvent(configuration, modelName, event) {
    const body = {
        action: event.action,
        id: event.id,
        model: modelName,
        ...(event.previousId !== undefined ? { previousId: event.previousId } : {}),
        ...(event.record ? { record: serializeFrontendModelTransportValue(event.record, transportSerializationOptionsForConfiguration(configuration)) } : {})
    };
    configuration.broadcastToChannel(FRONTEND_MODELS_CHANNEL_NAME, { model: modelName }, body);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRS9GLGdJQUFnSTtBQUNoSSxzUUFBc1E7QUFFdFEsTUFBTSwrQkFBK0IsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQ3JELE1BQU0sb0NBQW9DLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUMxRCx5S0FBeUs7QUFDekssTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRXZELDBFQUEwRTtBQUMxRSxNQUFNLENBQUMsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsU0FBUyw2Q0FBNkMsQ0FBQyxhQUFhO0lBQ2xFLE9BQU87UUFDTCxRQUFRLEVBQUUsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQztLQUMzRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsaUNBQWlDLENBQUMsU0FBUztJQUN6RCxPQUFPLG1CQUFtQixTQUFTLEVBQUUsQ0FBQTtBQUN2QyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsOENBQThDLENBQUMsZ0JBQWdCO0lBQ3RFOztvR0FFZ0c7SUFDaEcs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LEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN6RSxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBQyxNQUFNLEVBQUUsb0NBQW9DLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSw2Q0FBNkMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztLQUNwSixDQUFBO0lBRUQsYUFBYSxDQUFDLGtCQUFrQixDQUFDLDRCQUE0QixFQUFFLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQyxFQUFFLElBQUksQ0FBQyxDQUFBO0FBQzFGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3N9IGZyb20gXCIuL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXksIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqIEB0eXBlZGVmIHt7cHJpbWFyeUtleTogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn19IEZyb250ZW5kTW9kZWxQdWJsaXNoZXJSZXNvdXJjZSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCAmIHtfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiwgX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHM/OiBNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkICovXG5cbmNvbnN0IG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MgPSBuZXcgV2Vha1NldCgpXG5jb25zdCBjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMgPSBuZXcgV2Vha1NldCgpXG4vKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbFB1Ymxpc2hlclJlc291cmNlPj4+fSAqL1xuY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKiogU2hhcmVkIGNoYW5uZWwgbmFtZSBmb3IgYWxsIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBzdWJzY3JpcHRpb25zLiAqL1xuZXhwb3J0IGNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnN9IC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICovXG5mdW5jdGlvbiB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICByZXR1cm4ge1xuICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUgaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJyb2FkY2FzdCBjaGFubmVsIG5hbWUgKGxlZ2FjeSwgcmV0YWluZWQgZm9yIG1pZ3JhdGlvbiBjb21wYXRpYmlsaXR5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxCcm9hZGNhc3RDaGFubmVsTmFtZShtb2RlbE5hbWUpIHtcbiAgcmV0dXJuIGBmcm9udGVuZC1tb2RlbHM6JHttb2RlbE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzIGZyb20gYWJpbGl0eSByZXNvdXJjZXMgbGlzdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gYWJpbGl0eVJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKSB7XG4gIC8qKlxuICAgKiBSZXNvdXJjZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGFiaWxpdHlSZXNvdXJjZXMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlcyB0byBiZSBhbiBhcnJheSBidXQgZ290OiAke3R5cGVvZiBhYmlsaXR5UmVzb3VyY2VzfWApXG4gIH1cblxuICBpZiAoYWJpbGl0eVJlc291cmNlcy5sZW5ndGggPT09IDApIHJldHVybiByZXNvdXJjZXNcblxuICBmb3IgKGNvbnN0IHJlc291cmNlQ2xhc3Mgb2YgYWJpbGl0eVJlc291cmNlcykge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2UgdG8gYmUgYSBjbGFzcyBidXQgZ290OiAke3R5cGVvZiByZXNvdXJjZUNsYXNzfWApXG4gICAgfVxuXG4gICAgaWYgKGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlQ2xhc3MpKSB7XG4gICAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIGl0IGlzbid0IGFcbiAgICAgIC8vIHB1Ymxpc2hhYmxlIGZyb250ZW5kIG1vZGVsLiBTa2lwIGl0IGluc3RlYWQgb2YgbGV0dGluZyBgbW9kZWxDbGFzcygpYFxuICAgICAgLy8gdGhyb3cgYHJlcXVpcmVzIGEgc3RhdGljIE1vZGVsQ2xhc3NgIGR1cmluZyBhYmlsaXR5LXJlc291cmNlIGRpc2NvdmVyeS5cbiAgICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKCkubW9kZWxOYW1lIHx8IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIHJlc291cmNlc1ttb2RlbE5hbWVdID0gcmVzb3VyY2VDbGFzc1xuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlKSB7XG4gICAgICAvLyBBdXRob3JpemF0aW9uLW9ubHkgcmVzb3VyY2Ug4oCUIHZhbGlkIGJ1dCBub3QgcmVsZXZhbnQgZm9yIFdlYlNvY2tldCBwdWJsaXNoaW5nXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIGNsYXNzOiAke3Jlc291cmNlQ2xhc3MubmFtZX0uIEV4cGVjdGVkIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2Ugb3IgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXNvdXJjZXNcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQoY29uZmlndXJhdGlvbikge1xuICAvKipcbiAgICogQWxsIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gKi9cbiAgbGV0IGFsbEZyb250ZW5kTW9kZWxzID0ge31cblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICBjb25zdCBwcm9qZWN0UmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7Li4uYWxsRnJvbnRlbmRNb2RlbHMsIC4uLnByb2plY3RSZXNvdXJjZXN9XG4gIH1cblxuICAvLyBBbHdheXMgbWVyZ2UgdGhlIGFiaWxpdHkgcmVzb2x2ZXIncyByZXNvdXJjZSBsaXN0IHRvby4gQSBwcm9qZWN0IGNhbiBleHBvc2Ugc29tZVxuICAvLyByZXNvdXJjZXMgYXMgZGlzY292ZXJhYmxlIGBzcmMvcmVzb3VyY2VzLyouanNgIGZpbGVzIChjb25maWd1cmVkIG9yIGF1dG8tZGlzY292ZXJlZClcbiAgLy8gYW5kIG90aGVycyBvbmx5IHRocm91Z2ggYGdldEFiaWxpdHlSZXNvdXJjZXMoKWA7IGJvdGggc2V0cyBuZWVkIGxpZmVjeWNsZSBwdWJsaXNoZXJzLFxuICAvLyBzbyByZXNvdXJjZSBkaXNjb3ZlcnkgbXVzdCBub3Qgc3VwcHJlc3MgdGhpcyBsaXN0LlxuICBjb25zdCBhYmlsaXR5UmVzb3VyY2VzID0gY29uZmlndXJhdGlvbi5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICBhbGxGcm9udGVuZE1vZGVscyA9IHtcbiAgICAuLi5hbGxGcm9udGVuZE1vZGVscyxcbiAgICAuLi5mcm9udGVuZE1vZGVsUmVzb3VyY2VzRnJvbUFiaWxpdHlSZXNvdXJjZXNMaXN0KGFiaWxpdHlSZXNvdXJjZXMpXG4gIH1cblxuICAvLyBQaGFzZSAzOiByZWdpc3RlciB0aGUgVjIgY2hhbm5lbCBjbGFzcyBvbmNlIHBlciBjb25maWd1cmF0aW9uIHNvXG4gIC8vIGBzdWJzY3JpYmVDaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHtwYXJhbXM6IHttb2RlbH19KWAgZmluZHMgaXQuXG4gIC8vIER5bmFtaWMgaW1wb3J0IGtlZXBzIHNlcnZlci1vbmx5IFdlYnNvY2tldFJlcXVlc3QgKyBOb2RlIHV0aWxpdGllc1xuICAvLyBvdXQgb2YgYnJvd3NlciBidW5kbGVzIHRoYXQgdHJhbnNpdGl2ZWx5IHB1bGwgaW4gdGhpcyBtb2R1bGUgdmlhXG4gIC8vIGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlci5cbiAgaWYgKCFjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMuaGFzKGNvbmZpZ3VyYXRpb24pKSB7XG4gICAgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmFkZChjb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IHtkZWZhdWx0OiBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbH0gPSBhd2FpdCBpbXBvcnQoXCIuL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpXG5cbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbClcbiAgfVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VDbGFzc10gb2YgT2JqZWN0LmVudHJpZXMoYWxsRnJvbnRlbmRNb2RlbHMpKSB7XG4gICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgLy8gYEJhc2VSZXNvdXJjZWAgdGhhdCBvdGhlciByZXNvdXJjZXMgZXh0ZW5kKSBiYWNrcyBubyBtb2RlbCwgc28gdGhlcmUgaXNcbiAgICAvLyBub3RoaW5nIHRvIHB1Ymxpc2ggcmVhbHRpbWUgZXZlbnRzIGZvci4gU2tpcCBpdCBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgY29uZmlndXJlZFByaW1hcnlLZXkgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbmZpZ3VyZWRQcmltYXJ5S2V5IHx8IChBcnJheS5pc0FycmF5KG1vZGVsUHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKSB8fCBjb2x1bW5OYW1lKVxuICAgICAgOiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG1vZGVsUHJpbWFyeUtleSkgfHwgbW9kZWxQcmltYXJ5S2V5KVxuICAgIGxldCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIXB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcykge1xuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzID0gbmV3IFdlYWtNYXAoKVxuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgbGV0IHB1Ymxpc2hlclJlc291cmNlcyA9IHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5nZXQobW9kZWxDbGFzcylcblxuICAgIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXMgPSBuZXcgTWFwKClcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5zZXQobW9kZWxDbGFzcywgcHVibGlzaGVyUmVzb3VyY2VzKVxuICAgIH1cblxuICAgIHB1Ymxpc2hlclJlc291cmNlcy5zZXQobW9kZWxOYW1lLCB7XG4gICAgICBwcmltYXJ5S2V5XG4gICAgfSlcblxuICAgIC8vIFJlZ2lzdGVyIGxpZmVjeWNsZSBob29rcyBvbmNlIHBlciBtb2RlbCBjbGFzcywgbm90IHBlciBjb25maWd1cmF0aW9uLiBBIG1vZGVsIGNsYXNzIGJlbG9uZ3MgdG8gYVxuICAgIC8vIHNpbmdsZSBiYWNrZW5kIHByb2plY3QvY29uZmlnIGluIHByb2R1Y3Rpb24sIHNvIHBlci1jb25maWcgcmVnaXN0cmF0aW9uIG9ubHkgZGlmZmVycyBpbiB0ZXN0cyB3aGVyZVxuICAgIC8vIHRoZSBzYW1lIG1vZGVsIGNsYXNzIGlzIHJlYWNoYWJsZSBmcm9tIG11bHRpcGxlIGNvbmZpZ3Mg4oCUIHRoZXJlIGl0IGF0dGFjaGVzIGR1cGxpY2F0ZSBiZWZvcmVDcmVhdGUvXG4gICAgLy8gYWZ0ZXJTYXZlL2FmdGVyRGVzdHJveSBob29rcyB0aGF0IGRvdWJsZS1maXJlIGJyb2FkY2FzdHMgKGFuZCBsZWFrIGFjcm9zcyBzcGVjcykuIFRoZSBob29rcyByZWFkIHRoZVxuICAgIC8vIG1vZGVsJ3MgcnVudGltZSBjb25maWd1cmF0aW9uIHdoZW4gYnJvYWRjYXN0aW5nLCBzbyBhIHNpbmdsZSByZWdpc3RyYXRpb24gaXMgc3VmZmljaWVudC5cbiAgICBpZiAobW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcy5oYXMobW9kZWxDbGFzcykpIGNvbnRpbnVlXG5cbiAgICBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzLmFkZChtb2RlbENsYXNzKVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVDcmVhdGUoKG1vZGVsKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbCkuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uID0gXCJjcmVhdGVcIlxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZVVwZGF0ZSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHdlYnNvY2tldE1vZGVsID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG5cbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwidXBkYXRlXCJcbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzID0gZnJvbnRlbmRNb2RlbFByZXZpb3VzUmVzb3VyY2VJZGVudGl0aWVzKG1vZGVsKVxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyU2F2ZSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbiA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgYWN0aW9uID0gbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuXG4gICAgICBpZiAoYWN0aW9uICE9PSBcImNyZWF0ZVwiICYmIGFjdGlvbiAhPT0gXCJ1cGRhdGVcIikgcmV0dXJuXG4gICAgICBjb25zdCBwcmV2aW91c0lkcyA9IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcHJldmlvdXNJZHMpXG4gICAgICB9KVxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cbiAgICAgIGRlbGV0ZSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5hZnRlckRlc3Ryb3koKG1vZGVsKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIFwiZGVzdHJveVwiKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBldmVyeSByZXNvdXJjZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgcmVjb3JkIGJlZm9yZSBpdHMgcGVuZGluZyB1cGRhdGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgYmVmb3JlIHVwZGF0ZS5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59IC0gUHJldmlvdXMgaWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJldmlvdXNSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpIHtcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59ICovXG4gIGNvbnN0IHByZXZpb3VzSWRzID0gbmV3IE1hcCgpXG5cbiAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXMpIHJldHVybiBwcmV2aW91c0lkc1xuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBwcmV2aW91c0lkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmV2aW91czogdHJ1ZSwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAocHJldmlvdXNJZCAhPT0gbnVsbCkgcHJldmlvdXNJZHMuc2V0KG1vZGVsTmFtZSwgcHJldmlvdXNJZClcbiAgfVxuXG4gIHJldHVybiBwcmV2aW91c0lkc1xufVxuXG4vKipcbiAqIFJlYWRzIGEgcmVzb3VyY2UgaWRlbnRpdHkgb25seSB3aGVuIGV2ZXJ5IGlkZW50aXR5IGF0dHJpYnV0ZSB3YXMgbG9hZGVkIG9uIHRoZSBiYWNraW5nIHJlY29yZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSWRlbnRpdHkgYXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIEJhY2tpbmcgbW9kZWwuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnByZXZpb3VzXSAtIFJlYWQgdmFsdWVzIGZyb20gYmVmb3JlIHBlbmRpbmcgY2hhbmdlcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gYXJncy5wcmltYXJ5S2V5IC0gUmVzb3VyY2UgaWRlbnRpdHkgZGVmaW5pdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSB8IG51bGx9IC0gQ29tcGxldGUgaWRlbnRpdHkgb3IgbnVsbCB3aGVuIHVuYXZhaWxhYmxlLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByZXZpb3VzID0gZmFsc2UsIHByaW1hcnlLZXl9KSB7XG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBtb2RlbC5hdHRyaWJ1dGVzKClcbiAgY29uc3QgY2hhbmdlcyA9IG1vZGVsLmNoYW5nZXMoKVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcj59ICovXG4gIGNvbnN0IGlkZW50aXR5QXR0cmlidXRlcyA9IHt9XG4gIGNvbnN0IHByaW1hcnlLZXlBdHRyaWJ1dGVzID0gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSA/IHByaW1hcnlLZXkgOiBbcHJpbWFyeUtleV1cblxuICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgcHJpbWFyeUtleUF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG4gICAgbGV0IHZhbHVlXG5cbiAgICBpZiAocHJldmlvdXMgJiYgT2JqZWN0Lmhhc093bihjaGFuZ2VzLCBjb2x1bW5OYW1lKSkge1xuICAgICAgdmFsdWUgPSBjaGFuZ2VzW2NvbHVtbk5hbWVdWzBdXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghT2JqZWN0Lmhhc093bihhdHRyaWJ1dGVzLCBhdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIG51bGxcblxuICAgICAgdmFsdWUgPSBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIpIHJldHVybiBudWxsXG5cbiAgICBpZGVudGl0eUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICB9XG5cbiAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gaWRlbnRpdHlBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdKVxufVxuXG4vKipcbiAqIEZhbnMgb25lIGJhY2tpbmctcmVjb3JkIGxpZmVjeWNsZSBldmVudCBvdXQgdGhyb3VnaCBldmVyeSBjb25maWd1cmVkIGZyb250ZW5kLXJlc291cmNlIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBCYWNraW5nIG1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhY3Rpb24gLSBMaWZlY3ljbGUgYWN0aW9uLlxuICogQHBhcmFtIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59IFtwcmV2aW91c0lkc10gLSBQcmV2aW91cyB1cGRhdGUgaWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcHJldmlvdXNJZHMpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IGlkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmltYXJ5S2V5fSlcblxuICAgIGlmIChpZCA9PT0gbnVsbCkgY29udGludWVcblxuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBwcmV2aW91c0lkcz8uZ2V0KG1vZGVsTmFtZSlcbiAgICBjb25zdCBpZGVudGl0eUNoYW5nZWQgPSBwcmV2aW91c0lkICE9PSB1bmRlZmluZWRcbiAgICAgICYmIG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWQpICE9PSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZClcblxuICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChjb25maWd1cmF0aW9uLCBtb2RlbE5hbWUsIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGlkLFxuICAgICAgLi4uKGlkZW50aXR5Q2hhbmdlZCA/IHtwcmV2aW91c0lkfSA6IHt9KVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBGYW5zIGEgbGlmZWN5Y2xlIGV2ZW50IG91dCB0byBhbGwgVjIgXCJmcm9udGVuZC1tb2RlbHNcIiBzdWJzY3JpYmVyc1xuICogd2hvc2UgYHBhcmFtcy5tb2RlbGAgbWF0Y2hlcy4gUmVjb3JkIGF0dHJpYnV0ZXMgZ28gdGhyb3VnaCB0aGVcbiAqIHRyYW5zcG9ydCBzZXJpYWxpemVyIHNvIERhdGUvdW5kZWZpbmVkL2V0Yy4gc3Vydml2ZSB0aGUgSlNPTiBob3AuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAqIEBwYXJhbSB7e2FjdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgaWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwcmV2aW91c0lkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlY29yZD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGV2ZW50IC0gTGlmZWN5Y2xlIGV2ZW50LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChjb25maWd1cmF0aW9uLCBtb2RlbE5hbWUsIGV2ZW50KSB7XG4gIGNvbnN0IGJvZHkgPSB7XG4gICAgYWN0aW9uOiBldmVudC5hY3Rpb24sXG4gICAgaWQ6IGV2ZW50LmlkLFxuICAgIG1vZGVsOiBtb2RlbE5hbWUsXG4gICAgLi4uKGV2ZW50LnByZXZpb3VzSWQgIT09IHVuZGVmaW5lZCA/IHtwcmV2aW91c0lkOiBldmVudC5wcmV2aW91c0lkfSA6IHt9KSxcbiAgICAuLi4oZXZlbnQucmVjb3JkID8ge3JlY29yZDogc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGV2ZW50LnJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKX0gOiB7fSlcbiAgfVxuXG4gIGNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHttb2RlbDogbW9kZWxOYW1lfSwgYm9keSlcbn1cbiJdfQ==