// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceDefinitionIsClass } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyCacheKey, readModelPrimaryKeyValue } from "../utils/model-primary-key.js";
import { registerCounterCacheParentUpdateListener } from "../database/record/counter-cache-parent-updates.js";
/** @typedef {{primaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition}} FrontendModelPublisherResource */
/** @typedef {Record<string, import("./query.js").FrontendModelTransportValue>} FrontendModelDestroyAuthorizationRecord */
/** @typedef {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update", __frontendModelWebsocketDestroyAuthorizationRecord?: FrontendModelDestroyAuthorizationRecord, __frontendModelWebsocketPreviousIds?: Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>}} FrontendModelWebsocketRecord */
const modelClassesWithRegisteredHooks = new WeakSet();
const modelClassesWithRegisteredCounterCacheParentListeners = new WeakSet();
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
        const canonicalModelClass = modelClass.canonicalRecordMetadataModelClass();
        if (!modelClassesWithRegisteredCounterCacheParentListeners.has(canonicalModelClass)) {
            modelClassesWithRegisteredCounterCacheParentListeners.add(canonicalModelClass);
            registerCounterCacheParentUpdateListener(canonicalModelClass, (parent) => {
                broadcastFrontendModelEvents(parent, "update");
            });
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQy9GLE9BQU8sRUFBQyx3Q0FBd0MsRUFBQyxNQUFNLG9EQUFvRCxDQUFBO0FBRTNHLGdJQUFnSTtBQUNoSSwwSEFBMEg7QUFDMUgsb1dBQW9XO0FBRXBXLE1BQU0sK0JBQStCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUNyRCxNQUFNLHFEQUFxRCxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFDM0UsTUFBTSxvQ0FBb0MsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQzFELHlLQUF5SztBQUN6SyxNQUFNLGlDQUFpQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFdkQsMEVBQTBFO0FBQzFFLE1BQU0sQ0FBQyxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFBO0FBRTdEOzs7O0dBSUc7QUFDSCxTQUFTLDZDQUE2QyxDQUFDLGFBQWE7SUFDbEUsT0FBTztRQUNMLFFBQVEsRUFBRSxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDO0tBQzNFLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxpQ0FBaUMsQ0FBQyxTQUFTO0lBQ3pE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QUFlLENBQUMsQ0FBQyxDQUFDLEVBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztTQUN6QyxDQUFDLENBQUE7SUFDSixDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsU0FBUywyQkFBMkIsQ0FBQyxhQUFhLEVBQUUsU0FBUyxFQUFFLEtBQUs7SUFDbEUsTUFBTSxJQUFJLEdBQUc7UUFDWCxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU07UUFDcEIsRUFBRSxFQUFFLEtBQUssQ0FBQyxFQUFFO1FBQ1osS0FBSyxFQUFFLFNBQVM7UUFDaEIsR0FBRyxDQUFDLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN6RSxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBQyxNQUFNLEVBQUUsb0NBQW9DLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSw2Q0FBNkMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztLQUNwSixDQUFBO0lBRUQsYUFBYSxDQUFDLGtCQUFrQixDQUFDLDRCQUE0QixFQUFFO1FBQzdELEdBQUcsQ0FBQyxLQUFLLENBQUMsMEJBQTBCLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFDLDBCQUEwQixFQUFFLEtBQUssQ0FBQywwQkFBMEIsRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDekgsS0FBSyxFQUFFLFNBQVM7S0FDakIsRUFBRSxJQUFJLENBQUMsQ0FBQTtBQUNWLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3N9IGZyb20gXCIuL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXksIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGVMaXN0ZW5lcn0gZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC9jb3VudGVyLWNhY2hlLXBhcmVudC11cGRhdGVzLmpzXCJcblxuLyoqIEB0eXBlZGVmIHt7cHJpbWFyeUtleTogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn19IEZyb250ZW5kTW9kZWxQdWJsaXNoZXJSZXNvdXJjZSAqL1xuLyoqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IEZyb250ZW5kTW9kZWxEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCAmIHtfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiwgX19mcm9udGVuZE1vZGVsV2Vic29ja2V0RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQ/OiBGcm9udGVuZE1vZGVsRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQsIF9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzPzogTWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZCAqL1xuXG5jb25zdCBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzID0gbmV3IFdlYWtTZXQoKVxuY29uc3QgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRDb3VudGVyQ2FjaGVQYXJlbnRMaXN0ZW5lcnMgPSBuZXcgV2Vha1NldCgpXG5jb25zdCBjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMgPSBuZXcgV2Vha1NldCgpXG4vKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbFB1Ymxpc2hlclJlc291cmNlPj4+fSAqL1xuY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKiogU2hhcmVkIGNoYW5uZWwgbmFtZSBmb3IgYWxsIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBzdWJzY3JpcHRpb25zLiAqL1xuZXhwb3J0IGNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnN9IC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICovXG5mdW5jdGlvbiB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICByZXR1cm4ge1xuICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUgaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJyb2FkY2FzdCBjaGFubmVsIG5hbWUgKGxlZ2FjeSwgcmV0YWluZWQgZm9yIG1pZ3JhdGlvbiBjb21wYXRpYmlsaXR5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxCcm9hZGNhc3RDaGFubmVsTmFtZShtb2RlbE5hbWUpIHtcbiAgcmV0dXJuIGBmcm9udGVuZC1tb2RlbHM6JHttb2RlbE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzIGZyb20gYWJpbGl0eSByZXNvdXJjZXMgbGlzdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gYWJpbGl0eVJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKSB7XG4gIC8qKlxuICAgKiBSZXNvdXJjZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGFiaWxpdHlSZXNvdXJjZXMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlcyB0byBiZSBhbiBhcnJheSBidXQgZ290OiAke3R5cGVvZiBhYmlsaXR5UmVzb3VyY2VzfWApXG4gIH1cblxuICBpZiAoYWJpbGl0eVJlc291cmNlcy5sZW5ndGggPT09IDApIHJldHVybiByZXNvdXJjZXNcblxuICBmb3IgKGNvbnN0IHJlc291cmNlQ2xhc3Mgb2YgYWJpbGl0eVJlc291cmNlcykge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2UgdG8gYmUgYSBjbGFzcyBidXQgZ290OiAke3R5cGVvZiByZXNvdXJjZUNsYXNzfWApXG4gICAgfVxuXG4gICAgaWYgKGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlQ2xhc3MpKSB7XG4gICAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIGl0IGlzbid0IGFcbiAgICAgIC8vIHB1Ymxpc2hhYmxlIGZyb250ZW5kIG1vZGVsLiBTa2lwIGl0IGluc3RlYWQgb2YgbGV0dGluZyBgbW9kZWxDbGFzcygpYFxuICAgICAgLy8gdGhyb3cgYHJlcXVpcmVzIGEgc3RhdGljIE1vZGVsQ2xhc3NgIGR1cmluZyBhYmlsaXR5LXJlc291cmNlIGRpc2NvdmVyeS5cbiAgICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKCkubW9kZWxOYW1lIHx8IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIHJlc291cmNlc1ttb2RlbE5hbWVdID0gcmVzb3VyY2VDbGFzc1xuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlKSB7XG4gICAgICAvLyBBdXRob3JpemF0aW9uLW9ubHkgcmVzb3VyY2Ug4oCUIHZhbGlkIGJ1dCBub3QgcmVsZXZhbnQgZm9yIFdlYlNvY2tldCBwdWJsaXNoaW5nXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIGNsYXNzOiAke3Jlc291cmNlQ2xhc3MubmFtZX0uIEV4cGVjdGVkIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2Ugb3IgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXNvdXJjZXNcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQoY29uZmlndXJhdGlvbikge1xuICAvKipcbiAgICogQWxsIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gKi9cbiAgbGV0IGFsbEZyb250ZW5kTW9kZWxzID0ge31cblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICBjb25zdCBwcm9qZWN0UmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7Li4uYWxsRnJvbnRlbmRNb2RlbHMsIC4uLnByb2plY3RSZXNvdXJjZXN9XG4gIH1cblxuICAvLyBBbHdheXMgbWVyZ2UgdGhlIGFiaWxpdHkgcmVzb2x2ZXIncyByZXNvdXJjZSBsaXN0IHRvby4gQSBwcm9qZWN0IGNhbiBleHBvc2Ugc29tZVxuICAvLyByZXNvdXJjZXMgYXMgZGlzY292ZXJhYmxlIGBzcmMvcmVzb3VyY2VzLyouanNgIGZpbGVzIChjb25maWd1cmVkIG9yIGF1dG8tZGlzY292ZXJlZClcbiAgLy8gYW5kIG90aGVycyBvbmx5IHRocm91Z2ggYGdldEFiaWxpdHlSZXNvdXJjZXMoKWA7IGJvdGggc2V0cyBuZWVkIGxpZmVjeWNsZSBwdWJsaXNoZXJzLFxuICAvLyBzbyByZXNvdXJjZSBkaXNjb3ZlcnkgbXVzdCBub3Qgc3VwcHJlc3MgdGhpcyBsaXN0LlxuICBjb25zdCBhYmlsaXR5UmVzb3VyY2VzID0gY29uZmlndXJhdGlvbi5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICBhbGxGcm9udGVuZE1vZGVscyA9IHtcbiAgICAuLi5hbGxGcm9udGVuZE1vZGVscyxcbiAgICAuLi5mcm9udGVuZE1vZGVsUmVzb3VyY2VzRnJvbUFiaWxpdHlSZXNvdXJjZXNMaXN0KGFiaWxpdHlSZXNvdXJjZXMpXG4gIH1cblxuICAvLyBQaGFzZSAzOiByZWdpc3RlciB0aGUgVjIgY2hhbm5lbCBjbGFzcyBvbmNlIHBlciBjb25maWd1cmF0aW9uIHNvXG4gIC8vIGBzdWJzY3JpYmVDaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHtwYXJhbXM6IHttb2RlbH19KWAgZmluZHMgaXQuXG4gIC8vIER5bmFtaWMgaW1wb3J0IGtlZXBzIHNlcnZlci1vbmx5IFdlYnNvY2tldFJlcXVlc3QgKyBOb2RlIHV0aWxpdGllc1xuICAvLyBvdXQgb2YgYnJvd3NlciBidW5kbGVzIHRoYXQgdHJhbnNpdGl2ZWx5IHB1bGwgaW4gdGhpcyBtb2R1bGUgdmlhXG4gIC8vIGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlci5cbiAgaWYgKCFjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMuaGFzKGNvbmZpZ3VyYXRpb24pKSB7XG4gICAgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmFkZChjb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IHtkZWZhdWx0OiBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbH0gPSBhd2FpdCBpbXBvcnQoXCIuL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpXG5cbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbClcbiAgfVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VDbGFzc10gb2YgT2JqZWN0LmVudHJpZXMoYWxsRnJvbnRlbmRNb2RlbHMpKSB7XG4gICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgLy8gYEJhc2VSZXNvdXJjZWAgdGhhdCBvdGhlciByZXNvdXJjZXMgZXh0ZW5kKSBiYWNrcyBubyBtb2RlbCwgc28gdGhlcmUgaXNcbiAgICAvLyBub3RoaW5nIHRvIHB1Ymxpc2ggcmVhbHRpbWUgZXZlbnRzIGZvci4gU2tpcCBpdCBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgY29uZmlndXJlZFByaW1hcnlLZXkgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbmZpZ3VyZWRQcmltYXJ5S2V5IHx8IChBcnJheS5pc0FycmF5KG1vZGVsUHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKSB8fCBjb2x1bW5OYW1lKVxuICAgICAgOiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG1vZGVsUHJpbWFyeUtleSkgfHwgbW9kZWxQcmltYXJ5S2V5KVxuICAgIGxldCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIXB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcykge1xuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzID0gbmV3IFdlYWtNYXAoKVxuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgbGV0IHB1Ymxpc2hlclJlc291cmNlcyA9IHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5nZXQobW9kZWxDbGFzcylcblxuICAgIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXMgPSBuZXcgTWFwKClcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5zZXQobW9kZWxDbGFzcywgcHVibGlzaGVyUmVzb3VyY2VzKVxuICAgIH1cblxuICAgIHB1Ymxpc2hlclJlc291cmNlcy5zZXQobW9kZWxOYW1lLCB7XG4gICAgICBwcmltYXJ5S2V5XG4gICAgfSlcblxuICAgIGNvbnN0IGNhbm9uaWNhbE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkQ291bnRlckNhY2hlUGFyZW50TGlzdGVuZXJzLmhhcyhjYW5vbmljYWxNb2RlbENsYXNzKSkge1xuICAgICAgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRDb3VudGVyQ2FjaGVQYXJlbnRMaXN0ZW5lcnMuYWRkKGNhbm9uaWNhbE1vZGVsQ2xhc3MpXG4gICAgICByZWdpc3RlckNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZUxpc3RlbmVyKGNhbm9uaWNhbE1vZGVsQ2xhc3MsIChwYXJlbnQpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhwYXJlbnQsIFwidXBkYXRlXCIpXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8vIFJlZ2lzdGVyIGxpZmVjeWNsZSBob29rcyBvbmNlIHBlciBtb2RlbCBjbGFzcywgbm90IHBlciBjb25maWd1cmF0aW9uLiBBIG1vZGVsIGNsYXNzIGJlbG9uZ3MgdG8gYVxuICAgIC8vIHNpbmdsZSBiYWNrZW5kIHByb2plY3QvY29uZmlnIGluIHByb2R1Y3Rpb24sIHNvIHBlci1jb25maWcgcmVnaXN0cmF0aW9uIG9ubHkgZGlmZmVycyBpbiB0ZXN0cyB3aGVyZVxuICAgIC8vIHRoZSBzYW1lIG1vZGVsIGNsYXNzIGlzIHJlYWNoYWJsZSBmcm9tIG11bHRpcGxlIGNvbmZpZ3Mg4oCUIHRoZXJlIGl0IGF0dGFjaGVzIGR1cGxpY2F0ZSBiZWZvcmVDcmVhdGUvXG4gICAgLy8gYWZ0ZXJTYXZlL2FmdGVyRGVzdHJveSBob29rcyB0aGF0IGRvdWJsZS1maXJlIGJyb2FkY2FzdHMgKGFuZCBsZWFrIGFjcm9zcyBzcGVjcykuIFRoZSBob29rcyByZWFkIHRoZVxuICAgIC8vIG1vZGVsJ3MgcnVudGltZSBjb25maWd1cmF0aW9uIHdoZW4gYnJvYWRjYXN0aW5nLCBzbyBhIHNpbmdsZSByZWdpc3RyYXRpb24gaXMgc3VmZmljaWVudC5cbiAgICBpZiAobW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcy5oYXMobW9kZWxDbGFzcykpIGNvbnRpbnVlXG5cbiAgICBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzLmFkZChtb2RlbENsYXNzKVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVDcmVhdGUoKG1vZGVsKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbCkuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uID0gXCJjcmVhdGVcIlxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZVVwZGF0ZShhc3luYyAobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHdlYnNvY2tldE1vZGVsID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG5cbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwidXBkYXRlXCJcbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzID0gYXdhaXQgZnJvbnRlbmRNb2RlbFByZXZpb3VzUmVzb3VyY2VJZGVudGl0aWVzKG1vZGVsKVxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZURlc3Ryb3koYXN5bmMgKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgcGVyc2lzdGVkTW9kZWwgPSBhd2FpdCBtb2RlbFxuICAgICAgICAucXVlcnlGb3JNb2RlbChtb2RlbC5nZXRNb2RlbENsYXNzKCkpXG4gICAgICAgIC5maW5kKG1vZGVsLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSlcblxuICAgICAgaWYgKCFwZXJzaXN0ZWRNb2RlbCkgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2FwdHVyZSB3ZWJzb2NrZXQgZGVzdHJveSBhdXRob3JpemF0aW9uIGZvciBtaXNzaW5nICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YClcblxuICAgICAgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0aWVzKHBlcnNpc3RlZE1vZGVsKVxuICAgICAgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgPSBmcm9udGVuZE1vZGVsRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQocGVyc2lzdGVkTW9kZWwpXG4gICAgfSlcblxuICAgIG1vZGVsQ2xhc3MuYWZ0ZXJTYXZlKChtb2RlbCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG4gICAgICBjb25zdCBhY3Rpb24gPSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uXG5cbiAgICAgIGlmIChhY3Rpb24gIT09IFwiY3JlYXRlXCIgJiYgYWN0aW9uICE9PSBcInVwZGF0ZVwiKSByZXR1cm5cbiAgICAgIGNvbnN0IHByZXZpb3VzSWRzID0gbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzXG5cbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgYWN0aW9uLCBwcmV2aW91c0lkcylcbiAgICAgIH0pXG4gICAgICBkZWxldGUgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyRGVzdHJveSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHdlYnNvY2tldE1vZGVsID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpXG4gICAgICBjb25zdCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCA9IHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkXG4gICAgICBjb25zdCBwcmV2aW91c0lkcyA9IHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzXG5cbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgXCJkZXN0cm95XCIsIHByZXZpb3VzSWRzLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZClcbiAgICAgIH0pXG4gICAgICBkZWxldGUgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRcbiAgICAgIGRlbGV0ZSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGV2ZXJ5IHJlc291cmNlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IHRoZSByZWNvcmQgYmVmb3JlIGl0cyBwZW5kaW5nIGNoYW5nZXMgb3IgZGVzdHJ1Y3Rpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgYmVmb3JlIHVwZGF0ZSBvciBkZXN0cm95LlxuICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+Pn0gLSBQcmV2aW91cyBpZGVudGl0aWVzIGJ5IHJlc291cmNlIG5hbWUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQcmV2aW91c1Jlc291cmNlSWRlbnRpdGllcyhtb2RlbCkge1xuICBjb25zdCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpPy5nZXQobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gKi9cbiAgY29uc3QgcHJldmlvdXNJZHMgPSBuZXcgTWFwKClcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuIHByZXZpb3VzSWRzXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByZXZpb3VzOiB0cnVlLCBwcmltYXJ5S2V5fSlcblxuICAgIGlmIChwcmV2aW91c0lkICE9PSBudWxsKSBwcmV2aW91c0lkcy5zZXQobW9kZWxOYW1lLCBwcmV2aW91c0lkKVxuICB9XG5cbiAgaWYgKHByZXZpb3VzSWRzLnNpemUgPT09IHB1Ymxpc2hlclJlc291cmNlcy5zaXplKSByZXR1cm4gcHJldmlvdXNJZHNcblxuICBjb25zdCBwZXJzaXN0ZWRNb2RlbCA9IGF3YWl0IG1vZGVsXG4gICAgLnF1ZXJ5Rm9yTW9kZWwobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAgIC5maW5kKG1vZGVsLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSlcblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtwcmltYXJ5S2V5fV0gb2YgcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgaWYgKHByZXZpb3VzSWRzLmhhcyhtb2RlbE5hbWUpKSBjb250aW51ZVxuXG4gICAgY29uc3QgcGVyc2lzdGVkSWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWw6IHBlcnNpc3RlZE1vZGVsLCBwcmltYXJ5S2V5fSlcblxuICAgIGlmIChwZXJzaXN0ZWRJZCAhPT0gbnVsbCkgcHJldmlvdXNJZHMuc2V0KG1vZGVsTmFtZSwgcGVyc2lzdGVkSWQpXG4gIH1cblxuICByZXR1cm4gcHJldmlvdXNJZHNcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGV2ZXJ5IGNvbmZpZ3VyZWQgcmVzb3VyY2UgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgYSBwZXJzaXN0ZWQgYmFja2luZyByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEZ1bGx5IGxvYWRlZCBwZXJzaXN0ZWQgYmFja2luZyByZWNvcmQuXG4gKiBAcmV0dXJucyB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fSAtIElkZW50aXRpZXMgYnkgcmVzb3VyY2UgbmFtZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdGllcyhtb2RlbCkge1xuICBjb25zdCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpPy5nZXQobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gKi9cbiAgY29uc3QgaWRlbnRpdGllcyA9IG5ldyBNYXAoKVxuXG4gIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSByZXR1cm4gaWRlbnRpdGllc1xuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBpZCA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbCwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAoaWQgIT09IG51bGwpIGlkZW50aXRpZXMuc2V0KG1vZGVsTmFtZSwgaWQpXG4gIH1cblxuICByZXR1cm4gaWRlbnRpdGllc1xufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgdGhlIHBlcnNpc3RlZCByZWNvcmQgZm9yIHNlcnZlci1zaWRlIGRlc3Ryb3kgYXV0aG9yaXphdGlvbi4gQmluYXJ5IHZhbHVlc1xuICogdXNlIGEgZGVkaWNhdGVkIGJ5dGUtYXJyYXkgbWFya2VyIGJlY2F1c2UgdGhlIHNoYXJlZCB0cmFuc3BvcnQgc2VyaWFsaXplciBvdGhlcndpc2VcbiAqIGxlYXZlcyBCdWZmZXJzIHRvIHRoZSBKU09OIGltcGxlbWVudGF0aW9uIHVzZWQgYnkgdGhlIHdvcmtlciBvciBCZWFjb24gdHJhbnNwb3J0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBGdWxseSBsb2FkZWQgcGVyc2lzdGVkIGJhY2tpbmcgcmVjb3JkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gLSBDb2x1bW4ta2V5ZWQgdHJhbnNwb3J0IHZhbHVlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKG1vZGVsKSB7XG4gIGNvbnN0IHNlcmlhbGl6YXRpb25PcHRpb25zID0gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpXG4gIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSAqL1xuICBjb25zdCBhdXRob3JpemF0aW9uUmVjb3JkID0ge31cblxuICBmb3IgKGNvbnN0IFtjb2x1bW5OYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMobW9kZWwucmF3QXR0cmlidXRlcygpKSkge1xuICAgIGF1dGhvcml6YXRpb25SZWNvcmRbY29sdW1uTmFtZV0gPSB2YWx1ZSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXlcbiAgICAgID8ge19fdmVsb2Npb3VzRGVzdHJveUF1dGhvcml6YXRpb25UeXBlOiBcImJpbmFyeVwiLCB2YWx1ZTogQXJyYXkuZnJvbSh2YWx1ZSl9XG4gICAgICA6IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh2YWx1ZSwgc2VyaWFsaXphdGlvbk9wdGlvbnMpXG4gIH1cblxuICBpZiAoT2JqZWN0LmtleXMoYXV0aG9yaXphdGlvblJlY29yZCkubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2FwdHVyZSB3ZWJzb2NrZXQgZGVzdHJveSBhdXRob3JpemF0aW9uIHdpdGhvdXQgYXR0cmlidXRlcyBmb3IgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkubmFtZX1gKVxuICB9XG5cbiAgcmV0dXJuIGF1dGhvcml6YXRpb25SZWNvcmRcbn1cblxuLyoqXG4gKiBSZWFkcyBhIHJlc291cmNlIGlkZW50aXR5IG9ubHkgd2hlbiBldmVyeSBpZGVudGl0eSBhdHRyaWJ1dGUgd2FzIGxvYWRlZCBvbiB0aGUgYmFja2luZyByZWNvcmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIElkZW50aXR5IGFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBCYWNraW5nIG1vZGVsLlxuICogQHBhcmFtIHtib29sZWFufSBbYXJncy5wcmV2aW91c10gLSBSZWFkIHZhbHVlcyBmcm9tIGJlZm9yZSBwZW5kaW5nIGNoYW5nZXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MucHJpbWFyeUtleSAtIFJlc291cmNlIGlkZW50aXR5IGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUgfCBudWxsfSAtIENvbXBsZXRlIGlkZW50aXR5IG9yIG51bGwgd2hlbiB1bmF2YWlsYWJsZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmV2aW91cyA9IGZhbHNlLCBwcmltYXJ5S2V5fSkge1xuICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG4gIGNvbnN0IGNoYW5nZXMgPSBtb2RlbC5jaGFuZ2VzKClcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXI+fSAqL1xuICBjb25zdCBpZGVudGl0eUF0dHJpYnV0ZXMgPSB7fVxuICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHByaW1hcnlLZXlBdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgY29sdW1uTmFtZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuICAgIGxldCB2YWx1ZVxuXG4gICAgaWYgKHByZXZpb3VzICYmIE9iamVjdC5oYXNPd24oY2hhbmdlcywgY29sdW1uTmFtZSkpIHtcbiAgICAgIHZhbHVlID0gY2hhbmdlc1tjb2x1bW5OYW1lXVswXVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIU9iamVjdC5oYXNPd24oYXR0cmlidXRlcywgYXR0cmlidXRlTmFtZSkpIHJldHVybiBudWxsXG5cbiAgICAgIHZhbHVlID0gYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSByZXR1cm4gbnVsbFxuXG4gICAgaWRlbnRpdHlBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgfVxuXG4gIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IGlkZW50aXR5QXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSlcbn1cblxuLyoqXG4gKiBGYW5zIG9uZSBiYWNraW5nLXJlY29yZCBsaWZlY3ljbGUgZXZlbnQgb3V0IHRocm91Z2ggZXZlcnkgY29uZmlndXJlZCBmcm9udGVuZC1yZXNvdXJjZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQmFja2luZyBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gTGlmZWN5Y2xlIGFjdGlvbi5cbiAqIEBwYXJhbSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fSBbcHJldmlvdXNJZHNdIC0gUGVyc2lzdGVkIGlkZW50aXRpZXMgY2FwdHVyZWQgYmVmb3JlIHVwZGF0ZSBvciBkZXN0cm95LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmR9IFtkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZF0gLSBTZXJ2ZXItb25seSBwcmUtZGVsZXRlIHJvdyB1c2VkIHRvIGF1dGhvcml6ZSBhIGRlc3Ryb3llZCByZWNvcmQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgYWN0aW9uLCBwcmV2aW91c0lkcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBwcmV2aW91c0lkcz8uZ2V0KG1vZGVsTmFtZSlcbiAgICBjb25zdCBjdXJyZW50SWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByaW1hcnlLZXl9KVxuICAgIGNvbnN0IGlkID0gYWN0aW9uID09PSBcImRlc3Ryb3lcIiA/IHByZXZpb3VzSWQgOiBjdXJyZW50SWQgPz8gcHJldmlvdXNJZFxuXG4gICAgaWYgKGlkID09PSBudWxsIHx8IGlkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBpZGVudGl0eUNoYW5nZWQgPSBhY3Rpb24gPT09IFwidXBkYXRlXCJcbiAgICAgICYmIGN1cnJlbnRJZCAhPT0gbnVsbFxuICAgICAgJiYgcHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkXG4gICAgICAmJiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkKSAhPT0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWQpXG5cbiAgICBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnQoY29uZmlndXJhdGlvbiwgbW9kZWxOYW1lLCB7XG4gICAgICBhY3Rpb24sXG4gICAgICBpZCxcbiAgICAgIC4uLihkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAhPT0gdW5kZWZpbmVkID8ge2Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSA6IHt9KSxcbiAgICAgIC4uLihpZGVudGl0eUNoYW5nZWQgPyB7cHJldmlvdXNJZH0gOiB7fSlcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogRmFucyBhIGxpZmVjeWNsZSBldmVudCBvdXQgdG8gYWxsIFYyIFwiZnJvbnRlbmQtbW9kZWxzXCIgc3Vic2NyaWJlcnNcbiAqIHdob3NlIGBwYXJhbXMubW9kZWxgIG1hdGNoZXMuIFJlY29yZCBhdHRyaWJ1dGVzIGdvIHRocm91Z2ggdGhlXG4gKiB0cmFuc3BvcnQgc2VyaWFsaXplciBzbyBEYXRlL3VuZGVmaW5lZC9ldGMuIHN1cnZpdmUgdGhlIEpTT04gaG9wLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3thY3Rpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkPzogRnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkLCBpZDogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHByZXZpb3VzSWQ/OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSwgcmVjb3JkPzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fX0gZXZlbnQgLSBMaWZlY3ljbGUgZXZlbnQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50KGNvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZSwgZXZlbnQpIHtcbiAgY29uc3QgYm9keSA9IHtcbiAgICBhY3Rpb246IGV2ZW50LmFjdGlvbixcbiAgICBpZDogZXZlbnQuaWQsXG4gICAgbW9kZWw6IG1vZGVsTmFtZSxcbiAgICAuLi4oZXZlbnQucHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkID8ge3ByZXZpb3VzSWQ6IGV2ZW50LnByZXZpb3VzSWR9IDoge30pLFxuICAgIC4uLihldmVudC5yZWNvcmQgPyB7cmVjb3JkOiBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoZXZlbnQucmVjb3JkLCB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikpfSA6IHt9KVxuICB9XG5cbiAgY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwge1xuICAgIC4uLihldmVudC5kZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAhPT0gdW5kZWZpbmVkID8ge2Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkOiBldmVudC5kZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gOiB7fSksXG4gICAgbW9kZWw6IG1vZGVsTmFtZVxuICB9LCBib2R5KVxufVxuIl19