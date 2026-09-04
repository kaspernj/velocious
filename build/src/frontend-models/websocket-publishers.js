// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceDefinitionIsClass } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyCacheKey, readModelPrimaryKeyValue } from "../utils/model-primary-key.js";
/** @typedef {{primaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition}} FrontendModelPublisherResource */
/** @typedef {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update", __frontendModelWebsocketDestroyAuthorizationRecord?: Record<string, ReturnType<typeof JSON.parse>>, __frontendModelWebsocketPreviousIds?: Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>}} FrontendModelWebsocketRecord */
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
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Column-keyed transport values.
 */
function frontendModelDestroyAuthorizationRecord(model) {
    const serializationOptions = transportSerializationOptionsForConfiguration(model._getConfiguration());
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
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
 * @param {Record<string, ReturnType<typeof JSON.parse>>} [destroyAuthorizationRecord] - Server-only pre-delete row used to authorize a destroyed record.
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
 * @param {{action: "create" | "update" | "destroy", destroyAuthorizationRecord?: Record<string, ReturnType<typeof JSON.parse>>, id: ReturnType<typeof JSON.parse>, previousId?: ReturnType<typeof JSON.parse>, record?: Record<string, ReturnType<typeof JSON.parse>>}} event - Lifecycle event.
 * @returns {void}
 */
function broadcastFrontendModelEvent(configuration, modelName, event) {
    const body = {
        action: event.action,
        ...(event.destroyAuthorizationRecord !== undefined ? { destroyAuthorizationRecord: event.destroyAuthorizationRecord } : {}),
        id: event.id,
        model: modelName,
        ...(event.previousId !== undefined ? { previousId: event.previousId } : {}),
        ...(event.record ? { record: serializeFrontendModelTransportValue(event.record, transportSerializationOptionsForConfiguration(configuration)) } : {})
    };
    configuration.broadcastToChannel(FRONTEND_MODELS_CHANNEL_NAME, { model: modelName }, body);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRS9GLGdJQUFnSTtBQUNoSSwwV0FBMFc7QUFFMVcsTUFBTSwrQkFBK0IsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQ3JELE1BQU0sb0NBQW9DLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUMxRCx5S0FBeUs7QUFDekssTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRXZELDBFQUEwRTtBQUMxRSxNQUFNLENBQUMsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsU0FBUyw2Q0FBNkMsQ0FBQyxhQUFhO0lBQ2xFLE9BQU87UUFDTCxRQUFRLEVBQUUsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQztLQUMzRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsaUNBQWlDLENBQUMsU0FBUztJQUN6RCxPQUFPLG1CQUFtQixTQUFTLEVBQUUsQ0FBQTtBQUN2QyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsOENBQThDLENBQUMsZ0JBQWdCO0lBQ3RFOztvR0FFZ0c7SUFDaEcs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QVM7UUFDaEIsR0FBRyxDQUFDLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN6RSxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBQyxNQUFNLEVBQUUsb0NBQW9DLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSw2Q0FBNkMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztLQUNwSixDQUFBO0lBRUQsYUFBYSxDQUFDLGtCQUFrQixDQUFDLDRCQUE0QixFQUFFLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQyxFQUFFLElBQUksQ0FBQyxDQUFBO0FBQzFGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3N9IGZyb20gXCIuL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXksIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqIEB0eXBlZGVmIHt7cHJpbWFyeUtleTogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn19IEZyb250ZW5kTW9kZWxQdWJsaXNoZXJSZXNvdXJjZSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCAmIHtfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiwgX19mcm9udGVuZE1vZGVsV2Vic29ja2V0RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIF9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzPzogTWFwPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWU+fX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZCAqL1xuXG5jb25zdCBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzID0gbmV3IFdlYWtTZXQoKVxuY29uc3QgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zID0gbmV3IFdlYWtTZXQoKVxuLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgV2Vha01hcDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxQdWJsaXNoZXJSZXNvdXJjZT4+Pn0gKi9cbmNvbnN0IHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqIFNoYXJlZCBjaGFubmVsIG5hbWUgZm9yIGFsbCBmcm9udGVuZC1tb2RlbCBsaWZlY3ljbGUgc3Vic2NyaXB0aW9ucy4gKi9cbmV4cG9ydCBjb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEJyb2FkY2FzdENoYW5uZWxOYW1lIGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCcm9hZGNhc3QgY2hhbm5lbCBuYW1lIChsZWdhY3ksIHJldGFpbmVkIGZvciBtaWdyYXRpb24gY29tcGF0aWJpbGl0eSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUobW9kZWxOYW1lKSB7XG4gIHJldHVybiBgZnJvbnRlbmQtbW9kZWxzOiR7bW9kZWxOYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcyBmcm9tIGFiaWxpdHkgcmVzb3VyY2VzIGxpc3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IGFiaWxpdHlSZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAtIFJlc291cmNlIGRlZmluaXRpb25zIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGcm9tQWJpbGl0eVJlc291cmNlc0xpc3QoYWJpbGl0eVJlc291cmNlcykge1xuICAvKipcbiAgICogUmVzb3VyY2VzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAqL1xuICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhYmlsaXR5UmVzb3VyY2VzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZXMgdG8gYmUgYW4gYXJyYXkgYnV0IGdvdDogJHt0eXBlb2YgYWJpbGl0eVJlc291cmNlc31gKVxuICB9XG5cbiAgaWYgKGFiaWxpdHlSZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcmVzb3VyY2VzXG5cbiAgZm9yIChjb25zdCByZXNvdXJjZUNsYXNzIG9mIGFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIHRvIGJlIGEgY2xhc3MgYnV0IGdvdDogJHt0eXBlb2YgcmVzb3VyY2VDbGFzc31gKVxuICAgIH1cblxuICAgIGlmIChmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyhyZXNvdXJjZUNsYXNzKSkge1xuICAgICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgICAvLyBgQmFzZVJlc291cmNlYCB0aGF0IG90aGVyIHJlc291cmNlcyBleHRlbmQpIGJhY2tzIG5vIG1vZGVsLCBzbyBpdCBpc24ndCBhXG4gICAgICAvLyBwdWJsaXNoYWJsZSBmcm9udGVuZCBtb2RlbC4gU2tpcCBpdCBpbnN0ZWFkIG9mIGxldHRpbmcgYG1vZGVsQ2xhc3MoKWBcbiAgICAgIC8vIHRocm93IGByZXF1aXJlcyBhIHN0YXRpYyBNb2RlbENsYXNzYCBkdXJpbmcgYWJpbGl0eS1yZXNvdXJjZSBkaXNjb3ZlcnkuXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpLm1vZGVsTmFtZSB8fCByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICByZXNvdXJjZXNbbW9kZWxOYW1lXSA9IHJlc291cmNlQ2xhc3NcbiAgICB9IGVsc2UgaWYgKHJlc291cmNlQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSkge1xuICAgICAgLy8gQXV0aG9yaXphdGlvbi1vbmx5IHJlc291cmNlIOKAlCB2YWxpZCBidXQgbm90IHJlbGV2YW50IGZvciBXZWJTb2NrZXQgcHVibGlzaGluZ1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZSBjbGFzczogJHtyZXNvdXJjZUNsYXNzLm5hbWV9LiBFeHBlY3RlZCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIG9yIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MuYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzb3VyY2VzXG59XG5cbi8qKlxuICogUnVucyB0aGUgZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkKGNvbmZpZ3VyYXRpb24pIHtcbiAgLyoqXG4gICAqIEFsbCBmcm9udGVuZCBtb2RlbHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGxldCBhbGxGcm9udGVuZE1vZGVscyA9IHt9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgY29uc3QgcHJvamVjdFJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGFsbEZyb250ZW5kTW9kZWxzID0gey4uLmFsbEZyb250ZW5kTW9kZWxzLCAuLi5wcm9qZWN0UmVzb3VyY2VzfVxuICB9XG5cbiAgLy8gQWx3YXlzIG1lcmdlIHRoZSBhYmlsaXR5IHJlc29sdmVyJ3MgcmVzb3VyY2UgbGlzdCB0b28uIEEgcHJvamVjdCBjYW4gZXhwb3NlIHNvbWVcbiAgLy8gcmVzb3VyY2VzIGFzIGRpc2NvdmVyYWJsZSBgc3JjL3Jlc291cmNlcy8qLmpzYCBmaWxlcyAoY29uZmlndXJlZCBvciBhdXRvLWRpc2NvdmVyZWQpXG4gIC8vIGFuZCBvdGhlcnMgb25seSB0aHJvdWdoIGBnZXRBYmlsaXR5UmVzb3VyY2VzKClgOyBib3RoIHNldHMgbmVlZCBsaWZlY3ljbGUgcHVibGlzaGVycyxcbiAgLy8gc28gcmVzb3VyY2UgZGlzY292ZXJ5IG11c3Qgbm90IHN1cHByZXNzIHRoaXMgbGlzdC5cbiAgY29uc3QgYWJpbGl0eVJlc291cmNlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0QWJpbGl0eVJlc291cmNlcygpXG5cbiAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7XG4gICAgLi4uYWxsRnJvbnRlbmRNb2RlbHMsXG4gICAgLi4uZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKVxuICB9XG5cbiAgLy8gUGhhc2UgMzogcmVnaXN0ZXIgdGhlIFYyIGNoYW5uZWwgY2xhc3Mgb25jZSBwZXIgY29uZmlndXJhdGlvbiBzb1xuICAvLyBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWx9fSlgIGZpbmRzIGl0LlxuICAvLyBEeW5hbWljIGltcG9ydCBrZWVwcyBzZXJ2ZXItb25seSBXZWJzb2NrZXRSZXF1ZXN0ICsgTm9kZSB1dGlsaXRpZXNcbiAgLy8gb3V0IG9mIGJyb3dzZXIgYnVuZGxlcyB0aGF0IHRyYW5zaXRpdmVseSBwdWxsIGluIHRoaXMgbW9kdWxlIHZpYVxuICAvLyBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIuXG4gIGlmICghY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmhhcyhjb25maWd1cmF0aW9uKSkge1xuICAgIGNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucy5hZGQoY29uZmlndXJhdGlvbilcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWx9ID0gYXdhaXQgaW1wb3J0KFwiLi93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKVxuXG4gICAgY29uZmlndXJhdGlvbi5yZWdpc3RlcldlYnNvY2tldENoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWwpXG4gIH1cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHJlc291cmNlQ2xhc3NdIG9mIE9iamVjdC5lbnRyaWVzKGFsbEZyb250ZW5kTW9kZWxzKSkge1xuICAgIC8vIEFuIGFic3RyYWN0IGJhc2UgcmVzb3VyY2UgKG5vIHN0YXRpYyBNb2RlbENsYXNzIOKAlCBlLmcuIGFuIGFwcCdzIHNoYXJlZFxuICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIHRoZXJlIGlzXG4gICAgLy8gbm90aGluZyB0byBwdWJsaXNoIHJlYWx0aW1lIGV2ZW50cyBmb3IuIFNraXAgaXQgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IHJlc291cmNlQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRQcmltYXJ5S2V5ID0gcmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXlcbiAgICBjb25zdCBtb2RlbFByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb25maWd1cmVkUHJpbWFyeUtleSB8fCAoQXJyYXkuaXNBcnJheShtb2RlbFByaW1hcnlLZXkpXG4gICAgICA/IG1vZGVsUHJpbWFyeUtleS5tYXAoKGNvbHVtbk5hbWUpID0+IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoY29sdW1uTmFtZSkgfHwgY29sdW1uTmFtZSlcbiAgICAgIDogbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShtb2RlbFByaW1hcnlLZXkpIHx8IG1vZGVsUHJpbWFyeUtleSlcbiAgICBsZXQgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MpIHtcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcyA9IG5ldyBXZWFrTWFwKClcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzKVxuICAgIH1cblxuICAgIGxldCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MuZ2V0KG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykge1xuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzID0gbmV3IE1hcCgpXG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3Muc2V0KG1vZGVsQ2xhc3MsIHB1Ymxpc2hlclJlc291cmNlcylcbiAgICB9XG5cbiAgICBwdWJsaXNoZXJSZXNvdXJjZXMuc2V0KG1vZGVsTmFtZSwge1xuICAgICAgcHJpbWFyeUtleVxuICAgIH0pXG5cbiAgICAvLyBSZWdpc3RlciBsaWZlY3ljbGUgaG9va3Mgb25jZSBwZXIgbW9kZWwgY2xhc3MsIG5vdCBwZXIgY29uZmlndXJhdGlvbi4gQSBtb2RlbCBjbGFzcyBiZWxvbmdzIHRvIGFcbiAgICAvLyBzaW5nbGUgYmFja2VuZCBwcm9qZWN0L2NvbmZpZyBpbiBwcm9kdWN0aW9uLCBzbyBwZXItY29uZmlnIHJlZ2lzdHJhdGlvbiBvbmx5IGRpZmZlcnMgaW4gdGVzdHMgd2hlcmVcbiAgICAvLyB0aGUgc2FtZSBtb2RlbCBjbGFzcyBpcyByZWFjaGFibGUgZnJvbSBtdWx0aXBsZSBjb25maWdzIOKAlCB0aGVyZSBpdCBhdHRhY2hlcyBkdXBsaWNhdGUgYmVmb3JlQ3JlYXRlL1xuICAgIC8vIGFmdGVyU2F2ZS9hZnRlckRlc3Ryb3kgaG9va3MgdGhhdCBkb3VibGUtZmlyZSBicm9hZGNhc3RzIChhbmQgbGVhayBhY3Jvc3Mgc3BlY3MpLiBUaGUgaG9va3MgcmVhZCB0aGVcbiAgICAvLyBtb2RlbCdzIHJ1bnRpbWUgY29uZmlndXJhdGlvbiB3aGVuIGJyb2FkY2FzdGluZywgc28gYSBzaW5nbGUgcmVnaXN0cmF0aW9uIGlzIHN1ZmZpY2llbnQuXG4gICAgaWYgKG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MuaGFzKG1vZGVsQ2xhc3MpKSBjb250aW51ZVxuXG4gICAgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcy5hZGQobW9kZWxDbGFzcylcblxuICAgIG1vZGVsQ2xhc3MuYmVmb3JlQ3JlYXRlKChtb2RlbCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwiY3JlYXRlXCJcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVVcGRhdGUoYXN5bmMgKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24gPSBcInVwZGF0ZVwiXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkcyA9IGF3YWl0IGZyb250ZW5kTW9kZWxQcmV2aW91c1Jlc291cmNlSWRlbnRpdGllcyhtb2RlbClcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVEZXN0cm95KGFzeW5jIChtb2RlbCkgPT4ge1xuICAgICAgY29uc3Qgd2Vic29ja2V0TW9kZWwgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbClcbiAgICAgIGNvbnN0IHBlcnNpc3RlZE1vZGVsID0gYXdhaXQgbW9kZWxcbiAgICAgICAgLnF1ZXJ5Rm9yTW9kZWwobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuICAgICAgICAuZmluZChtb2RlbC5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkpXG5cbiAgICAgIGlmICghcGVyc2lzdGVkTW9kZWwpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNhcHR1cmUgd2Vic29ja2V0IGRlc3Ryb3kgYXV0aG9yaXphdGlvbiBmb3IgbWlzc2luZyAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5uYW1lfWApXG5cbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldFByZXZpb3VzSWRzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdGllcyhwZXJzaXN0ZWRNb2RlbClcbiAgICAgIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkID0gZnJvbnRlbmRNb2RlbERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKHBlcnNpc3RlZE1vZGVsKVxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyU2F2ZSgobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbiA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgYWN0aW9uID0gbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuXG4gICAgICBpZiAoYWN0aW9uICE9PSBcImNyZWF0ZVwiICYmIGFjdGlvbiAhPT0gXCJ1cGRhdGVcIikgcmV0dXJuXG4gICAgICBjb25zdCBwcmV2aW91c0lkcyA9IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcHJldmlvdXNJZHMpXG4gICAgICB9KVxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cbiAgICAgIGRlbGV0ZSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5hZnRlckRlc3Ryb3koKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuICAgICAgY29uc3QgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgPSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXREZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFxuICAgICAgY29uc3QgcHJldmlvdXNJZHMgPSB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkc1xuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIFwiZGVzdHJveVwiLCBwcmV2aW91c0lkcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG4gICAgICB9KVxuICAgICAgZGVsZXRlIHdlYnNvY2tldE1vZGVsLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldERlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkXG4gICAgICBkZWxldGUgd2Vic29ja2V0TW9kZWwuX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBldmVyeSByZXNvdXJjZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgcmVjb3JkIGJlZm9yZSBpdHMgcGVuZGluZyBjaGFuZ2VzIG9yIGRlc3RydWN0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBCYWNraW5nIG1vZGVsIGJlZm9yZSB1cGRhdGUgb3IgZGVzdHJveS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPj59IC0gUHJldmlvdXMgaWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICovXG5hc3luYyBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJldmlvdXNSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpIHtcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59ICovXG4gIGNvbnN0IHByZXZpb3VzSWRzID0gbmV3IE1hcCgpXG5cbiAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXMpIHJldHVybiBwcmV2aW91c0lkc1xuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBwcmV2aW91c0lkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmV2aW91czogdHJ1ZSwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAocHJldmlvdXNJZCAhPT0gbnVsbCkgcHJldmlvdXNJZHMuc2V0KG1vZGVsTmFtZSwgcHJldmlvdXNJZClcbiAgfVxuXG4gIGlmIChwcmV2aW91c0lkcy5zaXplID09PSBwdWJsaXNoZXJSZXNvdXJjZXMuc2l6ZSkgcmV0dXJuIHByZXZpb3VzSWRzXG5cbiAgY29uc3QgcGVyc2lzdGVkTW9kZWwgPSBhd2FpdCBtb2RlbFxuICAgIC5xdWVyeUZvck1vZGVsKG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcbiAgICAuZmluZChtb2RlbC5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkpXG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCB7cHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGlmIChwcmV2aW91c0lkcy5oYXMobW9kZWxOYW1lKSkgY29udGludWVcblxuICAgIGNvbnN0IHBlcnNpc3RlZElkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsOiBwZXJzaXN0ZWRNb2RlbCwgcHJpbWFyeUtleX0pXG5cbiAgICBpZiAocGVyc2lzdGVkSWQgIT09IG51bGwpIHByZXZpb3VzSWRzLnNldChtb2RlbE5hbWUsIHBlcnNpc3RlZElkKVxuICB9XG5cbiAgcmV0dXJuIHByZXZpb3VzSWRzXG59XG5cbi8qKlxuICogUmV0dXJucyBldmVyeSBjb25maWd1cmVkIHJlc291cmNlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IGEgcGVyc2lzdGVkIGJhY2tpbmcgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBGdWxseSBsb2FkZWQgcGVyc2lzdGVkIGJhY2tpbmcgcmVjb3JkLlxuICogQHJldHVybnMge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gLSBJZGVudGl0aWVzIGJ5IHJlc291cmNlIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpIHtcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59ICovXG4gIGNvbnN0IGlkZW50aXRpZXMgPSBuZXcgTWFwKClcblxuICBpZiAoIXB1Ymxpc2hlclJlc291cmNlcykgcmV0dXJuIGlkZW50aXRpZXNcblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtwcmltYXJ5S2V5fV0gb2YgcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgY29uc3QgaWQgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJZGVudGl0eSh7bW9kZWwsIHByaW1hcnlLZXl9KVxuXG4gICAgaWYgKGlkICE9PSBudWxsKSBpZGVudGl0aWVzLnNldChtb2RlbE5hbWUsIGlkKVxuICB9XG5cbiAgcmV0dXJuIGlkZW50aXRpZXNcbn1cblxuLyoqXG4gKiBTZXJpYWxpemVzIHRoZSBwZXJzaXN0ZWQgcmVjb3JkIGZvciBzZXJ2ZXItc2lkZSBkZXN0cm95IGF1dGhvcml6YXRpb24uIEJpbmFyeSB2YWx1ZXNcbiAqIHVzZSBhIGRlZGljYXRlZCBieXRlLWFycmF5IG1hcmtlciBiZWNhdXNlIHRoZSBzaGFyZWQgdHJhbnNwb3J0IHNlcmlhbGl6ZXIgb3RoZXJ3aXNlXG4gKiBsZWF2ZXMgQnVmZmVycyB0byB0aGUgSlNPTiBpbXBsZW1lbnRhdGlvbiB1c2VkIGJ5IHRoZSB3b3JrZXIgb3IgQmVhY29uIHRyYW5zcG9ydC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRnVsbHkgbG9hZGVkIHBlcnNpc3RlZCBiYWNraW5nIHJlY29yZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29sdW1uLWtleWVkIHRyYW5zcG9ydCB2YWx1ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZChtb2RlbCkge1xuICBjb25zdCBzZXJpYWxpemF0aW9uT3B0aW9ucyA9IHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpKVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgYXV0aG9yaXphdGlvblJlY29yZCA9IHt9XG5cbiAgZm9yIChjb25zdCBbY29sdW1uTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKG1vZGVsLnJhd0F0dHJpYnV0ZXMoKSkpIHtcbiAgICBhdXRob3JpemF0aW9uUmVjb3JkW2NvbHVtbk5hbWVdID0gdmFsdWUgaW5zdGFuY2VvZiBVaW50OEFycmF5XG4gICAgICA/IHtfX3ZlbG9jaW91c0Rlc3Ryb3lBdXRob3JpemF0aW9uVHlwZTogXCJiaW5hcnlcIiwgdmFsdWU6IEFycmF5LmZyb20odmFsdWUpfVxuICAgICAgOiBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodmFsdWUsIHNlcmlhbGl6YXRpb25PcHRpb25zKVxuICB9XG5cbiAgaWYgKE9iamVjdC5rZXlzKGF1dGhvcml6YXRpb25SZWNvcmQpLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNhcHR1cmUgd2Vic29ja2V0IGRlc3Ryb3kgYXV0aG9yaXphdGlvbiB3aXRob3V0IGF0dHJpYnV0ZXMgZm9yICR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YClcbiAgfVxuXG4gIHJldHVybiBhdXRob3JpemF0aW9uUmVjb3JkXG59XG5cbi8qKlxuICogUmVhZHMgYSByZXNvdXJjZSBpZGVudGl0eSBvbmx5IHdoZW4gZXZlcnkgaWRlbnRpdHkgYXR0cmlidXRlIHdhcyBsb2FkZWQgb24gdGhlIGJhY2tpbmcgcmVjb3JkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJZGVudGl0eSBhcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gQmFja2luZyBtb2RlbC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucHJldmlvdXNdIC0gUmVhZCB2YWx1ZXMgZnJvbSBiZWZvcmUgcGVuZGluZyBjaGFuZ2VzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBhcmdzLnByaW1hcnlLZXkgLSBSZXNvdXJjZSBpZGVudGl0eSBkZWZpbml0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlIHwgbnVsbH0gLSBDb21wbGV0ZSBpZGVudGl0eSBvciBudWxsIHdoZW4gdW5hdmFpbGFibGUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZUlkZW50aXR5KHttb2RlbCwgcHJldmlvdXMgPSBmYWxzZSwgcHJpbWFyeUtleX0pIHtcbiAgY29uc3QgYXR0cmlidXRlcyA9IG1vZGVsLmF0dHJpYnV0ZXMoKVxuICBjb25zdCBjaGFuZ2VzID0gbW9kZWwuY2hhbmdlcygpXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyPn0gKi9cbiAgY29uc3QgaWRlbnRpdHlBdHRyaWJ1dGVzID0ge31cbiAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZXMgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleSA6IFtwcmltYXJ5S2V5XVxuXG4gIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBwcmltYXJ5S2V5QXR0cmlidXRlcykge1xuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcbiAgICBsZXQgdmFsdWVcblxuICAgIGlmIChwcmV2aW91cyAmJiBPYmplY3QuaGFzT3duKGNoYW5nZXMsIGNvbHVtbk5hbWUpKSB7XG4gICAgICB2YWx1ZSA9IGNoYW5nZXNbY29sdW1uTmFtZV1bMF1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFPYmplY3QuaGFzT3duKGF0dHJpYnV0ZXMsIGF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gbnVsbFxuXG4gICAgICB2YWx1ZSA9IGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikgcmV0dXJuIG51bGxcblxuICAgIGlkZW50aXR5QXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gIH1cblxuICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiBpZGVudGl0eUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0pXG59XG5cbi8qKlxuICogRmFucyBvbmUgYmFja2luZy1yZWNvcmQgbGlmZWN5Y2xlIGV2ZW50IG91dCB0aHJvdWdoIGV2ZXJ5IGNvbmZpZ3VyZWQgZnJvbnRlbmQtcmVzb3VyY2UgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFjdGlvbiAtIExpZmVjeWNsZSBhY3Rpb24uXG4gKiBAcGFyYW0ge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn0gW3ByZXZpb3VzSWRzXSAtIFBlcnNpc3RlZCBpZGVudGl0aWVzIGNhcHR1cmVkIGJlZm9yZSB1cGRhdGUgb3IgZGVzdHJveS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRdIC0gU2VydmVyLW9ubHkgcHJlLWRlbGV0ZSByb3cgdXNlZCB0byBhdXRob3JpemUgYSBkZXN0cm95ZWQgcmVjb3JkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcHJldmlvdXNJZHMsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSB7XG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpXG4gIGNvbnN0IHB1Ymxpc2hlclJlc291cmNlcyA9IHB1Ymxpc2hlclJlc291cmNlc0J5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbik/LmdldChtb2RlbC5nZXRNb2RlbENsYXNzKCkpXG5cbiAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXMpIHJldHVyblxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwge3ByaW1hcnlLZXl9XSBvZiBwdWJsaXNoZXJSZXNvdXJjZXMpIHtcbiAgICBjb25zdCBwcmV2aW91c0lkID0gcHJldmlvdXNJZHM/LmdldChtb2RlbE5hbWUpXG4gICAgY29uc3QgY3VycmVudElkID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSWRlbnRpdHkoe21vZGVsLCBwcmltYXJ5S2V5fSlcbiAgICBjb25zdCBpZCA9IGFjdGlvbiA9PT0gXCJkZXN0cm95XCIgPyBwcmV2aW91c0lkIDogY3VycmVudElkID8/IHByZXZpb3VzSWRcblxuICAgIGlmIChpZCA9PT0gbnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuXG4gICAgY29uc3QgaWRlbnRpdHlDaGFuZ2VkID0gYWN0aW9uID09PSBcInVwZGF0ZVwiXG4gICAgICAmJiBjdXJyZW50SWQgIT09IG51bGxcbiAgICAgICYmIHByZXZpb3VzSWQgIT09IHVuZGVmaW5lZFxuICAgICAgJiYgbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZCkgIT09IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIGlkKVxuXG4gICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50KGNvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZSwge1xuICAgICAgYWN0aW9uLFxuICAgICAgaWQsXG4gICAgICAuLi4oZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgIT09IHVuZGVmaW5lZCA/IHtkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gOiB7fSksXG4gICAgICAuLi4oaWRlbnRpdHlDaGFuZ2VkID8ge3ByZXZpb3VzSWR9IDoge30pXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIEZhbnMgYSBsaWZlY3ljbGUgZXZlbnQgb3V0IHRvIGFsbCBWMiBcImZyb250ZW5kLW1vZGVsc1wiIHN1YnNjcmliZXJzXG4gKiB3aG9zZSBgcGFyYW1zLm1vZGVsYCBtYXRjaGVzLiBSZWNvcmQgYXR0cmlidXRlcyBnbyB0aHJvdWdoIHRoZVxuICogdHJhbnNwb3J0IHNlcmlhbGl6ZXIgc28gRGF0ZS91bmRlZmluZWQvZXRjLiBzdXJ2aXZlIHRoZSBKU09OIGhvcC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHt7YWN0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgaWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwcmV2aW91c0lkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlY29yZD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGV2ZW50IC0gTGlmZWN5Y2xlIGV2ZW50LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChjb25maWd1cmF0aW9uLCBtb2RlbE5hbWUsIGV2ZW50KSB7XG4gIGNvbnN0IGJvZHkgPSB7XG4gICAgYWN0aW9uOiBldmVudC5hY3Rpb24sXG4gICAgLi4uKGV2ZW50LmRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkICE9PSB1bmRlZmluZWQgPyB7ZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQ6IGV2ZW50LmRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSA6IHt9KSxcbiAgICBpZDogZXZlbnQuaWQsXG4gICAgbW9kZWw6IG1vZGVsTmFtZSxcbiAgICAuLi4oZXZlbnQucHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkID8ge3ByZXZpb3VzSWQ6IGV2ZW50LnByZXZpb3VzSWR9IDoge30pLFxuICAgIC4uLihldmVudC5yZWNvcmQgPyB7cmVjb3JkOiBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoZXZlbnQucmVjb3JkLCB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikpfSA6IHt9KVxuICB9XG5cbiAgY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwge21vZGVsOiBtb2RlbE5hbWV9LCBib2R5KVxufVxuIl19