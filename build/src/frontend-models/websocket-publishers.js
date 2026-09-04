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
 * Returns every resource identity represented by the record before its pending changes or destruction.
 * @param {import("../database/record/index.js").default} model - Backing model before update or destroy.
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
 * @param {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} [previousIds] - Persisted identities captured before update or destroy.
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
        const id = action === "destroy" ? previousId : currentId ?? previousId;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRS9GLGdJQUFnSTtBQUNoSSxzUUFBc1E7QUFFdFEsTUFBTSwrQkFBK0IsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQ3JELE1BQU0sb0NBQW9DLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUMxRCx5S0FBeUs7QUFDekssTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRXZELDBFQUEwRTtBQUMxRSxNQUFNLENBQUMsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsU0FBUyw2Q0FBNkMsQ0FBQyxhQUFhO0lBQ2xFLE9BQU87UUFDTCxRQUFRLEVBQUUsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQztLQUMzRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsaUNBQWlDLENBQUMsU0FBUztJQUN6RCxPQUFPLG1CQUFtQixTQUFTLEVBQUUsQ0FBQTtBQUN2QyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsOENBQThDLENBQUMsZ0JBQWdCO0lBQ3RFOztvR0FFZ0c7SUFDaEcs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O1FBQ3BCLEVBQUUsRUFBRSxLQUFLLENBQUMsRUFBRTtRQUNaLEtBQUssRUFBRSxTQUFTO1FBQ2hCLEdBQUcsQ0FBQyxLQUFLLENBQUMsVUFBVSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVUsRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDekUsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUMsTUFBTSxFQUFFLG9DQUFvQyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsNkNBQTZDLENBQUMsYUFBYSxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7S0FDcEosQ0FBQTtJQUVELGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyw0QkFBNEIsRUFBRSxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQTtBQUMxRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuL2J1aWx0LWluLXJlc291cmNlcy5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzfSBmcm9tIFwiLi9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7c2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5LCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7e3ByaW1hcnlLZXk6IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259fSBGcm9udGVuZE1vZGVsUHVibGlzaGVyUmVzb3VyY2UgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIsIF9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzPzogTWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZCAqL1xuXG5jb25zdCBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzID0gbmV3IFdlYWtTZXQoKVxuY29uc3QgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zID0gbmV3IFdlYWtTZXQoKVxuLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgV2Vha01hcDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxQdWJsaXNoZXJSZXNvdXJjZT4+Pn0gKi9cbmNvbnN0IHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqIFNoYXJlZCBjaGFubmVsIG5hbWUgZm9yIGFsbCBmcm9udGVuZC1tb2RlbCBsaWZlY3ljbGUgc3Vic2NyaXB0aW9ucy4gKi9cbmV4cG9ydCBjb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEJyb2FkY2FzdENoYW5uZWxOYW1lIGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCcm9hZGNhc3QgY2hhbm5lbCBuYW1lIChsZWdhY3ksIHJldGFpbmVkIGZvciBtaWdyYXRpb24gY29tcGF0aWJpbGl0eSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUobW9kZWxOYW1lKSB7XG4gIHJldHVybiBgZnJvbnRlbmQtbW9kZWxzOiR7bW9kZWxOYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcyBmcm9tIGFiaWxpdHkgcmVzb3VyY2VzIGxpc3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IGFiaWxpdHlSZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAtIFJlc291cmNlIGRlZmluaXRpb25zIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGcm9tQWJpbGl0eVJlc291cmNlc0xpc3QoYWJpbGl0eVJlc291cmNlcykge1xuICAvKipcbiAgICogUmVzb3VyY2VzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAqL1xuICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhYmlsaXR5UmVzb3VyY2VzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZXMgdG8gYmUgYW4gYXJyYXkgYnV0IGdvdDogJHt0eXBlb2YgYWJpbGl0eVJlc291cmNlc31gKVxuICB9XG5cbiAgaWYgKGFiaWxpdHlSZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcmVzb3VyY2VzXG5cbiAgZm9yIChjb25zdCByZXNvdXJjZUNsYXNzIG9mIGFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIHRvIGJlIGEgY2xhc3MgYnV0IGdvdDogJHt0eXBlb2YgcmVzb3VyY2VDbGFzc31gKVxuICAgIH1cblxuICAgIGlmIChmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyhyZXNvdXJjZUNsYXNzKSkge1xuICAgICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgICAvLyBgQmFzZVJlc291cmNlYCB0aGF0IG90aGVyIHJlc291cmNlcyBleHRlbmQpIGJhY2tzIG5vIG1vZGVsLCBzbyBpdCBpc24ndCBhXG4gICAgICAvLyBwdWJsaXNoYWJsZSBmcm9udGVuZCBtb2RlbC4gU2tpcCBpdCBpbnN0ZWFkIG9mIGxldHRpbmcgYG1vZGVsQ2xhc3MoKWBcbiAgICAgIC8vIHRocm93IGByZXF1aXJlcyBhIHN0YXRpYyBNb2RlbENsYXNzYCBkdXJpbmcgYWJpbGl0eS1yZXNvdXJjZSBkaXNjb3ZlcnkuXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpLm1vZGVsTmFtZSB8fCByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICByZXNvdXJjZXNbbW9kZWxOYW1lXSA9IHJlc291cmNlQ2xhc3NcbiAgICB9IGVsc2UgaWYgKHJlc291cmNlQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSkge1xuICAgICAgLy8gQXV0aG9yaXphdGlvbi1vbmx5IHJlc291cmNlIOKAlCB2YWxpZCBidXQgbm90IHJlbGV2YW50IGZvciBXZWJTb2NrZXQgcHVibGlzaGluZ1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZSBjbGFzczogJHtyZXNvdXJjZUNsYXNzLm5hbWV9LiBFeHBlY3RlZCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIG9yIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MuYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzb3VyY2VzXG59XG5cbi8qKlxuICogUnVucyB0aGUgZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkKGNvbmZpZ3VyYXRpb24pIHtcbiAgLyoqXG4gICAqIEFsbCBmcm9udGVuZCBtb2RlbHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGxldCBhbGxGcm9udGVuZE1vZGVscyA9IHt9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgY29uc3QgcHJvamVjdFJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGFsbEZyb250ZW5kTW9kZWxzID0gey4uLmFsbEZyb250ZW5kTW9kZWxzLCAuLi5wcm9qZWN0UmVzb3VyY2VzfVxuICB9XG5cbiAgLy8gQWx3YXlzIG1lcmdlIHRoZSBhYmlsaXR5IHJlc29sdmVyJ3MgcmVzb3VyY2UgbGlzdCB0b28uIEEgcHJvamVjdCBjYW4gZXhwb3NlIHNvbWVcbiAgLy8gcmVzb3VyY2VzIGFzIGRpc2NvdmVyYWJsZSBgc3JjL3Jlc291cmNlcy8qLmpzYCBmaWxlcyAoY29uZmlndXJlZCBvciBhdXRvLWRpc2NvdmVyZWQpXG4gIC8vIGFuZCBvdGhlcnMgb25seSB0aHJvdWdoIGBnZXRBYmlsaXR5UmVzb3VyY2VzKClgOyBib3RoIHNldHMgbmVlZCBsaWZlY3ljbGUgcHVibGlzaGVycyxcbiAgLy8gc28gcmVzb3VyY2UgZGlzY292ZXJ5IG11c3Qgbm90IHN1cHByZXNzIHRoaXMgbGlzdC5cbiAgY29uc3QgYWJpbGl0eVJlc291cmNlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0QWJpbGl0eVJlc291cmNlcygpXG5cbiAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7XG4gICAgLi4uYWxsRnJvbnRlbmRNb2RlbHMsXG4gICAgLi4uZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKVxuICB9XG5cbiAgLy8gUGhhc2UgMzogcmVnaXN0ZXIgdGhlIFYyIGNoYW5uZWwgY2xhc3Mgb25jZSBwZXIgY29uZmlndXJhdGlvbiBzb1xuICAvLyBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWx9fSlgIGZpbmRzIGl0LlxuICAvLyBEeW5hbWljIGltcG9ydCBrZWVwcyBzZXJ2ZXItb25seSBXZWJzb2NrZXRSZXF1ZXN0ICsgTm9kZSB1dGlsaXRpZXNcbiAgLy8gb3V0IG9mIGJyb3dzZXIgYnVuZGxlcyB0aGF0IHRyYW5zaXRpdmVseSBwdWxsIGluIHRoaXMgbW9kdWxlIHZpYVxuICAvLyBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIuXG4gIGlmICghY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmhhcyhjb25maWd1cmF0aW9uKSkge1xuICAgIGNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucy5hZGQoY29uZmlndXJhdGlvbilcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWx9ID0gYXdhaXQgaW1wb3J0KFwiLi93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKVxuXG4gICAgY29uZmlndXJhdGlvbi5yZWdpc3RlcldlYnNvY2tldENoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWwpXG4gIH1cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHJlc291cmNlQ2xhc3NdIG9mIE9iamVjdC5lbnRyaWVzKGFsbEZyb250ZW5kTW9kZWxzKSkge1xuICAgIC8vIEFuIGFic3RyYWN0IGJhc2UgcmVzb3VyY2UgKG5vIHN0YXRpYyBNb2RlbENsYXNzIOKAlCBlLmcuIGFuIGFwcCdzIHNoYXJlZFxuICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIHRoZXJlIGlzXG4gICAgLy8gbm90aGluZyB0byBwdWJsaXNoIHJlYWx0aW1lIGV2ZW50cyBmb3IuIFNraXAgaXQgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IHJlc291cmNlQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRQcmltYXJ5S2V5ID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXlcbiAgICBjb25zdCBtb2RlbFByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb25maWd1cmVkUHJpbWFyeUtleSB8fCAoQXJyYXkuaXNBcnJheShtb2RlbFByaW1hcnlLZXkpXG4gICAgICA/IG1vZGVsUHJpbWFyeUtleS5tYXAoKGNvbHVtbk5hbWUpID0+IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoY29sdW1uTmFtZSkgfHwgY29sdW1uTmFtZSlcbiAgICAgIDogbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShtb2RlbFByaW1hcnlLZXkpIHx8IG1vZGVsUHJpbWFyeUtleSlcbiAgICBsZXQgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MpIHtcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcyA9IG5ldyBXZWFrTWFwKClcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzKVxuICAgIH1cblxuICAgIGxldCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MuZ2V0KG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykge1xuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzID0gbmV3IE1hcCgpXG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3Muc2V0KG1vZGVsQ2xhc3MsIHB1Ymxpc2hlclJlc291cmNlcylcbiAgICB9XG5cbiAgICBwdWJsaXNoZXJSZXNvdXJjZXMuc2V0KG1vZGVsTmFtZSwge1xuICAgICAgcHJpbWFyeUtleVxuICAgIH0pXG5cbiAgICAvLyBSZWdpc3RlciBsaWZlY3ljbGUgaG9va3Mgb25jZSBwZXIgbW9kZWwgY2xhc3MsIG5vdCBwZXIgY29uZmlndXJhdGlvbi4gQSBtb2RlbCBjbGFzcyBiZWxvbmdzIHRvIGFcbiAgICAvLyBzaW5nbGUgYmFja2VuZCBwcm9qZWN0L2NvbmZpZyBpbiBwcm9kdWN0aW9uLCBzbyBwZXItY29uZmlnIHJlZ2lzdHJhdGlvbiBvbmx5IGRpZmZlcnMgaW4gdGVzdHMgd2hlcmVcbiAgICAvLyB0aGUgc2FtZSBtb2RlbCBjbGFzcyBpcyByZWFjaGFibGUgZnJvbSBtdWx0aXBsZSBjb25maWdzIOKAlCB0aGVyZSBpdCBhdHRhY2hlcyBkdXBsaWNhdGUgYmVmb3JlQ3JlYXRlL1xuICAgIC8vIGFmdGVyU2F2ZS9hZnRlckRlc3Ryb3kgaG9va3MgdGhhdCBkb3VibGUtZmlyZSBicm9hZGNhc3RzIChhbmQgbGVhayBhY3Jvc3Mgc3BlY3MpLiBUaGUgaG9va3MgcmVhZCB0aGVcbiAgICAvLyBtb2RlbCdzIHJ1bnRpbWUgY29uZmlndXJhdGlvbiB3aGVuIGJyb2FkY2FzdGluZywgc28gYSBzaW5nbGUgcmVnaXN0cmF0aW9uIGlzIHN1ZmZpY2llbnQuXG4gICAgaWYgKG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MuaGFzKG1vZGVsQ2xhc3MpKSBjb250aW51ZVxuXG4gICAgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcy5hZGQobW9kZWxDbGFzcylcblxuICAgIG1vZGVsQ2xhc3MuYmVmb3JlQ3JlYXRlKChtb2RlbCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwiY3JlYXRlXCJcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVVcGRhdGUoYXN5bmMgKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24gPSBcInVwZGF0ZVwiXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkcyA9IGF3YWl0IGZyb250ZW5kTW9kZWxQcmV2aW91c1Jlc291cmNlSWRlbnRpdGllcyhtb2RlbClcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVEZXN0cm95KGFzeW5jIChtb2RlbCkgPT4ge1xuICAgICAgY29uc3Qgd2Vic29ja2V0TW9kZWwgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbClcblxuICAgICAgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHMgPSBhd2FpdCBmcm9udGVuZE1vZGVsUHJldmlvdXNSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpXG4gICAgfSlcblxuICAgIG1vZGVsQ2xhc3MuYWZ0ZXJTYXZlKChtb2RlbCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG4gICAgICBjb25zdCBhY3Rpb24gPSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uXG5cbiAgICAgIGlmIChhY3Rpb24gIT09IFwiY3JlYXRlXCIgJiYgYWN0aW9uICE9PSBcInVwZGF0ZVwiKSByZXR1cm5cbiAgICAgIGNvbnN0IHByZXZpb3VzSWRzID0gbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzXG5cbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgYWN0aW9uLCBwcmV2aW91c0lkcylcbiAgICAgIH0pXG4gICAgICBkZWxldGUgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyRGVzdHJveSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHdlYnNvY2tldE1vZGVsID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG4gICAgICBjb25zdCBwcmV2aW91c0lkcyA9IHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzXG5cbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgXCJkZXN0cm95XCIsIHByZXZpb3VzSWRzKVxuICAgICAgfSlcbiAgICAgIGRlbGV0ZSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGV2ZXJ5IHJlc291cmNlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IHRoZSByZWNvcmQgYmVmb3JlIGl0cyBwZW5kaW5nIGNoYW5nZXMgb3IgZGVzdHJ1Y3Rpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgYmVmb3JlIHVwZGF0ZSBvciBkZXN0cm95LlxuICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+Pn0gLSBQcmV2aW91cyBpZGVudGl0aWVzIGJ5IHJlc291cmNlIG5hbWUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQcmV2aW91c1Jlc291cmNlSWRlbnRpdGllcyhtb2RlbCkge1xuICBjb25zdCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpPy5nZXQobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gKi9cbiAgY29uc3QgcHJldmlvdXNJZHMgPSBuZXcgTWFwKClcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuIHByZXZpb3VzSWRzXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByZXZpb3VzOiB0cnVlLCBwcmltYXJ5S2V5fSlcblxuICAgIGlmIChwcmV2aW91c0lkICE9PSBudWxsKSBwcmV2aW91c0lkcy5zZXQobW9kZWxOYW1lLCBwcmV2aW91c0lkKVxuICB9XG5cbiAgaWYgKHByZXZpb3VzSWRzLnNpemUgPT09IHB1Ymxpc2hlclJlc291cmNlcy5zaXplKSByZXR1cm4gcHJldmlvdXNJZHNcblxuICBjb25zdCBwZXJzaXN0ZWRNb2RlbCA9IGF3YWl0IG1vZGVsXG4gICAgLnF1ZXJ5Rm9yTW9kZWwobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAgIC5maW5kKG1vZGVsLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSlcblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtwcmltYXJ5S2V5fV0gb2YgcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgaWYgKHByZXZpb3VzSWRzLmhhcyhtb2RlbE5hbWUpKSBjb250aW51ZVxuXG4gICAgY29uc3QgcGVyc2lzdGVkSWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWw6IHBlcnNpc3RlZE1vZGVsLCBwcmltYXJ5S2V5fSlcblxuICAgIGlmIChwZXJzaXN0ZWRJZCAhPT0gbnVsbCkgcHJldmlvdXNJZHMuc2V0KG1vZGVsTmFtZSwgcGVyc2lzdGVkSWQpXG4gIH1cblxuICByZXR1cm4gcHJldmlvdXNJZHNcbn1cblxuLyoqXG4gKiBSZWFkcyBhIHJlc291cmNlIGlkZW50aXR5IG9ubHkgd2hlbiBldmVyeSBpZGVudGl0eSBhdHRyaWJ1dGUgd2FzIGxvYWRlZCBvbiB0aGUgYmFja2luZyByZWNvcmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIElkZW50aXR5IGFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBCYWNraW5nIG1vZGVsLlxuICogQHBhcmFtIHtib29sZWFufSBbYXJncy5wcmV2aW91c10gLSBSZWFkIHZhbHVlcyBmcm9tIGJlZm9yZSBwZW5kaW5nIGNoYW5nZXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MucHJpbWFyeUtleSAtIFJlc291cmNlIGlkZW50aXR5IGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUgfCBudWxsfSAtIENvbXBsZXRlIGlkZW50aXR5IG9yIG51bGwgd2hlbiB1bmF2YWlsYWJsZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmV2aW91cyA9IGZhbHNlLCBwcmltYXJ5S2V5fSkge1xuICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG4gIGNvbnN0IGNoYW5nZXMgPSBtb2RlbC5jaGFuZ2VzKClcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXI+fSAqL1xuICBjb25zdCBpZGVudGl0eUF0dHJpYnV0ZXMgPSB7fVxuICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHByaW1hcnlLZXlBdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgY29sdW1uTmFtZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuICAgIGxldCB2YWx1ZVxuXG4gICAgaWYgKHByZXZpb3VzICYmIE9iamVjdC5oYXNPd24oY2hhbmdlcywgY29sdW1uTmFtZSkpIHtcbiAgICAgIHZhbHVlID0gY2hhbmdlc1tjb2x1bW5OYW1lXVswXVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIU9iamVjdC5oYXNPd24oYXR0cmlidXRlcywgYXR0cmlidXRlTmFtZSkpIHJldHVybiBudWxsXG5cbiAgICAgIHZhbHVlID0gYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSByZXR1cm4gbnVsbFxuXG4gICAgaWRlbnRpdHlBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgfVxuXG4gIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IGlkZW50aXR5QXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSlcbn1cblxuLyoqXG4gKiBGYW5zIG9uZSBiYWNraW5nLXJlY29yZCBsaWZlY3ljbGUgZXZlbnQgb3V0IHRocm91Z2ggZXZlcnkgY29uZmlndXJlZCBmcm9udGVuZC1yZXNvdXJjZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQmFja2luZyBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gTGlmZWN5Y2xlIGFjdGlvbi5cbiAqIEBwYXJhbSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fSBbcHJldmlvdXNJZHNdIC0gUGVyc2lzdGVkIGlkZW50aXRpZXMgY2FwdHVyZWQgYmVmb3JlIHVwZGF0ZSBvciBkZXN0cm95LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcHJldmlvdXNJZHMpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBwcmV2aW91c0lkcz8uZ2V0KG1vZGVsTmFtZSlcbiAgICBjb25zdCBjdXJyZW50SWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByaW1hcnlLZXl9KVxuICAgIGNvbnN0IGlkID0gYWN0aW9uID09PSBcImRlc3Ryb3lcIiA/IHByZXZpb3VzSWQgOiBjdXJyZW50SWQgPz8gcHJldmlvdXNJZFxuXG4gICAgaWYgKGlkID09PSBudWxsIHx8IGlkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBpZGVudGl0eUNoYW5nZWQgPSBhY3Rpb24gPT09IFwidXBkYXRlXCJcbiAgICAgICYmIGN1cnJlbnRJZCAhPT0gbnVsbFxuICAgICAgJiYgcHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkXG4gICAgICAmJiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkKSAhPT0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWQpXG5cbiAgICBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnQoY29uZmlndXJhdGlvbiwgbW9kZWxOYW1lLCB7XG4gICAgICBhY3Rpb24sXG4gICAgICBpZCxcbiAgICAgIC4uLihpZGVudGl0eUNoYW5nZWQgPyB7cHJldmlvdXNJZH0gOiB7fSlcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogRmFucyBhIGxpZmVjeWNsZSBldmVudCBvdXQgdG8gYWxsIFYyIFwiZnJvbnRlbmQtbW9kZWxzXCIgc3Vic2NyaWJlcnNcbiAqIHdob3NlIGBwYXJhbXMubW9kZWxgIG1hdGNoZXMuIFJlY29yZCBhdHRyaWJ1dGVzIGdvIHRocm91Z2ggdGhlXG4gKiB0cmFuc3BvcnQgc2VyaWFsaXplciBzbyBEYXRlL3VuZGVmaW5lZC9ldGMuIHN1cnZpdmUgdGhlIEpTT04gaG9wLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3thY3Rpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIGlkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcHJldmlvdXNJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZWNvcmQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBldmVudCAtIExpZmVjeWNsZSBldmVudC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnQoY29uZmlndXJhdGlvbiwgbW9kZWxOYW1lLCBldmVudCkge1xuICBjb25zdCBib2R5ID0ge1xuICAgIGFjdGlvbjogZXZlbnQuYWN0aW9uLFxuICAgIGlkOiBldmVudC5pZCxcbiAgICBtb2RlbDogbW9kZWxOYW1lLFxuICAgIC4uLihldmVudC5wcmV2aW91c0lkICE9PSB1bmRlZmluZWQgPyB7cHJldmlvdXNJZDogZXZlbnQucHJldmlvdXNJZH0gOiB7fSksXG4gICAgLi4uKGV2ZW50LnJlY29yZCA/IHtyZWNvcmQ6IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShldmVudC5yZWNvcmQsIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSl9IDoge30pXG4gIH1cblxuICBjb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7bW9kZWw6IG1vZGVsTmFtZX0sIGJvZHkpXG59XG4iXX0=