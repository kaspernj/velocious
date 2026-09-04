// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceDefinitionIsClass } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyCacheKey, readModelPrimaryKeyValue } from "../utils/model-primary-key.js";
/** @typedef {{primaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition}} FrontendModelPublisherResource */
/** @typedef {Record<string, import("./query.js").FrontendModelTransportValue>} FrontendModelDestroyAuthorizationRecord */
/** @typedef {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update", __frontendModelWebsocketDestroyAuthorizationRecord?: FrontendModelDestroyAuthorizationRecord, __frontendModelWebsocketPreviousIds?: Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>}} FrontendModelWebsocketRecord */
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
            const persistedModel = await model
                .queryForModel(model.getModelClass())
                .find(model._persistedPrimaryKeyValue());
            if (!persistedModel)
                throw new Error(`Cannot capture websocket destroy authorization for missing ${model.getModelClass().name}`);
            websocketModel.__frontendModelWebsocketPreviousIds = frontendModelResourceIdentities(persistedModel);
            websocketModel.__frontendModelWebsocketDestroyAuthorizationRecord = frontendModelDestroyAuthorizationRecord(persistedModel);
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
            const destroyAuthorizationRecord = websocketModel.__frontendModelWebsocketDestroyAuthorizationRecord;
            const previousIds = websocketModel.__frontendModelWebsocketPreviousIds;
            void model.connection().afterCommit(async () => {
                broadcastFrontendModelEvents(model, "destroy", previousIds, destroyAuthorizationRecord);
            });
            delete websocketModel.__frontendModelWebsocketDestroyAuthorizationRecord;
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
 * Returns every configured resource identity represented by a persisted backing record.
 * @param {import("../database/record/index.js").default} model - Fully loaded persisted backing record.
 * @returns {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} - Identities by resource name.
 */
function frontendModelResourceIdentities(model) {
    const publisherResources = publisherResourcesByConfiguration.get(model._getConfiguration())?.get(model.getModelClass());
    /** @type {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} */
    const identities = new Map();
    if (!publisherResources)
        return identities;
    for (const [modelName, { primaryKey }] of publisherResources) {
        const id = frontendModelResourceIdentity({ model, primaryKey });
        if (id !== null)
            identities.set(modelName, id);
    }
    return identities;
}
/**
 * Serializes the persisted record for server-side destroy authorization. Binary values
 * use a dedicated byte-array marker because the shared transport serializer otherwise
 * leaves Buffers to the JSON implementation used by the worker or Beacon transport.
 * @param {import("../database/record/index.js").default} model - Fully loaded persisted backing record.
 * @returns {FrontendModelDestroyAuthorizationRecord} - Column-keyed transport values.
 */
