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
        modelClass.beforeUpdate(async (model) => {
            const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model);
            websocketModel.__frontendModelWebsocketAction = "update";
            websocketModel.__frontendModelWebsocketPreviousIds = await frontendModelPreviousResourceIdentities(model);
        });
        modelClass.beforeDestroy(async (model) => {
            const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model);
            websocketModel.__frontendModelWebsocketPreviousIds = await frontendModelPreviousResourceIdentities(model);
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
            const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model);
            const previousIds = websocketModel.__frontendModelWebsocketPreviousIds;
            void model.connection().afterCommit(async () => {
                broadcastFrontendModelEvents(model, "destroy", previousIds);
            });
            delete websocketModel.__frontendModelWebsocketPreviousIds;
        });
    }
}
/**
 * Returns every resource identity represented by the record before its pending update.
 * @param {import("../database/record/index.js").default} model - Backing model before update.
 * @returns {Promise<Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>>} - Previous identities by resource name.
 */
async function frontendModelPreviousResourceIdentities(model) {
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
    if (previousIds.size === publisherResources.size)
        return previousIds;
    const persistedModel = await model
        .queryForModel(model.getModelClass())
        .find(model._persistedPrimaryKeyValue());
    for (const [modelName, { primaryKey }] of publisherResources) {
        if (previousIds.has(modelName))
            continue;
        const persistedId = frontendModelResourceIdentity({ model: persistedModel, primaryKey });
        if (persistedId !== null)
            previousIds.set(modelName, persistedId);
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
        const previousId = previousIds?.get(modelName);
        const currentId = frontendModelResourceIdentity({ model, primaryKey });
        const id = currentId ?? previousId;
        if (id === null || id === undefined)
            continue;
        const identityChanged = action === "update"
            && currentId !== null
            && previousId !== undefined
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRS9GLGdJQUFnSTtBQUNoSSxzUUFBc1E7QUFFdFEsTUFBTSwrQkFBK0IsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQ3JELE1BQU0sb0NBQW9DLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUMxRCx5S0FBeUs7QUFDekssTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRXZELDBFQUEwRTtBQUMxRSxNQUFNLENBQUMsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsU0FBUyw2Q0FBNkMsQ0FBQyxhQUFhO0lBQ2xFLE9BQU87UUFDTCxRQUFRLEVBQUUsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQztLQUMzRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsaUNBQWlDLENBQUMsU0FBUztJQUN6RCxPQUFPLG1CQUFtQixTQUFTLEVBQUUsQ0FBQTtBQUN2QyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsOENBQThDLENBQUMsZ0JBQWdCO0lBQ3RFOztvR0FFZ0c7SUFDaEcs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UztRQUNoQixHQUFHLENBQUMsS0FBSyxDQUFDLFVBQVUsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVLEVBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3pFLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxvQ0FBb0MsQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLDZDQUE2QyxDQUFDLGFBQWEsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0tBQ3BKLENBQUE7SUFFRCxhQUFhLENBQUMsa0JBQWtCLENBQUMsNEJBQTRCLEVBQUUsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUE7QUFDMUYsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSBmcm9tIFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0fSBmcm9tIFwiLi9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzc30gZnJvbSBcIi4vcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge3NlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKiogQHR5cGVkZWYge3twcmltYXJ5S2V5OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufX0gRnJvbnRlbmRNb2RlbFB1Ymxpc2hlclJlc291cmNlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiLCBfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkcz86IE1hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn19IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmQgKi9cblxuY29uc3QgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcyA9IG5ldyBXZWFrU2V0KClcbmNvbnN0IGNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucyA9IG5ldyBXZWFrU2V0KClcbi8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIFdlYWtNYXA8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBNYXA8c3RyaW5nLCBGcm9udGVuZE1vZGVsUHVibGlzaGVyUmVzb3VyY2U+Pj59ICovXG5jb25zdCBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKiBTaGFyZWQgY2hhbm5lbCBuYW1lIGZvciBhbGwgZnJvbnRlbmQtbW9kZWwgbGlmZWN5Y2xlIHN1YnNjcmlwdGlvbnMuICovXG5leHBvcnQgY29uc3QgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSA9IFwiZnJvbnRlbmQtbW9kZWxzXCJcblxuLyoqXG4gKiBSdW5zIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uIG9wdGlvbnMgZm9yIGEgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc30gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gIHJldHVybiB7XG4gICAgdGltZVpvbmU6IGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbilcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxCcm9hZGNhc3RDaGFubmVsTmFtZSBoZWxwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQnJvYWRjYXN0IGNoYW5uZWwgbmFtZSAobGVnYWN5LCByZXRhaW5lZCBmb3IgbWlncmF0aW9uIGNvbXBhdGliaWxpdHkpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEJyb2FkY2FzdENoYW5uZWxOYW1lKG1vZGVsTmFtZSkge1xuICByZXR1cm4gYGZyb250ZW5kLW1vZGVsczoke21vZGVsTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMgZnJvbSBhYmlsaXR5IHJlc291cmNlcyBsaXN0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFiaWxpdHlSZXNvdXJjZUNsYXNzVHlwZVtdfSBhYmlsaXR5UmVzb3VyY2VzIC0gQWJpbGl0eSByZXNvdXJjZSBjbGFzc2VzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gLSBSZXNvdXJjZSBkZWZpbml0aW9ucyBrZXllZCBieSBtb2RlbCBuYW1lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRnJvbUFiaWxpdHlSZXNvdXJjZXNMaXN0KGFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgLyoqXG4gICAqIFJlc291cmNlcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gKi9cbiAgY29uc3QgcmVzb3VyY2VzID0ge31cblxuICBpZiAoIUFycmF5LmlzQXJyYXkoYWJpbGl0eVJlc291cmNlcykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2VzIHRvIGJlIGFuIGFycmF5IGJ1dCBnb3Q6ICR7dHlwZW9mIGFiaWxpdHlSZXNvdXJjZXN9YClcbiAgfVxuXG4gIGlmIChhYmlsaXR5UmVzb3VyY2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHJlc291cmNlc1xuXG4gIGZvciAoY29uc3QgcmVzb3VyY2VDbGFzcyBvZiBhYmlsaXR5UmVzb3VyY2VzKSB7XG4gICAgaWYgKHR5cGVvZiByZXNvdXJjZUNsYXNzICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZSB0byBiZSBhIGNsYXNzIGJ1dCBnb3Q6ICR7dHlwZW9mIHJlc291cmNlQ2xhc3N9YClcbiAgICB9XG5cbiAgICBpZiAoZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MocmVzb3VyY2VDbGFzcykpIHtcbiAgICAgIC8vIEFuIGFic3RyYWN0IGJhc2UgcmVzb3VyY2UgKG5vIHN0YXRpYyBNb2RlbENsYXNzIOKAlCBlLmcuIGFuIGFwcCdzIHNoYXJlZFxuICAgICAgLy8gYEJhc2VSZXNvdXJjZWAgdGhhdCBvdGhlciByZXNvdXJjZXMgZXh0ZW5kKSBiYWNrcyBubyBtb2RlbCwgc28gaXQgaXNuJ3QgYVxuICAgICAgLy8gcHVibGlzaGFibGUgZnJvbnRlbmQgbW9kZWwuIFNraXAgaXQgaW5zdGVhZCBvZiBsZXR0aW5nIGBtb2RlbENsYXNzKClgXG4gICAgICAvLyB0aHJvdyBgcmVxdWlyZXMgYSBzdGF0aWMgTW9kZWxDbGFzc2AgZHVyaW5nIGFiaWxpdHktcmVzb3VyY2UgZGlzY292ZXJ5LlxuICAgICAgaWYgKCFyZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ2xhc3MucmVzb3VyY2VDb25maWcoKS5tb2RlbE5hbWUgfHwgcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgcmVzb3VyY2VzW21vZGVsTmFtZV0gPSByZXNvdXJjZUNsYXNzXG4gICAgfSBlbHNlIGlmIChyZXNvdXJjZUNsYXNzLnByb3RvdHlwZSBpbnN0YW5jZW9mIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UpIHtcbiAgICAgIC8vIEF1dGhvcml6YXRpb24tb25seSByZXNvdXJjZSDigJQgdmFsaWQgYnV0IG5vdCByZWxldmFudCBmb3IgV2ViU29ja2V0IHB1Ymxpc2hpbmdcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2UgY2xhc3M6ICR7cmVzb3VyY2VDbGFzcy5uYW1lfS4gRXhwZWN0ZWQgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSBvciBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzLmApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlc291cmNlc1xufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGVuc3VyZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzUmVnaXN0ZXJlZCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzUmVnaXN0ZXJlZChjb25maWd1cmF0aW9uKSB7XG4gIC8qKlxuICAgKiBBbGwgZnJvbnRlbmQgbW9kZWxzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAqL1xuICBsZXQgYWxsRnJvbnRlbmRNb2RlbHMgPSB7fVxuXG4gIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgIGNvbnN0IHByb2plY3RSZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICBhbGxGcm9udGVuZE1vZGVscyA9IHsuLi5hbGxGcm9udGVuZE1vZGVscywgLi4ucHJvamVjdFJlc291cmNlc31cbiAgfVxuXG4gIC8vIEFsd2F5cyBtZXJnZSB0aGUgYWJpbGl0eSByZXNvbHZlcidzIHJlc291cmNlIGxpc3QgdG9vLiBBIHByb2plY3QgY2FuIGV4cG9zZSBzb21lXG4gIC8vIHJlc291cmNlcyBhcyBkaXNjb3ZlcmFibGUgYHNyYy9yZXNvdXJjZXMvKi5qc2AgZmlsZXMgKGNvbmZpZ3VyZWQgb3IgYXV0by1kaXNjb3ZlcmVkKVxuICAvLyBhbmQgb3RoZXJzIG9ubHkgdGhyb3VnaCBgZ2V0QWJpbGl0eVJlc291cmNlcygpYDsgYm90aCBzZXRzIG5lZWQgbGlmZWN5Y2xlIHB1Ymxpc2hlcnMsXG4gIC8vIHNvIHJlc291cmNlIGRpc2NvdmVyeSBtdXN0IG5vdCBzdXBwcmVzcyB0aGlzIGxpc3QuXG4gIGNvbnN0IGFiaWxpdHlSZXNvdXJjZXMgPSBjb25maWd1cmF0aW9uLmdldEFiaWxpdHlSZXNvdXJjZXMoKVxuXG4gIGFsbEZyb250ZW5kTW9kZWxzID0ge1xuICAgIC4uLmFsbEZyb250ZW5kTW9kZWxzLFxuICAgIC4uLmZyb250ZW5kTW9kZWxSZXNvdXJjZXNGcm9tQWJpbGl0eVJlc291cmNlc0xpc3QoYWJpbGl0eVJlc291cmNlcylcbiAgfVxuXG4gIC8vIFBoYXNlIDM6IHJlZ2lzdGVyIHRoZSBWMiBjaGFubmVsIGNsYXNzIG9uY2UgcGVyIGNvbmZpZ3VyYXRpb24gc29cbiAgLy8gYHN1YnNjcmliZUNoYW5uZWwoXCJmcm9udGVuZC1tb2RlbHNcIiwge3BhcmFtczoge21vZGVsfX0pYCBmaW5kcyBpdC5cbiAgLy8gRHluYW1pYyBpbXBvcnQga2VlcHMgc2VydmVyLW9ubHkgV2Vic29ja2V0UmVxdWVzdCArIE5vZGUgdXRpbGl0aWVzXG4gIC8vIG91dCBvZiBicm93c2VyIGJ1bmRsZXMgdGhhdCB0cmFuc2l0aXZlbHkgcHVsbCBpbiB0aGlzIG1vZHVsZSB2aWFcbiAgLy8gY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyLlxuICBpZiAoIWNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucy5oYXMoY29uZmlndXJhdGlvbikpIHtcbiAgICBjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMuYWRkKGNvbmZpZ3VyYXRpb24pXG4gICAgY29uc3Qge2RlZmF1bHQ6IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsfSA9IGF3YWl0IGltcG9ydChcIi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIilcblxuICAgIGNvbmZpZ3VyYXRpb24ucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsKVxuICB9XG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCByZXNvdXJjZUNsYXNzXSBvZiBPYmplY3QuZW50cmllcyhhbGxGcm9udGVuZE1vZGVscykpIHtcbiAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAvLyBgQmFzZVJlc291cmNlYCB0aGF0IG90aGVyIHJlc291cmNlcyBleHRlbmQpIGJhY2tzIG5vIG1vZGVsLCBzbyB0aGVyZSBpc1xuICAgIC8vIG5vdGhpbmcgdG8gcHVibGlzaCByZWFsdGltZSBldmVudHMgZm9yLiBTa2lwIGl0IGluc3RlYWQgb2YgdGhyb3dpbmcuXG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBjb25maWd1cmVkUHJpbWFyeUtleSA9IHJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5XG4gICAgY29uc3QgbW9kZWxQcmltYXJ5S2V5ID0gbW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gY29uZmlndXJlZFByaW1hcnlLZXkgfHwgKEFycmF5LmlzQXJyYXkobW9kZWxQcmltYXJ5S2V5KVxuICAgICAgPyBtb2RlbFByaW1hcnlLZXkubWFwKChjb2x1bW5OYW1lKSA9PiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbHVtbk5hbWUpIHx8IGNvbHVtbk5hbWUpXG4gICAgICA6IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUobW9kZWxQcmltYXJ5S2V5KSB8fCBtb2RlbFByaW1hcnlLZXkpXG4gICAgbGV0IHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcyA9IHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbilcblxuICAgIGlmICghcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzKSB7XG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MgPSBuZXcgV2Vha01hcCgpXG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uc2V0KGNvbmZpZ3VyYXRpb24sIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcylcbiAgICB9XG5cbiAgICBsZXQgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzLmdldChtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlcyA9IG5ldyBNYXAoKVxuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzLnNldChtb2RlbENsYXNzLCBwdWJsaXNoZXJSZXNvdXJjZXMpXG4gICAgfVxuXG4gICAgcHVibGlzaGVyUmVzb3VyY2VzLnNldChtb2RlbE5hbWUsIHtcbiAgICAgIHByaW1hcnlLZXlcbiAgICB9KVxuXG4gICAgLy8gUmVnaXN0ZXIgbGlmZWN5Y2xlIGhvb2tzIG9uY2UgcGVyIG1vZGVsIGNsYXNzLCBub3QgcGVyIGNvbmZpZ3VyYXRpb24uIEEgbW9kZWwgY2xhc3MgYmVsb25ncyB0byBhXG4gICAgLy8gc2luZ2xlIGJhY2tlbmQgcHJvamVjdC9jb25maWcgaW4gcHJvZHVjdGlvbiwgc28gcGVyLWNvbmZpZyByZWdpc3RyYXRpb24gb25seSBkaWZmZXJzIGluIHRlc3RzIHdoZXJlXG4gICAgLy8gdGhlIHNhbWUgbW9kZWwgY2xhc3MgaXMgcmVhY2hhYmxlIGZyb20gbXVsdGlwbGUgY29uZmlncyDigJQgdGhlcmUgaXQgYXR0YWNoZXMgZHVwbGljYXRlIGJlZm9yZUNyZWF0ZS9cbiAgICAvLyBhZnRlclNhdmUvYWZ0ZXJEZXN0cm95IGhvb2tzIHRoYXQgZG91YmxlLWZpcmUgYnJvYWRjYXN0cyAoYW5kIGxlYWsgYWNyb3NzIHNwZWNzKS4gVGhlIGhvb2tzIHJlYWQgdGhlXG4gICAgLy8gbW9kZWwncyBydW50aW1lIGNvbmZpZ3VyYXRpb24gd2hlbiBicm9hZGNhc3RpbmcsIHNvIGEgc2luZ2xlIHJlZ2lzdHJhdGlvbiBpcyBzdWZmaWNpZW50LlxuICAgIGlmIChtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzLmhhcyhtb2RlbENsYXNzKSkgY29udGludWVcblxuICAgIG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MuYWRkKG1vZGVsQ2xhc3MpXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZUNyZWF0ZSgobW9kZWwpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKS5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24gPSBcImNyZWF0ZVwiXG4gICAgfSlcblxuICAgIG1vZGVsQ2xhc3MuYmVmb3JlVXBkYXRlKGFzeW5jIChtb2RlbCkgPT4ge1xuICAgICAgY29uc3Qgd2Vic29ja2V0TW9kZWwgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbClcblxuICAgICAgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uID0gXCJ1cGRhdGVcIlxuICAgICAgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHMgPSBhd2FpdCBmcm9udGVuZE1vZGVsUHJldmlvdXNSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpXG4gICAgfSlcblxuICAgIG1vZGVsQ2xhc3MuYmVmb3JlRGVzdHJveShhc3luYyAobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHdlYnNvY2tldE1vZGVsID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG5cbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzID0gYXdhaXQgZnJvbnRlbmRNb2RlbFByZXZpb3VzUmVzb3VyY2VJZGVudGl0aWVzKG1vZGVsKVxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyU2F2ZSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbiA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgYWN0aW9uID0gbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuXG4gICAgICBpZiAoYWN0aW9uICE9PSBcImNyZWF0ZVwiICYmIGFjdGlvbiAhPT0gXCJ1cGRhdGVcIikgcmV0dXJuXG4gICAgICBjb25zdCBwcmV2aW91c0lkcyA9IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcHJldmlvdXNJZHMpXG4gICAgICB9KVxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cbiAgICAgIGRlbGV0ZSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5hZnRlckRlc3Ryb3koKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgcHJldmlvdXNJZHMgPSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIFwiZGVzdHJveVwiLCBwcmV2aW91c0lkcylcbiAgICAgIH0pXG4gICAgICBkZWxldGUgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBldmVyeSByZXNvdXJjZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgcmVjb3JkIGJlZm9yZSBpdHMgcGVuZGluZyB1cGRhdGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgYmVmb3JlIHVwZGF0ZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPj59IC0gUHJldmlvdXMgaWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICovXG5hc3luYyBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJldmlvdXNSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpIHtcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59ICovXG4gIGNvbnN0IHByZXZpb3VzSWRzID0gbmV3IE1hcCgpXG5cbiAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXMpIHJldHVybiBwcmV2aW91c0lkc1xuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBwcmV2aW91c0lkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmV2aW91czogdHJ1ZSwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAocHJldmlvdXNJZCAhPT0gbnVsbCkgcHJldmlvdXNJZHMuc2V0KG1vZGVsTmFtZSwgcHJldmlvdXNJZClcbiAgfVxuXG4gIGlmIChwcmV2aW91c0lkcy5zaXplID09PSBwdWJsaXNoZXJSZXNvdXJjZXMuc2l6ZSkgcmV0dXJuIHByZXZpb3VzSWRzXG5cbiAgY29uc3QgcGVyc2lzdGVkTW9kZWwgPSBhd2FpdCBtb2RlbFxuICAgIC5xdWVyeUZvck1vZGVsKG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcbiAgICAuZmluZChtb2RlbC5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkpXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGlmIChwcmV2aW91c0lkcy5oYXMobW9kZWxOYW1lKSkgY29udGludWVcblxuICAgIGNvbnN0IHBlcnNpc3RlZElkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsOiBwZXJzaXN0ZWRNb2RlbCwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAocGVyc2lzdGVkSWQgIT09IG51bGwpIHByZXZpb3VzSWRzLnNldChtb2RlbE5hbWUsIHBlcnNpc3RlZElkKVxuICB9XG5cbiAgcmV0dXJuIHByZXZpb3VzSWRzXG59XG5cbi8qKlxuICogUmVhZHMgYSByZXNvdXJjZSBpZGVudGl0eSBvbmx5IHdoZW4gZXZlcnkgaWRlbnRpdHkgYXR0cmlidXRlIHdhcyBsb2FkZWQgb24gdGhlIGJhY2tpbmcgcmVjb3JkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJZGVudGl0eSBhcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gQmFja2luZyBtb2RlbC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucHJldmlvdXNdIC0gUmVhZCB2YWx1ZXMgZnJvbSBiZWZvcmUgcGVuZGluZyBjaGFuZ2VzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBhcmdzLnByaW1hcnlLZXkgLSBSZXNvdXJjZSBpZGVudGl0eSBkZWZpbml0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlIHwgbnVsbH0gLSBDb21wbGV0ZSBpZGVudGl0eSBvciBudWxsIHdoZW4gdW5hdmFpbGFibGUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbCwgcHJldmlvdXMgPSBmYWxzZSwgcHJpbWFyeUtleX0pIHtcbiAgY29uc3QgYXR0cmlidXRlcyA9IG1vZGVsLmF0dHJpYnV0ZXMoKVxuICBjb25zdCBjaGFuZ2VzID0gbW9kZWwuY2hhbmdlcygpXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyPn0gKi9cbiAgY29uc3QgaWRlbnRpdHlBdHRyaWJ1dGVzID0ge31cbiAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZXMgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleSA6IFtwcmltYXJ5S2V5XVxuXG4gIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBwcmltYXJ5S2V5QXR0cmlidXRlcykge1xuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcbiAgICBsZXQgdmFsdWVcblxuICAgIGlmIChwcmV2aW91cyAmJiBPYmplY3QuaGFzT3duKGNoYW5nZXMsIGNvbHVtbk5hbWUpKSB7XG4gICAgICB2YWx1ZSA9IGNoYW5nZXNbY29sdW1uTmFtZV1bMF1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFPYmplY3QuaGFzT3duKGF0dHJpYnV0ZXMsIGF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gbnVsbFxuXG4gICAgICB2YWx1ZSA9IGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikgcmV0dXJuIG51bGxcblxuICAgIGlkZW50aXR5QXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gIH1cblxuICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiBpZGVudGl0eUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0pXG59XG5cbi8qKlxuICogRmFucyBvbmUgYmFja2luZy1yZWNvcmQgbGlmZWN5Y2xlIGV2ZW50IG91dCB0aHJvdWdoIGV2ZXJ5IGNvbmZpZ3VyZWQgZnJvbnRlbmQtcmVzb3VyY2UgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFjdGlvbiAtIExpZmVjeWNsZSBhY3Rpb24uXG4gKiBAcGFyYW0ge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gW3ByZXZpb3VzSWRzXSAtIFByZXZpb3VzIHVwZGF0ZSBpZGVudGl0aWVzIGJ5IHJlc291cmNlIG5hbWUuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgYWN0aW9uLCBwcmV2aW91c0lkcykge1xuICBjb25zdCBjb25maWd1cmF0aW9uID0gbW9kZWwuX2dldENvbmZpZ3VyYXRpb24oKVxuICBjb25zdCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pPy5nZXQobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuXG4gIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSByZXR1cm5cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtwcmltYXJ5S2V5fV0gb2YgcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgY29uc3QgcHJldmlvdXNJZCA9IHByZXZpb3VzSWRzPy5nZXQobW9kZWxOYW1lKVxuICAgIGNvbnN0IGN1cnJlbnRJZCA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbCwgcHJpbWFyeUtleX0pXG4gICAgY29uc3QgaWQgPSBjdXJyZW50SWQgPz8gcHJldmlvdXNJZFxuXG4gICAgaWYgKGlkID09PSBudWxsIHx8IGlkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBpZGVudGl0eUNoYW5nZWQgPSBhY3Rpb24gPT09IFwidXBkYXRlXCJcbiAgICAgICYmIGN1cnJlbnRJZCAhPT0gbnVsbFxuICAgICAgJiYgcHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkXG4gICAgICAmJiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkKSAhPT0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWQpXG5cbiAgICBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnQoY29uZmlndXJhdGlvbiwgbW9kZWxOYW1lLCB7XG4gICAgICBhY3Rpb24sXG4gICAgICBpZCxcbiAgICAgIC4uLihpZGVudGl0eUNoYW5nZWQgPyB7cHJldmlvdXNJZH0gOiB7fSlcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogRmFucyBhIGxpZmVjeWNsZSBldmVudCBvdXQgdG8gYWxsIFYyIFwiZnJvbnRlbmQtbW9kZWxzXCIgc3Vic2NyaWJlcnNcbiAqIHdob3NlIGBwYXJhbXMubW9kZWxgIG1hdGNoZXMuIFJlY29yZCBhdHRyaWJ1dGVzIGdvIHRocm91Z2ggdGhlXG4gKiB0cmFuc3BvcnQgc2VyaWFsaXplciBzbyBEYXRlL3VuZGVmaW5lZC9ldGMuIHN1cnZpdmUgdGhlIEpTT04gaG9wLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3thY3Rpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIGlkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcHJldmlvdXNJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZWNvcmQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBldmVudCAtIExpZmVjeWNsZSBldmVudC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnQoY29uZmlndXJhdGlvbiwgbW9kZWxOYW1lLCBldmVudCkge1xuICBjb25zdCBib2R5ID0ge1xuICAgIGFjdGlvbjogZXZlbnQuYWN0aW9uLFxuICAgIGlkOiBldmVudC5pZCxcbiAgICBtb2RlbDogbW9kZWxOYW1lLFxuICAgIC4uLihldmVudC5wcmV2aW91c0lkICE9PSB1bmRlZmluZWQgPyB7cHJldmlvdXNJZDogZXZlbnQucHJldmlvdXNJZH0gOiB7fSksXG4gICAgLi4uKGV2ZW50LnJlY29yZCA/IHtyZWNvcmQ6IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShldmVudC5yZWNvcmQsIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSl9IDoge30pXG4gIH1cblxuICBjb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7bW9kZWw6IG1vZGVsTmFtZX0sIGJvZHkpXG59XG4iXX0=