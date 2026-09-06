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
        const canonicalModelClass = modelClass.canonicalRecordMetadataModelClass();
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
        let publisherResources = publisherResourcesByModelClass.get(canonicalModelClass);
        if (!publisherResources) {
            publisherResources = new Map();
            publisherResourcesByModelClass.set(canonicalModelClass, publisherResources);
        }
        publisherResources.set(modelName, {
            primaryKey
        });
        if (!modelClassesWithRegisteredCounterCacheParentListeners.has(canonicalModelClass)) {
            modelClassesWithRegisteredCounterCacheParentListeners.add(canonicalModelClass);
            registerCounterCacheParentUpdateListener(canonicalModelClass, (parent, previousParent) => {
                const previousIds = previousParent ? frontendModelResourceIdentities(previousParent) : undefined;
                broadcastFrontendModelEvents(parent, "update", previousIds);
            });
        }
        // Register lifecycle hooks once per model class, not per configuration. A model class belongs to a
        // single backend project/config in production, so per-config registration only differs in tests where
        // the same model class is reachable from multiple configs — there it attaches duplicate beforeCreate/
        // afterSave/afterDestroy hooks that double-fire broadcasts (and leak across specs). The hooks read the
        // model's runtime configuration when broadcasting, so a single registration is sufficient.
        if (modelClassesWithRegisteredHooks.has(canonicalModelClass))
            continue;
        modelClassesWithRegisteredHooks.add(canonicalModelClass);
        canonicalModelClass.beforeCreate((model) => {
            /** @type {FrontendModelWebsocketRecord} */ (model).__frontendModelWebsocketAction = "create";
        });
        canonicalModelClass.beforeUpdate(async (model) => {
            const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model);
            websocketModel.__frontendModelWebsocketAction = "update";
            websocketModel.__frontendModelWebsocketPreviousIds = await frontendModelPreviousResourceIdentities(model);
        });
        canonicalModelClass.beforeDestroy(async (model) => {
            const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model);
            const persistedModel = await model
                .queryForModel(model.getModelClass())
                .find(model._persistedPrimaryKeyValue());
            if (!persistedModel)
                throw new Error(`Cannot capture websocket destroy authorization for missing ${model.getModelClass().name}`);
            websocketModel.__frontendModelWebsocketPreviousIds = frontendModelResourceIdentities(persistedModel);
            websocketModel.__frontendModelWebsocketDestroyAuthorizationRecord = frontendModelDestroyAuthorizationRecord(persistedModel);
        });
        canonicalModelClass.afterSave((model) => {
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
        canonicalModelClass.afterDestroy((model) => {
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
    const publisherResources = publisherResourcesForModel(model);
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
    const publisherResources = publisherResourcesForModel(model);
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
 * Returns publisher resources through the backing model's canonical registry owner.
 * @param {import("../database/record/index.js").default} model - Backing model instance.
 * @returns {Map<string, FrontendModelPublisherResource> | undefined} - Publisher resources for the model.
 */
function publisherResourcesForModel(model) {
    const canonicalModelClass = model.getModelClass().canonicalRecordMetadataModelClass();
    return publisherResourcesByConfiguration.get(model._getConfiguration())?.get(canonicalModelClass);
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
    const publisherResources = publisherResourcesForModel(model);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQy9GLE9BQU8sRUFBQyx3Q0FBd0MsRUFBQyxNQUFNLG9EQUFvRCxDQUFBO0FBRTNHLGdJQUFnSTtBQUNoSSwwSEFBMEg7QUFDMUgsb1dBQW9XO0FBRXBXLE1BQU0sK0JBQStCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUNyRCxNQUFNLHFEQUFxRCxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFDM0UsTUFBTSxvQ0FBb0MsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQzFELHlLQUF5SztBQUN6SyxNQUFNLGlDQUFpQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFdkQsMEVBQTBFO0FBQzFFLE1BQU0sQ0FBQyxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFBO0FBRTdEOzs7O0dBSUc7QUFDSCxTQUFTLDZDQUE2QyxDQUFDLGFBQWE7SUFDbEUsT0FBTztRQUNMLFFBQVEsRUFBRSxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDO0tBQzNFLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxpQ0FBaUMsQ0FBQyxTQUFTO0lBQ3pE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VixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuL2J1aWx0LWluLXJlc291cmNlcy5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzfSBmcm9tIFwiLi9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7c2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5LCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge3JlZ2lzdGVyQ291bnRlckNhY2hlUGFyZW50VXBkYXRlTGlzdGVuZXJ9IGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQvY291bnRlci1jYWNoZS1wYXJlbnQtdXBkYXRlcy5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7e3ByaW1hcnlLZXk6IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259fSBGcm9udGVuZE1vZGVsUHVibGlzaGVyUmVzb3VyY2UgKi9cbi8qKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBGcm9udGVuZE1vZGVsRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIsIF9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkPzogRnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkLCBfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkcz86IE1hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn19IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmQgKi9cblxuY29uc3QgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcyA9IG5ldyBXZWFrU2V0KClcbmNvbnN0IG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkQ291bnRlckNhY2hlUGFyZW50TGlzdGVuZXJzID0gbmV3IFdlYWtTZXQoKVxuY29uc3QgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zID0gbmV3IFdlYWtTZXQoKVxuLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgV2Vha01hcDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxQdWJsaXNoZXJSZXNvdXJjZT4+Pn0gKi9cbmNvbnN0IHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqIFNoYXJlZCBjaGFubmVsIG5hbWUgZm9yIGFsbCBmcm9udGVuZC1tb2RlbCBsaWZlY3ljbGUgc3Vic2NyaXB0aW9ucy4gKi9cbmV4cG9ydCBjb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEJyb2FkY2FzdENoYW5uZWxOYW1lIGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCcm9hZGNhc3QgY2hhbm5lbCBuYW1lIChsZWdhY3ksIHJldGFpbmVkIGZvciBtaWdyYXRpb24gY29tcGF0aWJpbGl0eSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUobW9kZWxOYW1lKSB7XG4gIHJldHVybiBgZnJvbnRlbmQtbW9kZWxzOiR7bW9kZWxOYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcyBmcm9tIGFiaWxpdHkgcmVzb3VyY2VzIGxpc3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IGFiaWxpdHlSZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAtIFJlc291cmNlIGRlZmluaXRpb25zIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGcm9tQWJpbGl0eVJlc291cmNlc0xpc3QoYWJpbGl0eVJlc291cmNlcykge1xuICAvKipcbiAgICogUmVzb3VyY2VzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAqL1xuICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhYmlsaXR5UmVzb3VyY2VzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZXMgdG8gYmUgYW4gYXJyYXkgYnV0IGdvdDogJHt0eXBlb2YgYWJpbGl0eVJlc291cmNlc31gKVxuICB9XG5cbiAgaWYgKGFiaWxpdHlSZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcmVzb3VyY2VzXG5cbiAgZm9yIChjb25zdCByZXNvdXJjZUNsYXNzIG9mIGFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIHRvIGJlIGEgY2xhc3MgYnV0IGdvdDogJHt0eXBlb2YgcmVzb3VyY2VDbGFzc31gKVxuICAgIH1cblxuICAgIGlmIChmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyhyZXNvdXJjZUNsYXNzKSkge1xuICAgICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgICAvLyBgQmFzZVJlc291cmNlYCB0aGF0IG90aGVyIHJlc291cmNlcyBleHRlbmQpIGJhY2tzIG5vIG1vZGVsLCBzbyBpdCBpc24ndCBhXG4gICAgICAvLyBwdWJsaXNoYWJsZSBmcm9udGVuZCBtb2RlbC4gU2tpcCBpdCBpbnN0ZWFkIG9mIGxldHRpbmcgYG1vZGVsQ2xhc3MoKWBcbiAgICAgIC8vIHRocm93IGByZXF1aXJlcyBhIHN0YXRpYyBNb2RlbENsYXNzYCBkdXJpbmcgYWJpbGl0eS1yZXNvdXJjZSBkaXNjb3ZlcnkuXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpLm1vZGVsTmFtZSB8fCByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICByZXNvdXJjZXNbbW9kZWxOYW1lXSA9IHJlc291cmNlQ2xhc3NcbiAgICB9IGVsc2UgaWYgKHJlc291cmNlQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSkge1xuICAgICAgLy8gQXV0aG9yaXphdGlvbi1vbmx5IHJlc291cmNlIOKAlCB2YWxpZCBidXQgbm90IHJlbGV2YW50IGZvciBXZWJTb2NrZXQgcHVibGlzaGluZ1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZSBjbGFzczogJHtyZXNvdXJjZUNsYXNzLm5hbWV9LiBFeHBlY3RlZCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIG9yIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MuYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzb3VyY2VzXG59XG5cbi8qKlxuICogUnVucyB0aGUgZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkKGNvbmZpZ3VyYXRpb24pIHtcbiAgLyoqXG4gICAqIEFsbCBmcm9udGVuZCBtb2RlbHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGxldCBhbGxGcm9udGVuZE1vZGVscyA9IHt9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgY29uc3QgcHJvamVjdFJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGFsbEZyb250ZW5kTW9kZWxzID0gey4uLmFsbEZyb250ZW5kTW9kZWxzLCAuLi5wcm9qZWN0UmVzb3VyY2VzfVxuICB9XG5cbiAgLy8gQWx3YXlzIG1lcmdlIHRoZSBhYmlsaXR5IHJlc29sdmVyJ3MgcmVzb3VyY2UgbGlzdCB0b28uIEEgcHJvamVjdCBjYW4gZXhwb3NlIHNvbWVcbiAgLy8gcmVzb3VyY2VzIGFzIGRpc2NvdmVyYWJsZSBgc3JjL3Jlc291cmNlcy8qLmpzYCBmaWxlcyAoY29uZmlndXJlZCBvciBhdXRvLWRpc2NvdmVyZWQpXG4gIC8vIGFuZCBvdGhlcnMgb25seSB0aHJvdWdoIGBnZXRBYmlsaXR5UmVzb3VyY2VzKClgOyBib3RoIHNldHMgbmVlZCBsaWZlY3ljbGUgcHVibGlzaGVycyxcbiAgLy8gc28gcmVzb3VyY2UgZGlzY292ZXJ5IG11c3Qgbm90IHN1cHByZXNzIHRoaXMgbGlzdC5cbiAgY29uc3QgYWJpbGl0eVJlc291cmNlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0QWJpbGl0eVJlc291cmNlcygpXG5cbiAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7XG4gICAgLi4uYWxsRnJvbnRlbmRNb2RlbHMsXG4gICAgLi4uZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKVxuICB9XG5cbiAgLy8gUGhhc2UgMzogcmVnaXN0ZXIgdGhlIFYyIGNoYW5uZWwgY2xhc3Mgb25jZSBwZXIgY29uZmlndXJhdGlvbiBzb1xuICAvLyBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWx9fSlgIGZpbmRzIGl0LlxuICAvLyBEeW5hbWljIGltcG9ydCBrZWVwcyBzZXJ2ZXItb25seSBXZWJzb2NrZXRSZXF1ZXN0ICsgTm9kZSB1dGlsaXRpZXNcbiAgLy8gb3V0IG9mIGJyb3dzZXIgYnVuZGxlcyB0aGF0IHRyYW5zaXRpdmVseSBwdWxsIGluIHRoaXMgbW9kdWxlIHZpYVxuICAvLyBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIuXG4gIGlmICghY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmhhcyhjb25maWd1cmF0aW9uKSkge1xuICAgIGNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucy5hZGQoY29uZmlndXJhdGlvbilcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWx9ID0gYXdhaXQgaW1wb3J0KFwiLi93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKVxuXG4gICAgY29uZmlndXJhdGlvbi5yZWdpc3RlcldlYnNvY2tldENoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWwpXG4gIH1cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHJlc291cmNlQ2xhc3NdIG9mIE9iamVjdC5lbnRyaWVzKGFsbEZyb250ZW5kTW9kZWxzKSkge1xuICAgIC8vIEFuIGFic3RyYWN0IGJhc2UgcmVzb3VyY2UgKG5vIHN0YXRpYyBNb2RlbENsYXNzIOKAlCBlLmcuIGFuIGFwcCdzIHNoYXJlZFxuICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIHRoZXJlIGlzXG4gICAgLy8gbm90aGluZyB0byBwdWJsaXNoIHJlYWx0aW1lIGV2ZW50cyBmb3IuIFNraXAgaXQgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGNhbm9uaWNhbE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgY29uZmlndXJlZFByaW1hcnlLZXkgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbmZpZ3VyZWRQcmltYXJ5S2V5IHx8IChBcnJheS5pc0FycmF5KG1vZGVsUHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKSB8fCBjb2x1bW5OYW1lKVxuICAgICAgOiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG1vZGVsUHJpbWFyeUtleSkgfHwgbW9kZWxQcmltYXJ5S2V5KVxuICAgIGxldCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIXB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcykge1xuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzID0gbmV3IFdlYWtNYXAoKVxuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgbGV0IHB1Ymxpc2hlclJlc291cmNlcyA9IHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5nZXQoY2Fub25pY2FsTW9kZWxDbGFzcylcblxuICAgIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXMgPSBuZXcgTWFwKClcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5zZXQoY2Fub25pY2FsTW9kZWxDbGFzcywgcHVibGlzaGVyUmVzb3VyY2VzKVxuICAgIH1cblxuICAgIHB1Ymxpc2hlclJlc291cmNlcy5zZXQobW9kZWxOYW1lLCB7XG4gICAgICBwcmltYXJ5S2V5XG4gICAgfSlcblxuICAgIGlmICghbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRDb3VudGVyQ2FjaGVQYXJlbnRMaXN0ZW5lcnMuaGFzKGNhbm9uaWNhbE1vZGVsQ2xhc3MpKSB7XG4gICAgICBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZENvdW50ZXJDYWNoZVBhcmVudExpc3RlbmVycy5hZGQoY2Fub25pY2FsTW9kZWxDbGFzcylcbiAgICAgIHJlZ2lzdGVyQ291bnRlckNhY2hlUGFyZW50VXBkYXRlTGlzdGVuZXIoY2Fub25pY2FsTW9kZWxDbGFzcywgKHBhcmVudCwgcHJldmlvdXNQYXJlbnQpID0+IHtcbiAgICAgICAgY29uc3QgcHJldmlvdXNJZHMgPSBwcmV2aW91c1BhcmVudCA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXRpZXMocHJldmlvdXNQYXJlbnQpIDogdW5kZWZpbmVkXG5cbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhwYXJlbnQsIFwidXBkYXRlXCIsIHByZXZpb3VzSWRzKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBSZWdpc3RlciBsaWZlY3ljbGUgaG9va3Mgb25jZSBwZXIgbW9kZWwgY2xhc3MsIG5vdCBwZXIgY29uZmlndXJhdGlvbi4gQSBtb2RlbCBjbGFzcyBiZWxvbmdzIHRvIGFcbiAgICAvLyBzaW5nbGUgYmFja2VuZCBwcm9qZWN0L2NvbmZpZyBpbiBwcm9kdWN0aW9uLCBzbyBwZXItY29uZmlnIHJlZ2lzdHJhdGlvbiBvbmx5IGRpZmZlcnMgaW4gdGVzdHMgd2hlcmVcbiAgICAvLyB0aGUgc2FtZSBtb2RlbCBjbGFzcyBpcyByZWFjaGFibGUgZnJvbSBtdWx0aXBsZSBjb25maWdzIOKAlCB0aGVyZSBpdCBhdHRhY2hlcyBkdXBsaWNhdGUgYmVmb3JlQ3JlYXRlL1xuICAgIC8vIGFmdGVyU2F2ZS9hZnRlckRlc3Ryb3kgaG9va3MgdGhhdCBkb3VibGUtZmlyZSBicm9hZGNhc3RzIChhbmQgbGVhayBhY3Jvc3Mgc3BlY3MpLiBUaGUgaG9va3MgcmVhZCB0aGVcbiAgICAvLyBtb2RlbCdzIHJ1bnRpbWUgY29uZmlndXJhdGlvbiB3aGVuIGJyb2FkY2FzdGluZywgc28gYSBzaW5nbGUgcmVnaXN0cmF0aW9uIGlzIHN1ZmZpY2llbnQuXG4gICAgaWYgKG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MuaGFzKGNhbm9uaWNhbE1vZGVsQ2xhc3MpKSBjb250aW51ZVxuXG4gICAgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcy5hZGQoY2Fub25pY2FsTW9kZWxDbGFzcylcblxuICAgIGNhbm9uaWNhbE1vZGVsQ2xhc3MuYmVmb3JlQ3JlYXRlKChtb2RlbCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwiY3JlYXRlXCJcbiAgICB9KVxuXG4gICAgY2Fub25pY2FsTW9kZWxDbGFzcy5iZWZvcmVVcGRhdGUoYXN5bmMgKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24gPSBcInVwZGF0ZVwiXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkcyA9IGF3YWl0IGZyb250ZW5kTW9kZWxQcmV2aW91c1Jlc291cmNlSWRlbnRpdGllcyhtb2RlbClcbiAgICB9KVxuXG4gICAgY2Fub25pY2FsTW9kZWxDbGFzcy5iZWZvcmVEZXN0cm95KGFzeW5jIChtb2RlbCkgPT4ge1xuICAgICAgY29uc3Qgd2Vic29ja2V0TW9kZWwgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbClcbiAgICAgIGNvbnN0IHBlcnNpc3RlZE1vZGVsID0gYXdhaXQgbW9kZWxcbiAgICAgICAgLnF1ZXJ5Rm9yTW9kZWwobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAgICAgICAuZmluZChtb2RlbC5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkpXG5cbiAgICAgIGlmICghcGVyc2lzdGVkTW9kZWwpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNhcHR1cmUgd2Vic29ja2V0IGRlc3Ryb3kgYXV0aG9yaXphdGlvbiBmb3IgbWlzc2luZyAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5uYW1lfWApXG5cbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdGllcyhwZXJzaXN0ZWRNb2RlbClcbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkID0gZnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKHBlcnNpc3RlZE1vZGVsKVxuICAgIH0pXG5cbiAgICBjYW5vbmljYWxNb2RlbENsYXNzLmFmdGVyU2F2ZSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbiA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgYWN0aW9uID0gbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuXG4gICAgICBpZiAoYWN0aW9uICE9PSBcImNyZWF0ZVwiICYmIGFjdGlvbiAhPT0gXCJ1cGRhdGVcIikgcmV0dXJuXG4gICAgICBjb25zdCBwcmV2aW91c0lkcyA9IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcHJldmlvdXNJZHMpXG4gICAgICB9KVxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cbiAgICAgIGRlbGV0ZSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuXG4gICAgY2Fub25pY2FsTW9kZWxDbGFzcy5hZnRlckRlc3Ryb3koKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgPSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXREZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFxuICAgICAgY29uc3QgcHJldmlvdXNJZHMgPSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIFwiZGVzdHJveVwiLCBwcmV2aW91c0lkcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG4gICAgICB9KVxuICAgICAgZGVsZXRlIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkXG4gICAgICBkZWxldGUgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBldmVyeSByZXNvdXJjZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgcmVjb3JkIGJlZm9yZSBpdHMgcGVuZGluZyBjaGFuZ2VzIG9yIGRlc3RydWN0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBCYWNraW5nIG1vZGVsIGJlZm9yZSB1cGRhdGUgb3IgZGVzdHJveS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPj59IC0gUHJldmlvdXMgaWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICovXG5hc3luYyBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJldmlvdXNSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpIHtcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzRm9yTW9kZWwobW9kZWwpXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fSAqL1xuICBjb25zdCBwcmV2aW91c0lkcyA9IG5ldyBNYXAoKVxuXG4gIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSByZXR1cm4gcHJldmlvdXNJZHNcblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtwcmltYXJ5S2V5fV0gb2YgcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgY29uc3QgcHJldmlvdXNJZCA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbCwgcHJldmlvdXM6IHRydWUsIHByaW1hcnlLZXl9KVxuXG4gICAgaWYgKHByZXZpb3VzSWQgIT09IG51bGwpIHByZXZpb3VzSWRzLnNldChtb2RlbE5hbWUsIHByZXZpb3VzSWQpXG4gIH1cblxuICBpZiAocHJldmlvdXNJZHMuc2l6ZSA9PT0gcHVibGlzaGVyUmVzb3VyY2VzLnNpemUpIHJldHVybiBwcmV2aW91c0lkc1xuXG4gIGNvbnN0IHBlcnNpc3RlZE1vZGVsID0gYXdhaXQgbW9kZWxcbiAgICAucXVlcnlGb3JNb2RlbChtb2RlbC5nZXRNb2RlbENsYXNzKCkpXG4gICAgLmZpbmQobW9kZWwuX3BlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpKVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBpZiAocHJldmlvdXNJZHMuaGFzKG1vZGVsTmFtZSkpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBwZXJzaXN0ZWRJZCA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbDogcGVyc2lzdGVkTW9kZWwsIHByaW1hcnlLZXl9KVxuXG4gICAgaWYgKHBlcnNpc3RlZElkICE9PSBudWxsKSBwcmV2aW91c0lkcy5zZXQobW9kZWxOYW1lLCBwZXJzaXN0ZWRJZClcbiAgfVxuXG4gIHJldHVybiBwcmV2aW91c0lkc1xufVxuXG4vKipcbiAqIFJldHVybnMgZXZlcnkgY29uZmlndXJlZCByZXNvdXJjZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSBhIHBlcnNpc3RlZCBiYWNraW5nIHJlY29yZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRnVsbHkgbG9hZGVkIHBlcnNpc3RlZCBiYWNraW5nIHJlY29yZC5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59IC0gSWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0aWVzKG1vZGVsKSB7XG4gIGNvbnN0IHB1Ymxpc2hlclJlc291cmNlcyA9IHB1Ymxpc2hlclJlc291cmNlc0Zvck1vZGVsKG1vZGVsKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gKi9cbiAgY29uc3QgaWRlbnRpdGllcyA9IG5ldyBNYXAoKVxuXG4gIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSByZXR1cm4gaWRlbnRpdGllc1xuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBpZCA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbCwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAoaWQgIT09IG51bGwpIGlkZW50aXRpZXMuc2V0KG1vZGVsTmFtZSwgaWQpXG4gIH1cblxuICByZXR1cm4gaWRlbnRpdGllc1xufVxuXG4vKipcbiAqIFJldHVybnMgcHVibGlzaGVyIHJlc291cmNlcyB0aHJvdWdoIHRoZSBiYWNraW5nIG1vZGVsJ3MgY2Fub25pY2FsIHJlZ2lzdHJ5IG93bmVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBCYWNraW5nIG1vZGVsIGluc3RhbmNlLlxuICogQHJldHVybnMge01hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxQdWJsaXNoZXJSZXNvdXJjZT4gfCB1bmRlZmluZWR9IC0gUHVibGlzaGVyIHJlc291cmNlcyBmb3IgdGhlIG1vZGVsLlxuICovXG5mdW5jdGlvbiBwdWJsaXNoZXJSZXNvdXJjZXNGb3JNb2RlbChtb2RlbCkge1xuICBjb25zdCBjYW5vbmljYWxNb2RlbENsYXNzID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpXG5cbiAgcmV0dXJuIHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbi5nZXQobW9kZWwuX2dldENvbmZpZ3VyYXRpb24oKSk/LmdldChjYW5vbmljYWxNb2RlbENsYXNzKVxufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgdGhlIHBlcnNpc3RlZCByZWNvcmQgZm9yIHNlcnZlci1zaWRlIGRlc3Ryb3kgYXV0aG9yaXphdGlvbi4gQmluYXJ5IHZhbHVlc1xuICogdXNlIGEgZGVkaWNhdGVkIGJ5dGUtYXJyYXkgbWFya2VyIGJlY2F1c2UgdGhlIHNoYXJlZCB0cmFuc3BvcnQgc2VyaWFsaXplciBvdGhlcndpc2VcbiAqIGxlYXZlcyBCdWZmZXJzIHRvIHRoZSBKU09OIGltcGxlbWVudGF0aW9uIHVzZWQgYnkgdGhlIHdvcmtlciBvciBCZWFjb24gdHJhbnNwb3J0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBGdWxseSBsb2FkZWQgcGVyc2lzdGVkIGJhY2tpbmcgcmVjb3JkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gLSBDb2x1bW4ta2V5ZWQgdHJhbnNwb3J0IHZhbHVlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKG1vZGVsKSB7XG4gIGNvbnN0IHNlcmlhbGl6YXRpb25PcHRpb25zID0gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCkpXG4gIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSAqL1xuICBjb25zdCBhdXRob3JpemF0aW9uUmVjb3JkID0ge31cblxuICBmb3IgKGNvbnN0IFtjb2x1bW5OYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMobW9kZWwucmF3QXR0cmlidXRlcygpKSkge1xuICAgIGF1dGhvcml6YXRpb25SZWNvcmRbY29sdW1uTmFtZV0gPSB2YWx1ZSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXlcbiAgICAgID8ge19fdmVsb2Npb3VzRGVzdHJveUF1dGhvcml6YXRpb25UeXBlOiBcImJpbmFyeVwiLCB2YWx1ZTogQXJyYXkuZnJvbSh2YWx1ZSl9XG4gICAgICA6IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh2YWx1ZSwgc2VyaWFsaXphdGlvbk9wdGlvbnMpXG4gIH1cblxuICBpZiAoT2JqZWN0LmtleXMoYXV0aG9yaXphdGlvblJlY29yZCkubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2FwdHVyZSB3ZWJzb2NrZXQgZGVzdHJveSBhdXRob3JpemF0aW9uIHdpdGhvdXQgYXR0cmlidXRlcyBmb3IgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkubmFtZX1gKVxuICB9XG5cbiAgcmV0dXJuIGF1dGhvcml6YXRpb25SZWNvcmRcbn1cblxuLyoqXG4gKiBSZWFkcyBhIHJlc291cmNlIGlkZW50aXR5IG9ubHkgd2hlbiBldmVyeSBpZGVudGl0eSBhdHRyaWJ1dGUgd2FzIGxvYWRlZCBvbiB0aGUgYmFja2luZyByZWNvcmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIElkZW50aXR5IGFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBCYWNraW5nIG1vZGVsLlxuICogQHBhcmFtIHtib29sZWFufSBbYXJncy5wcmV2aW91c10gLSBSZWFkIHZhbHVlcyBmcm9tIGJlZm9yZSBwZW5kaW5nIGNoYW5nZXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MucHJpbWFyeUtleSAtIFJlc291cmNlIGlkZW50aXR5IGRlZmluaXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUgfCBudWxsfSAtIENvbXBsZXRlIGlkZW50aXR5IG9yIG51bGwgd2hlbiB1bmF2YWlsYWJsZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmV2aW91cyA9IGZhbHNlLCBwcmltYXJ5S2V5fSkge1xuICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG4gIGNvbnN0IGNoYW5nZXMgPSBtb2RlbC5jaGFuZ2VzKClcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXI+fSAqL1xuICBjb25zdCBpZGVudGl0eUF0dHJpYnV0ZXMgPSB7fVxuICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW3ByaW1hcnlLZXldXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHByaW1hcnlLZXlBdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgY29sdW1uTmFtZSA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuICAgIGxldCB2YWx1ZVxuXG4gICAgaWYgKHByZXZpb3VzICYmIE9iamVjdC5oYXNPd24oY2hhbmdlcywgY29sdW1uTmFtZSkpIHtcbiAgICAgIHZhbHVlID0gY2hhbmdlc1tjb2x1bW5OYW1lXVswXVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIU9iamVjdC5oYXNPd24oYXR0cmlidXRlcywgYXR0cmlidXRlTmFtZSkpIHJldHVybiBudWxsXG5cbiAgICAgIHZhbHVlID0gYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSByZXR1cm4gbnVsbFxuXG4gICAgaWRlbnRpdHlBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgfVxuXG4gIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IGlkZW50aXR5QXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSlcbn1cblxuLyoqXG4gKiBGYW5zIG9uZSBiYWNraW5nLXJlY29yZCBsaWZlY3ljbGUgZXZlbnQgb3V0IHRocm91Z2ggZXZlcnkgY29uZmlndXJlZCBmcm9udGVuZC1yZXNvdXJjZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQmFja2luZyBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gTGlmZWN5Y2xlIGFjdGlvbi5cbiAqIEBwYXJhbSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fSBbcHJldmlvdXNJZHNdIC0gUGVyc2lzdGVkIGlkZW50aXRpZXMgY2FwdHVyZWQgYmVmb3JlIHVwZGF0ZSBvciBkZXN0cm95LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmR9IFtkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZF0gLSBTZXJ2ZXItb25seSBwcmUtZGVsZXRlIHJvdyB1c2VkIHRvIGF1dGhvcml6ZSBhIGRlc3Ryb3llZCByZWNvcmQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50cyhtb2RlbCwgYWN0aW9uLCBwcmV2aW91c0lkcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzRm9yTW9kZWwobW9kZWwpXG5cbiAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXMpIHJldHVyblxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBwcmV2aW91c0lkID0gcHJldmlvdXNJZHM/LmdldChtb2RlbE5hbWUpXG4gICAgY29uc3QgY3VycmVudElkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmltYXJ5S2V5fSlcbiAgICBjb25zdCBpZCA9IGFjdGlvbiA9PT0gXCJkZXN0cm95XCIgPyBwcmV2aW91c0lkIDogY3VycmVudElkID8/IHByZXZpb3VzSWRcblxuICAgIGlmIChpZCA9PT0gbnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuXG4gICAgY29uc3QgaWRlbnRpdHlDaGFuZ2VkID0gYWN0aW9uID09PSBcInVwZGF0ZVwiXG4gICAgICAmJiBjdXJyZW50SWQgIT09IG51bGxcbiAgICAgICYmIHByZXZpb3VzSWQgIT09IHVuZGVmaW5lZFxuICAgICAgJiYgbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZCkgIT09IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIGlkKVxuXG4gICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50KGNvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZSwge1xuICAgICAgYWN0aW9uLFxuICAgICAgaWQsXG4gICAgICAuLi4oZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgIT09IHVuZGVmaW5lZCA/IHtkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gOiB7fSksXG4gICAgICAuLi4oaWRlbnRpdHlDaGFuZ2VkID8ge3ByZXZpb3VzSWR9IDoge30pXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIEZhbnMgYSBsaWZlY3ljbGUgZXZlbnQgb3V0IHRvIGFsbCBWMiBcImZyb250ZW5kLW1vZGVsc1wiIHN1YnNjcmliZXJzXG4gKiB3aG9zZSBgcGFyYW1zLm1vZGVsYCBtYXRjaGVzLiBSZWNvcmQgYXR0cmlidXRlcyBnbyB0aHJvdWdoIHRoZVxuICogdHJhbnNwb3J0IHNlcmlhbGl6ZXIgc28gRGF0ZS91bmRlZmluZWQvZXRjLiBzdXJ2aXZlIHRoZSBKU09OIGhvcC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHt7YWN0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZD86IEZyb250ZW5kTW9kZWxEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCwgaWQ6IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCBwcmV2aW91c0lkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHJlY29yZD86IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn19IGV2ZW50IC0gTGlmZWN5Y2xlIGV2ZW50LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChjb25maWd1cmF0aW9uLCBtb2RlbE5hbWUsIGV2ZW50KSB7XG4gIGNvbnN0IGJvZHkgPSB7XG4gICAgYWN0aW9uOiBldmVudC5hY3Rpb24sXG4gICAgaWQ6IGV2ZW50LmlkLFxuICAgIG1vZGVsOiBtb2RlbE5hbWUsXG4gICAgLi4uKGV2ZW50LnByZXZpb3VzSWQgIT09IHVuZGVmaW5lZCA/IHtwcmV2aW91c0lkOiBldmVudC5wcmV2aW91c0lkfSA6IHt9KSxcbiAgICAuLi4oZXZlbnQucmVjb3JkID8ge3JlY29yZDogc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGV2ZW50LnJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKX0gOiB7fSlcbiAgfVxuXG4gIGNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHtcbiAgICAuLi4oZXZlbnQuZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgIT09IHVuZGVmaW5lZCA/IHtkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZDogZXZlbnQuZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmR9IDoge30pLFxuICAgIG1vZGVsOiBtb2RlbE5hbWVcbiAgfSwgYm9keSlcbn1cbiJdfQ==