function frontendModelDestroyAuthorizationRecord(model) {
    const serializationOptions = transportSerializationOptionsForConfiguration(model._getConfiguration());
    /** @type {FrontendModelDestroyAuthorizationRecord} */
    const authorizationRecord = {};
    for (const [columnName, value] of Object.entries(model.rawAttributes())) {
        authorizationRecord[columnName] = value instanceof Uint8Array
            ? { __velociousDestroyAuthorizationType: "binary", value: Array.from(value) }
            : serializeFrontendModelTransportValue(value, serializationOptions);
    }
    if (Object.keys(authorizationRecord).length === 0) {
        throw new Error(`Cannot capture websocket destroy authorization without attributes for ${model.getModelClass().name}`);
    }
    return authorizationRecord;
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
 * @param {FrontendModelDestroyAuthorizationRecord} [destroyAuthorizationRecord] - Server-only pre-delete row used to authorize a destroyed record.
 * @returns {void}
 */
function broadcastFrontendModelEvents(model, action, previousIds, destroyAuthorizationRecord) {
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
            ...(destroyAuthorizationRecord !== undefined ? { destroyAuthorizationRecord } : {}),
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
 * @param {{action: "create" | "update" | "destroy", destroyAuthorizationRecord?: FrontendModelDestroyAuthorizationRecord, id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, previousId?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, record?: Record<string, import("./query.js").FrontendModelTransportValue>}} event - Lifecycle event.
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
    configuration.broadcastToChannel(FRONTEND_MODELS_CHANNEL_NAME, {
        ...(event.destroyAuthorizationRecord !== undefined ? { destroyAuthorizationRecord: event.destroyAuthorizationRecord } : {}),
        model: modelName
    }, body);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRS9GLGdJQUFnSTtBQUNoSSwwSEFBMEg7QUFDMUgsb1dBQW9XO0FBRXBXLE1BQU0sK0JBQStCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUNyRCxNQUFNLG9DQUFvQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFDMUQseUtBQXlLO0FBQ3pLLE1BQU0saUNBQWlDLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUV2RCwwRUFBMEU7QUFDMUUsTUFBTSxDQUFDLE1BQU0sNEJBQTRCLEdBQUcsaUJBQWlCLENBQUE7QUFFN0Q7Ozs7R0FJRztBQUNILFNBQVMsNkNBQTZDLENBQUMsYUFBYTtJQUNsRSxPQUFPO1FBQ0wsUUFBUSxFQUFFLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLFdBQVcsQ0FBQyxhQUFhLENBQUM7S0FDM0UsQ0FBQTtBQUNILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLGlDQUFpQyxDQUFDLFNBQVM7SUFDekQsT0FBTyxtQkFBbUIsU0FBUyxFQUFFLENBQUE7QUFDdkMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLDhDQUE4QyxDQUFDLGdCQUFnQjtJQUN0RTs7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RUFBRSxDQUFDO1FBQ3pFLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxvQ0FBb0MsQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLDZDQUE2QyxDQUFDLGFBQWEsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0tBQ3BKLENBQUE7SUFFRCxhQUFhLENBQUMsa0JBQWtCLENBQUMsNEJBQTRCLEVBQUU7UUFDN0QsR0FBRyxDQUFDLEtBQUssQ0FBQywwQkFBMEIsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUMsMEJBQTBCLEVBQUUsS0FBSyxDQUFDLDBCQUEwQixFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN6SCxLQUFLLEVBQUUsU0FBUztLQUNqQixFQUFFLElBQUksQ0FBQyxDQUFBO0FBQ1YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSBmcm9tIFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0fSBmcm9tIFwiLi9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzc30gZnJvbSBcIi4vcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge3NlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKiogQHR5cGVkZWYge3twcmltYXJ5S2V5OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufX0gRnJvbnRlbmRNb2RlbFB1Ymxpc2hlclJlc291cmNlICovXG4vKiogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gRnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiLCBfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXREZXN0cm95QXV0aG9yaXphdGlvblJlY29yZD86IEZyb250ZW5kTW9kZWxEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCwgX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHM/OiBNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkICovXG5cbmNvbnN0IG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MgPSBuZXcgV2Vha1NldCgpXG5jb25zdCBjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMgPSBuZXcgV2Vha1NldCgpXG4vKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbFB1Ymxpc2hlclJlc291cmNlPj4+fSAqL1xuY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKiogU2hhcmVkIGNoYW5uZWwgbmFtZSBmb3IgYWxsIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBzdWJzY3JpcHRpb25zLiAqL1xuZXhwb3J0IGNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnN9IC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICovXG5mdW5jdGlvbiB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICByZXR1cm4ge1xuICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUgaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJyb2FkY2FzdCBjaGFubmVsIG5hbWUgKGxlZ2FjeSwgcmV0YWluZWQgZm9yIG1pZ3JhdGlvbiBjb21wYXRpYmlsaXR5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxCcm9hZGNhc3RDaGFubmVsTmFtZShtb2RlbE5hbWUpIHtcbiAgcmV0dXJuIGBmcm9udGVuZC1tb2RlbHM6JHttb2RlbE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzIGZyb20gYWJpbGl0eSByZXNvdXJjZXMgbGlzdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gYWJpbGl0eVJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKSB7XG4gIC8qKlxuICAgKiBSZXNvdXJjZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGFiaWxpdHlSZXNvdXJjZXMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlcyB0byBiZSBhbiBhcnJheSBidXQgZ290OiAke3R5cGVvZiBhYmlsaXR5UmVzb3VyY2VzfWApXG4gIH1cblxuICBpZiAoYWJpbGl0eVJlc291cmNlcy5sZW5ndGggPT09IDApIHJldHVybiByZXNvdXJjZXNcblxuICBmb3IgKGNvbnN0IHJlc291cmNlQ2xhc3Mgb2YgYWJpbGl0eVJlc291cmNlcykge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2UgdG8gYmUgYSBjbGFzcyBidXQgZ290OiAke3R5cGVvZiByZXNvdXJjZUNsYXNzfWApXG4gICAgfVxuXG4gICAgaWYgKGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlQ2xhc3MpKSB7XG4gICAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIGl0IGlzbid0IGFcbiAgICAgIC8vIHB1Ymxpc2hhYmxlIGZyb250ZW5kIG1vZGVsLiBTa2lwIGl0IGluc3RlYWQgb2YgbGV0dGluZyBgbW9kZWxDbGFzcygpYFxuICAgICAgLy8gdGhyb3cgYHJlcXVpcmVzIGEgc3RhdGljIE1vZGVsQ2xhc3NgIGR1cmluZyBhYmlsaXR5LXJlc291cmNlIGRpc2NvdmVyeS5cbiAgICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKCkubW9kZWxOYW1lIHx8IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIHJlc291cmNlc1ttb2RlbE5hbWVdID0gcmVzb3VyY2VDbGFzc1xuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlKSB7XG4gICAgICAvLyBBdXRob3JpemF0aW9uLW9ubHkgcmVzb3VyY2Ug4oCUIHZhbGlkIGJ1dCBub3QgcmVsZXZhbnQgZm9yIFdlYlNvY2tldCBwdWJsaXNoaW5nXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIGNsYXNzOiAke3Jlc291cmNlQ2xhc3MubmFtZX0uIEV4cGVjdGVkIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2Ugb3IgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXNvdXJjZXNcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQoY29uZmlndXJhdGlvbikge1xuICAvKipcbiAgICogQWxsIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gKi9cbiAgbGV0IGFsbEZyb250ZW5kTW9kZWxzID0ge31cblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICBjb25zdCBwcm9qZWN0UmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7Li4uYWxsRnJvbnRlbmRNb2RlbHMsIC4uLnByb2plY3RSZXNvdXJjZXN9XG4gIH1cblxuICAvLyBBbHdheXMgbWVyZ2UgdGhlIGFiaWxpdHkgcmVzb2x2ZXIncyByZXNvdXJjZSBsaXN0IHRvby4gQSBwcm9qZWN0IGNhbiBleHBvc2Ugc29tZVxuICAvLyByZXNvdXJjZXMgYXMgZGlzY292ZXJhYmxlIGBzcmMvcmVzb3VyY2VzLyouanNgIGZpbGVzIChjb25maWd1cmVkIG9yIGF1dG8tZGlzY292ZXJlZClcbiAgLy8gYW5kIG90aGVycyBvbmx5IHRocm91Z2ggYGdldEFiaWxpdHlSZXNvdXJjZXMoKWA7IGJvdGggc2V0cyBuZWVkIGxpZmVjeWNsZSBwdWJsaXNoZXJzLFxuICAvLyBzbyByZXNvdXJjZSBkaXNjb3ZlcnkgbXVzdCBub3Qgc3VwcHJlc3MgdGhpcyBsaXN0LlxuICBjb25zdCBhYmlsaXR5UmVzb3VyY2VzID0gY29uZmlndXJhdGlvbi5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICBhbGxGcm9udGVuZE1vZGVscyA9IHtcbiAgICAuLi5hbGxGcm9udGVuZE1vZGVscyxcbiAgICAuLi5mcm9udGVuZE1vZGVsUmVzb3VyY2VzRnJvbUFiaWxpdHlSZXNvdXJjZXNMaXN0KGFiaWxpdHlSZXNvdXJjZXMpXG4gIH1cblxuICAvLyBQaGFzZSAzOiByZWdpc3RlciB0aGUgVjIgY2hhbm5lbCBjbGFzcyBvbmNlIHBlciBjb25maWd1cmF0aW9uIHNvXG4gIC8vIGBzdWJzY3JpYmVDaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHtwYXJhbXM6IHttb2RlbH19KWAgZmluZHMgaXQuXG4gIC8vIER5bmFtaWMgaW1wb3J0IGtlZXBzIHNlcnZlci1vbmx5IFdlYnNvY2tldFJlcXVlc3QgKyBOb2RlIHV0aWxpdGllc1xuICAvLyBvdXQgb2YgYnJvd3NlciBidW5kbGVzIHRoYXQgdHJhbnNpdGl2ZWx5IHB1bGwgaW4gdGhpcyBtb2R1bGUgdmlhXG4gIC8vIGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlci5cbiAgaWYgKCFjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMuaGFzKGNvbmZpZ3VyYXRpb24pKSB7XG4gICAgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmFkZChjb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IHtkZWZhdWx0OiBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbH0gPSBhd2FpdCBpbXBvcnQoXCIuL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpXG5cbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbClcbiAgfVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VDbGFzc10gb2YgT2JqZWN0LmVudHJpZXMoYWxsRnJvbnRlbmRNb2RlbHMpKSB7XG4gICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgLy8gYEJhc2VSZXNvdXJjZWAgdGhhdCBvdGhlciByZXNvdXJjZXMgZXh0ZW5kKSBiYWNrcyBubyBtb2RlbCwgc28gdGhlcmUgaXNcbiAgICAvLyBub3RoaW5nIHRvIHB1Ymxpc2ggcmVhbHRpbWUgZXZlbnRzIGZvci4gU2tpcCBpdCBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgY29uZmlndXJlZFByaW1hcnlLZXkgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbmZpZ3VyZWRQcmltYXJ5S2V5IHx8IChBcnJheS5pc0FycmF5KG1vZGVsUHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKSB8fCBjb2x1bW5OYW1lKVxuICAgICAgOiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG1vZGVsUHJpbWFyeUtleSkgfHwgbW9kZWxQcmltYXJ5S2V5KVxuICAgIGxldCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIXB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcykge1xuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzID0gbmV3IFdlYWtNYXAoKVxuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgbGV0IHB1Ymxpc2hlclJlc291cmNlcyA9IHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5nZXQobW9kZWxDbGFzcylcblxuICAgIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXMgPSBuZXcgTWFwKClcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5zZXQobW9kZWxDbGFzcywgcHVibGlzaGVyUmVzb3VyY2VzKVxuICAgIH1cblxuICAgIHB1Ymxpc2hlclJlc291cmNlcy5zZXQobW9kZWxOYW1lLCB7XG4gICAgICBwcmltYXJ5S2V5XG4gICAgfSlcblxuICAgIC8vIFJlZ2lzdGVyIGxpZmVjeWNsZSBob29rcyBvbmNlIHBlciBtb2RlbCBjbGFzcywgbm90IHBlciBjb25maWd1cmF0aW9uLiBBIG1vZGVsIGNsYXNzIGJlbG9uZ3MgdG8gYVxuICAgIC8vIHNpbmdsZSBiYWNrZW5kIHByb2plY3QvY29uZmlnIGluIHByb2R1Y3Rpb24sIHNvIHBlci1jb25maWcgcmVnaXN0cmF0aW9uIG9ubHkgZGlmZmVycyBpbiB0ZXN0cyB3aGVyZVxuICAgIC8vIHRoZSBzYW1lIG1vZGVsIGNsYXNzIGlzIHJlYWNoYWJsZSBmcm9tIG11bHRpcGxlIGNvbmZpZ3Mg4oCUIHRoZXJlIGl0IGF0dGFjaGVzIGR1cGxpY2F0ZSBiZWZvcmVDcmVhdGUvXG4gICAgLy8gYWZ0ZXJTYXZlL2FmdGVyRGVzdHJveSBob29rcyB0aGF0IGRvdWJsZS1maXJlIGJyb2FkY2FzdHMgKGFuZCBsZWFrIGFjcm9zcyBzcGVjcykuIFRoZSBob29rcyByZWFkIHRoZVxuICAgIC8vIG1vZGVsJ3MgcnVudGltZSBjb25maWd1cmF0aW9uIHdoZW4gYnJvYWRjYXN0aW5nLCBzbyBhIHNpbmdsZSByZWdpc3RyYXRpb24gaXMgc3VmZmljaWVudC5cbiAgICBpZiAobW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcy5oYXMobW9kZWxDbGFzcykpIGNvbnRpbnVlXG5cbiAgICBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzLmFkZChtb2RlbENsYXNzKVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVDcmVhdGUoKG1vZGVsKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbCkuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uID0gXCJjcmVhdGVcIlxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZVVwZGF0ZShhc3luYyAobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHdlYnNvY2tldE1vZGVsID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG5cbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwidXBkYXRlXCJcbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzID0gYXdhaXQgZnJvbnRlbmRNb2RlbFByZXZpb3VzUmVzb3VyY2VJZGVudGl0aWVzKG1vZGVsKVxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZURlc3Ryb3koYXN5bmMgKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgcGVyc2lzdGVkTW9kZWwgPSBhd2FpdCBtb2RlbFxuICAgICAgICAucXVlcnlGb3JNb2RlbChtb2RlbC5nZXRNb2RlbENsYXNzKCkpXG4gICAgICAgIC5maW5kKG1vZGVsLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSlcblxuICAgICAgaWYgKCFwZXJzaXN0ZWRNb2RlbCkgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2FwdHVyZSB3ZWJzb2NrZXQgZGVzdHJveSBhdXRob3JpemF0aW9uIGZvciBtaXNzaW5nICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YClcblxuICAgICAgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0aWVzKHBlcnNpc3RlZE1vZGVsKVxuICAgICAgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgPSBmcm9udGVuZE1vZGVsRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQocGVyc2lzdGVkTW9kZWwpXG4gICAgfSlcblxuICAgIG1vZGVsQ2xhc3MuYWZ0ZXJTYXZlKChtb2RlbCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG4gICAgICBjb25zdCBhY3Rpb24gPSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uXG5cbiAgICAgIGlmIChhY3Rpb24gIT09IFwiY3JlYXRlXCIgJiYgYWN0aW9uICE9PSBcInVwZGF0ZVwiKSByZXR1cm5cbiAgICAgIGNvbnN0IHByZXZpb3VzSWRzID0gbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzXG5cbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgYWN0aW9uLCBwcmV2aW91c0lkcylcbiAgICAgIH0pXG4gICAgICBkZWxldGUgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyRGVzdHJveSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHdlYnNvY2tldE1vZGVsID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG4gICAgICBjb25zdCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCA9IHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkXG4gICAgICBjb25zdCBwcmV2aW91c0lkcyA9IHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzXG5cbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgXCJkZXN0cm95XCIsIHByZXZpb3VzSWRzLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZClcbiAgICAgIH0pXG4gICAgICBkZWxldGUgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRcbiAgICAgIGRlbGV0ZSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGV2ZXJ5IHJlc291cmNlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IHRoZSByZWNvcmQgYmVmb3JlIGl0cyBwZW5kaW5nIGNoYW5nZXMgb3IgZGVzdHJ1Y3Rpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgYmVmb3JlIHVwZGF0ZSBvciBkZXN0cm95LlxuICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+Pn0gLSBQcmV2aW91cyBpZGVudGl0aWVzIGJ5IHJlc291cmNlIG5hbWUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQcmV2aW91c1Jlc291cmNlSWRlbnRpdGllcyhtb2RlbCkge1xuICBjb25zdCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpPy5nZXQobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gKi9cbiAgY29uc3QgcHJldmlvdXNJZHMgPSBuZXcgTWFwKClcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuIHByZXZpb3VzSWRzXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByZXZpb3VzOiB0cnVlLCBwcmltYXJ5S2V5fSlcblxuICAgIGlmIChwcmV2aW91c0lkICE9PSBudWxsKSBwcmV2aW91c0lkcy5zZXQobW9kZWxOYW1lLCBwcmV2aW91c0lkKVxuICB9XG5cbiAgaWYgKHByZXZpb3VzSWRzLnNpemUgPT09IHB1Ymxpc2hlclJlc291cmNlcy5zaXplKSByZXR1cm4gcHJldmlvdXNJZHNcblxuICBjb25zdCBwZXJzaXN0ZWRNb2RlbCA9IGF3YWl0IG1vZGVsXG4gICAgLnF1ZXJ5Rm9yTW9kZWwobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAgIC5maW5kKG1vZGVsLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSlcblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtwcmltYXJ5S2V5fV0gb2YgcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgaWYgKHByZXZpb3VzSWRzLmhhcyhtb2RlbE5hbWUpKSBjb250aW51ZVxuXG4gICAgY29uc3QgcGVyc2lzdGVkSWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWw6IHBlcnNpc3RlZE1vZGVsLCBwcmltYXJ5S2V5fSlcblxuICAgIGlmIChwZXJzaXN0ZWRJZCAhPT0gbnVsbCkgcHJldmlvdXNJZHMuc2V0KG1vZGVsTmFtZSwgcGVyc2lzdGVkSWQpXG4gIH1cblxuICByZXR1cm4gcHJldmlvdXNJZHNcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGV2ZXJ5IGNvbmZpZ3VyZWQgcmVzb3VyY2UgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgYSBwZXJzaXN0ZWQgYmFja2luZyByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEZ1bGx5IGxvYWRlZCBwZXJzaXN0ZWQgYmFja2luZyByZWNvcmQuXG4gKiBAcmV0dXJucyB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fSAtIElkZW50aXRpZXMgYnkgcmVzb3VyY2UgbmFtZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdGllcyhtb2RlbCkge1xuICBjb25zdCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpPy5nZXQobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gKi9cbiAgY29uc3QgaWRlbnRpdGllcyA9IG5ldyBNYXAoKVxuXG4gIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSByZXR1cm4gaWRlbnRpdGllc1xuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBpZCA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbCwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAoaWQgIT09IG51bGwpIGlkZW50aXRpZXMuc2V0KG1vZGVsTmFtZSwgaWQpXG4gIH1cblxuICByZXR1cm4gaWRlbnRpdGllc1xufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgdGhlIHBlcnNpc3RlZCByZWNvcmQgZm9yIHNlcnZlci1zaWRlIGRlc3Ryb3kgYXV0aG9yaXphdGlvbi4gQmluYXJ5IHZhbHVlc1xuICogdXNlIGEgZGVkaWNhdGVkIGJ5dGUtYXJyYXkgbWFya2VyIGJlY2F1c2UgdGhlIHNoYXJlZCB0cmFuc3BvcnQgc2VyaWFsaXplciBvdGhlcndpc2VcbiAqIGxlYXZlcyBCdWZmZXJzIHRvIHRoZSBKU09OIGltcGxlbWVudGF0aW9uIHVzZWQgYnkgdGhlIHdvcmtlciBvciBCZWFjb24gdHJhbnNwb3J0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBGdWxseSBsb2FkZWQgcGVyc2lzdGVkIGJhY2tpbmcgcmVjb3JkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gLSBDb2x1bW4ta2V5ZWQgdHJhbnNwb3J0IHZhbHVlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKG1vZGVsKSB7XG4gIGNvbnN0IHNlcmlhbGl6YXRpb25PcHRpb25zID0gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpXG4gIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSAqL1xuICBjb25zdCBhdXRob3JpemF0aW9uUmVjb3JkID0ge31cblxuICBmb3IgKGNvbnN0IFtjb2x1bW5OYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMobW9kZWwucmF3QXR0cmlidXRlcygpKSkge1xuICAgIGF1dGhvcml6YXRpb25SZWNvcmRbY29sdW1uTmFtZV0gPSB2YWx1ZSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXlcbiAgICAgID8ge19fdmVsb2Npb3VzRGVzdHJveUF1dGhvcml6YXRpb25UeXBlOiBcImJpbmFyeVwiLCB2YWx1ZTogQXJyYXkuZnJvbSh2YWx1ZSl9XG4gICAgICA6IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh2YWx1ZSwgc2VyaWFsaXphdGlvbk9wdGlvbnMpXG4gIH1cblxuICBpZiAoT2JqZWN0LmtleXMoYXV0aG9yaXphdGlvblJlY29yZCkubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2FwdHVyZSB3ZWJzb2NrZXQgZGVzdHJveSBhdXRob3JpemF0aW9uIHdpdGhvdXQgYXR0cmlidXRlcyBmb3IgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkubmFtZX1gKVxuICB9XG5cbiAgcmV0dXJuIGF1dGhvcml6YXRpb25SZWNvcmRcbn1cblxuLyoqXG4gKiBSZWFkcyBhIHJlc291cmNlIGlkZW50aXR5IG9ubHkgd2hlbiBldmVyeSBpZGVudGl0eSBhdHRyaWJ1dGUgd2FzIGxvYWRlZCBvbiB0aGUgYmFja2luZyByZWNvcmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIElkZW50aXR5IGFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBCYWNraW5nIG1vZGVsLlxuICogQHBhcmFtIHtib29sZWFufSBbYXJncy5wcmV2aW91c10gLSBSZWFkIHZhbHVlcyBmcm9tIGJlZm9yZSBwZW5kaW5nIGNoYW5nZXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MucHJpbWFyeUtleSAtIFJlc291cmNlIGlkZW50aXR5IGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUgfCBudWxsfSAtIENvbXBsZXRlIGlkZW50aXR5IG9yIG51bGwgd2hlbiB1bmF2YWlsYWJsZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmV2aW91cyA9IGZhbHNlLCBwcmltYXJ5S2V5fSkge1xuICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG4gIGNvbnN0IGNoYW5nZXMgPSBtb2RlbC5jaGFuZ2VzKClcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXI+fSAqL1xuICBjb25zdCBpZGVudGl0eUF0dHJpYnV0ZXMgPSB7fVxuICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHByaW1hcnlLZXlBdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgY29sdW1uTmFtZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuICAgIGxldCB2YWx1ZVxuXG4gICAgaWYgKHByZXZpb3VzICYmIE9iamVjdC5oYXNPd24oY2hhbmdlcywgY29sdW1uTmFtZSkpIHtcbiAgICAgIHZhbHVlID0gY2hhbmdlc1tjb2x1bW5OYW1lXVswXVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIU9iamVjdC5oYXNPd24oYXR0cmlidXRlcywgYXR0cmlidXRlTmFtZSkpIHJldHVybiBudWxsXG5cbiAgICAgIHZhbHVlID0gYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSByZXR1cm4gbnVsbFxuXG4gICAgaWRlbnRpdHlBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgfVxuXG4gIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IGlkZW50aXR5QXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSlcbn1cblxuLyoqXG4gKiBGYW5zIG9uZSBiYWNraW5nLXJlY29yZCBsaWZlY3ljbGUgZXZlbnQgb3V0IHRocm91Z2ggZXZlcnkgY29uZmlndXJlZCBmcm9udGVuZC1yZXNvdXJjZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQmFja2luZyBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gTGlmZWN5Y2xlIGFjdGlvbi5cbiAqIEBwYXJhbSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fSBbcHJldmlvdXNJZHNdIC0gUGVyc2lzdGVkIGlkZW50aXRpZXMgY2FwdHVyZWQgYmVmb3JlIHVwZGF0ZSBvciBkZXN0cm95LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmR9IFtkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZF0gLSBTZXJ2ZXItb25seSBwcmUtZGVsZXRlIHJvdyB1c2VkIHRvIGF1dGhvcml6ZSBhIGRlc3Ryb3llZCByZWNvcmQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgYWN0aW9uLCBwcmV2aW91c0lkcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBwcmV2aW91c0lkcz8uZ2V0KG1vZGVsTmFtZSlcbiAgICBjb25zdCBjdXJyZW50SWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByaW1hcnlLZXl9KVxuICAgIGNvbnN0IGlkID0gYWN0aW9uID09PSBcImRlc3Ryb3lcIiA/IHByZXZpb3VzSWQgOiBjdXJyZW50SWQgPz8gcHJldmlvdXNJZFxuXG4gICAgaWYgKGlkID09PSBudWxsIHx8IGlkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBpZGVudGl0eUNoYW5nZWQgPSBhY3Rpb24gPT09IFwidXBkYXRlXCJcbiAgICAgICYmIGN1cnJlbnRJZCAhPT0gbnVsbFxuICAgICAgJiYgcHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkXG4gICAgICAmJiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkKSAhPT0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWQpXG5cbiAgICBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnQoY29uZmlndXJhdGlvbiwgbW9kZWxOYW1lLCB7XG4gICAgICBhY3Rpb24sXG4gICAgICBpZCxcbiAgICAgIC4uLihkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAhPT0gdW5kZWZpbmVkID8ge2Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSA6IHt9KSxcbiAgICAgIC4uLihpZGVudGl0eUNoYW5nZWQgPyB7cHJldmlvdXNJZH0gOiB7fSlcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogRmFucyBhIGxpZmVjeWNsZSBldmVudCBvdXQgdG8gYWxsIFYyIFwiZnJvbnRlbmQtbW9kZWxzXCIgc3Vic2NyaWJlcnNcbiAqIHdob3NlIGBwYXJhbXMubW9kZWxgIG1hdGNoZXMuIFJlY29yZCBhdHRyaWJ1dGVzIGdvIHRocm91Z2ggdGhlXG4gKiB0cmFuc3BvcnQgc2VyaWFsaXplciBzbyBEYXRlL3VuZGVmaW5lZC9ldGMuIHN1cnZpdmUgdGhlIEpTT04gaG9wLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3thY3Rpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkPzogRnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkLCBpZDogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHByZXZpb3VzSWQ/OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSwgcmVjb3JkPzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fX0gZXZlbnQgLSBMaWZlY3ljbGUgZXZlbnQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50KGNvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZSwgZXZlbnQpIHtcbiAgY29uc3QgYm9keSA9IHtcbiAgICBhY3Rpb246IGV2ZW50LmFjdGlvbixcbiAgICBpZDogZXZlbnQuaWQsXG4gICAgbW9kZWw6IG1vZGVsTmFtZSxcbiAgICAuLi4oZXZlbnQucHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkID8ge3ByZXZpb3VzSWQ6IGV2ZW50LnByZXZpb3VzSWR9IDoge30pLFxuICAgIC4uLihldmVudC5yZWNvcmQgPyB7cmVjb3JkOiBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoZXZlbnQucmVjb3JkLCB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikpfSA6IHt9KVxuICB9XG5cbiAgY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwge1xuICAgIC4uLihldmVudC5kZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAhPT0gdW5kZWZpbmVkID8ge2Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkOiBldmVudC5kZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gOiB7fSksXG4gICAgbW9kZWw6IG1vZGVsTmFtZVxuICB9LCBib2R5KVxufVxuIl19