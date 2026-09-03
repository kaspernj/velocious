// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceDefinitionIsClass } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyCacheKey, readModelPrimaryKeyValue } from "../utils/model-primary-key.js";
/** @typedef {{hasAttachments: boolean, primaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition}} FrontendModelPublisherResource */
/** @typedef {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update", __frontendModelWebsocketPreviousIds?: Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>}} FrontendModelWebsocketRecord */
const modelClassesWithRegisteredHooks = new WeakSet();
const channelClassRegisteredConfigurations = new WeakSet();
/** @type {WeakMap<import("../configuration.js").default, WeakMap<typeof import("../database/record/index.js").default, Map<string, FrontendModelPublisherResource>>>} */
const publisherResourcesByConfiguration = new WeakMap();
const ATTACHMENT_OWNER_KEY = "__attachmentOwner";
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
            hasAttachments: Object.keys(resourceConfiguration.attachments || {}).length > 0,
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
                broadcastFrontendModelEvents(model, action, model.attributes(), previousIds);
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
    const changes = model.changes();
    for (const [modelName, { primaryKey }] of publisherResources) {
        previousIds.set(modelName, readModelPrimaryKeyValue(primaryKey, (attributeName) => {
            const columnName = model.getModelClass().getColumnNameForAttributeName(attributeName);
            if (Object.hasOwn(changes, columnName))
                return changes[columnName][0];
            return model.readAttribute(attributeName);
        }));
    }
    return previousIds;
}
/**
 * Fans one backing-record lifecycle event out through every configured frontend-resource identity.
 * @param {import("../database/record/index.js").default} model - Backing model instance.
 * @param {"create" | "update" | "destroy"} action - Lifecycle action.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} [record] - Backing record attributes.
 * @param {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} [previousIds] - Previous update identities by resource name.
 * @returns {void}
 */
function broadcastFrontendModelEvents(model, action, record, previousIds) {
    const configuration = model._getConfiguration();
    const publisherResources = publisherResourcesByConfiguration.get(configuration)?.get(model.getModelClass());
    if (!publisherResources)
        return;
    for (const [modelName, { hasAttachments, primaryKey }] of publisherResources) {
        const id = readModelPrimaryKeyValue(primaryKey, (attributeName) => model.readAttribute(attributeName));
        const previousId = previousIds?.get(modelName);
        const identityChanged = previousId !== undefined
            && modelPrimaryKeyCacheKey(primaryKey, previousId) !== modelPrimaryKeyCacheKey(primaryKey, id);
        const lifecycleRecord = record && hasAttachments
            ? {
                ...record,
                [ATTACHMENT_OWNER_KEY]: {
                    recordId: modelPrimaryKeyCacheKey(model.getModelClass().primaryKey(), model.id()),
                    recordType: model.getModelClass().getModelName()
                }
            }
            : record;
        broadcastFrontendModelEvent(configuration, modelName, {
            action,
            id,
            ...(identityChanged ? { previousId } : {}),
            ...(lifecycleRecord ? { record: lifecycleRecord } : {})
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRS9GLHlKQUF5SjtBQUN6SixzUUFBc1E7QUFFdFEsTUFBTSwrQkFBK0IsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQ3JELE1BQU0sb0NBQW9DLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUMxRCx5S0FBeUs7QUFDekssTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBQ3ZELE1BQU0sb0JBQW9CLEdBQUcsbUJBQW1CLENBQUE7QUFFaEQsMEVBQTBFO0FBQzFFLE1BQU0sQ0FBQyxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFBO0FBRTdEOzs7O0dBSUc7QUFDSCxTQUFTLDZDQUE2QyxDQUFDLGFBQWE7SUFDbEUsT0FBTztRQUNMLFFBQVEsRUFBRSxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDO0tBQzNFLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxpQ0FBaUMsQ0FBQyxTQUFTO0lBQ3pELE9BQU8sbUJBQW1CLFNBQVMsRUFBRSxDQUFBO0FBQ3ZDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyw4Q0FB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QUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7S0FDcEosQ0FBQTtJQUVELGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyw0QkFBNEIsRUFBRSxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQTtBQUMxRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuL2J1aWx0LWluLXJlc291cmNlcy5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzfSBmcm9tIFwiLi9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7c2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5LCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7e2hhc0F0dGFjaG1lbnRzOiBib29sZWFuLCBwcmltYXJ5S2V5OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufX0gRnJvbnRlbmRNb2RlbFB1Ymxpc2hlclJlc291cmNlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiLCBfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkcz86IE1hcDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlPn19IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmQgKi9cblxuY29uc3QgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcyA9IG5ldyBXZWFrU2V0KClcbmNvbnN0IGNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucyA9IG5ldyBXZWFrU2V0KClcbi8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIFdlYWtNYXA8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBNYXA8c3RyaW5nLCBGcm9udGVuZE1vZGVsUHVibGlzaGVyUmVzb3VyY2U+Pj59ICovXG5jb25zdCBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5jb25zdCBBVFRBQ0hNRU5UX09XTkVSX0tFWSA9IFwiX19hdHRhY2htZW50T3duZXJcIlxuXG4vKiogU2hhcmVkIGNoYW5uZWwgbmFtZSBmb3IgYWxsIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBzdWJzY3JpcHRpb25zLiAqL1xuZXhwb3J0IGNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnN9IC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICovXG5mdW5jdGlvbiB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICByZXR1cm4ge1xuICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUgaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJyb2FkY2FzdCBjaGFubmVsIG5hbWUgKGxlZ2FjeSwgcmV0YWluZWQgZm9yIG1pZ3JhdGlvbiBjb21wYXRpYmlsaXR5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxCcm9hZGNhc3RDaGFubmVsTmFtZShtb2RlbE5hbWUpIHtcbiAgcmV0dXJuIGBmcm9udGVuZC1tb2RlbHM6JHttb2RlbE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzIGZyb20gYWJpbGl0eSByZXNvdXJjZXMgbGlzdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gYWJpbGl0eVJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKSB7XG4gIC8qKlxuICAgKiBSZXNvdXJjZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGFiaWxpdHlSZXNvdXJjZXMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlcyB0byBiZSBhbiBhcnJheSBidXQgZ290OiAke3R5cGVvZiBhYmlsaXR5UmVzb3VyY2VzfWApXG4gIH1cblxuICBpZiAoYWJpbGl0eVJlc291cmNlcy5sZW5ndGggPT09IDApIHJldHVybiByZXNvdXJjZXNcblxuICBmb3IgKGNvbnN0IHJlc291cmNlQ2xhc3Mgb2YgYWJpbGl0eVJlc291cmNlcykge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2UgdG8gYmUgYSBjbGFzcyBidXQgZ290OiAke3R5cGVvZiByZXNvdXJjZUNsYXNzfWApXG4gICAgfVxuXG4gICAgaWYgKGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlQ2xhc3MpKSB7XG4gICAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIGl0IGlzbid0IGFcbiAgICAgIC8vIHB1Ymxpc2hhYmxlIGZyb250ZW5kIG1vZGVsLiBTa2lwIGl0IGluc3RlYWQgb2YgbGV0dGluZyBgbW9kZWxDbGFzcygpYFxuICAgICAgLy8gdGhyb3cgYHJlcXVpcmVzIGEgc3RhdGljIE1vZGVsQ2xhc3NgIGR1cmluZyBhYmlsaXR5LXJlc291cmNlIGRpc2NvdmVyeS5cbiAgICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKCkubW9kZWxOYW1lIHx8IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIHJlc291cmNlc1ttb2RlbE5hbWVdID0gcmVzb3VyY2VDbGFzc1xuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlKSB7XG4gICAgICAvLyBBdXRob3JpemF0aW9uLW9ubHkgcmVzb3VyY2Ug4oCUIHZhbGlkIGJ1dCBub3QgcmVsZXZhbnQgZm9yIFdlYlNvY2tldCBwdWJsaXNoaW5nXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIGNsYXNzOiAke3Jlc291cmNlQ2xhc3MubmFtZX0uIEV4cGVjdGVkIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2Ugb3IgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXNvdXJjZXNcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQoY29uZmlndXJhdGlvbikge1xuICAvKipcbiAgICogQWxsIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPn0gKi9cbiAgbGV0IGFsbEZyb250ZW5kTW9kZWxzID0ge31cblxuICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICBjb25zdCBwcm9qZWN0UmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7Li4uYWxsRnJvbnRlbmRNb2RlbHMsIC4uLnByb2plY3RSZXNvdXJjZXN9XG4gIH1cblxuICAvLyBBbHdheXMgbWVyZ2UgdGhlIGFiaWxpdHkgcmVzb2x2ZXIncyByZXNvdXJjZSBsaXN0IHRvby4gQSBwcm9qZWN0IGNhbiBleHBvc2Ugc29tZVxuICAvLyByZXNvdXJjZXMgYXMgZGlzY292ZXJhYmxlIGBzcmMvcmVzb3VyY2VzLyouanNgIGZpbGVzIChjb25maWd1cmVkIG9yIGF1dG8tZGlzY292ZXJlZClcbiAgLy8gYW5kIG90aGVycyBvbmx5IHRocm91Z2ggYGdldEFiaWxpdHlSZXNvdXJjZXMoKWA7IGJvdGggc2V0cyBuZWVkIGxpZmVjeWNsZSBwdWJsaXNoZXJzLFxuICAvLyBzbyByZXNvdXJjZSBkaXNjb3ZlcnkgbXVzdCBub3Qgc3VwcHJlc3MgdGhpcyBsaXN0LlxuICBjb25zdCBhYmlsaXR5UmVzb3VyY2VzID0gY29uZmlndXJhdGlvbi5nZXRBYmlsaXR5UmVzb3VyY2VzKClcblxuICBhbGxGcm9udGVuZE1vZGVscyA9IHtcbiAgICAuLi5hbGxGcm9udGVuZE1vZGVscyxcbiAgICAuLi5mcm9udGVuZE1vZGVsUmVzb3VyY2VzRnJvbUFiaWxpdHlSZXNvdXJjZXNMaXN0KGFiaWxpdHlSZXNvdXJjZXMpXG4gIH1cblxuICAvLyBQaGFzZSAzOiByZWdpc3RlciB0aGUgVjIgY2hhbm5lbCBjbGFzcyBvbmNlIHBlciBjb25maWd1cmF0aW9uIHNvXG4gIC8vIGBzdWJzY3JpYmVDaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHtwYXJhbXM6IHttb2RlbH19KWAgZmluZHMgaXQuXG4gIC8vIER5bmFtaWMgaW1wb3J0IGtlZXBzIHNlcnZlci1vbmx5IFdlYnNvY2tldFJlcXVlc3QgKyBOb2RlIHV0aWxpdGllc1xuICAvLyBvdXQgb2YgYnJvd3NlciBidW5kbGVzIHRoYXQgdHJhbnNpdGl2ZWx5IHB1bGwgaW4gdGhpcyBtb2R1bGUgdmlhXG4gIC8vIGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlci5cbiAgaWYgKCFjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMuaGFzKGNvbmZpZ3VyYXRpb24pKSB7XG4gICAgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmFkZChjb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IHtkZWZhdWx0OiBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbH0gPSBhd2FpdCBpbXBvcnQoXCIuL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpXG5cbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbClcbiAgfVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgcmVzb3VyY2VDbGFzc10gb2YgT2JqZWN0LmVudHJpZXMoYWxsRnJvbnRlbmRNb2RlbHMpKSB7XG4gICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgLy8gYEJhc2VSZXNvdXJjZWAgdGhhdCBvdGhlciByZXNvdXJjZXMgZXh0ZW5kKSBiYWNrcyBubyBtb2RlbCwgc28gdGhlcmUgaXNcbiAgICAvLyBub3RoaW5nIHRvIHB1Ymxpc2ggcmVhbHRpbWUgZXZlbnRzIGZvci4gU2tpcCBpdCBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gcmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgY29uZmlndXJlZFByaW1hcnlLZXkgPSByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbmZpZ3VyZWRQcmltYXJ5S2V5IHx8IChBcnJheS5pc0FycmF5KG1vZGVsUHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKSB8fCBjb2x1bW5OYW1lKVxuICAgICAgOiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG1vZGVsUHJpbWFyeUtleSkgfHwgbW9kZWxQcmltYXJ5S2V5KVxuICAgIGxldCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIXB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcykge1xuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlNb2RlbENsYXNzID0gbmV3IFdlYWtNYXAoKVxuICAgICAgcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBwdWJsaXNoZXJSZXNvdXJjZXNCeU1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgbGV0IHB1Ymxpc2hlclJlc291cmNlcyA9IHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5nZXQobW9kZWxDbGFzcylcblxuICAgIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgICBwdWJsaXNoZXJSZXNvdXJjZXMgPSBuZXcgTWFwKClcbiAgICAgIHB1Ymxpc2hlclJlc291cmNlc0J5TW9kZWxDbGFzcy5zZXQobW9kZWxDbGFzcywgcHVibGlzaGVyUmVzb3VyY2VzKVxuICAgIH1cblxuICAgIHB1Ymxpc2hlclJlc291cmNlcy5zZXQobW9kZWxOYW1lLCB7XG4gICAgICBoYXNBdHRhY2htZW50czogT2JqZWN0LmtleXMocmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dGFjaG1lbnRzIHx8IHt9KS5sZW5ndGggPiAwLFxuICAgICAgcHJpbWFyeUtleVxuICAgIH0pXG5cbiAgICAvLyBSZWdpc3RlciBsaWZlY3ljbGUgaG9va3Mgb25jZSBwZXIgbW9kZWwgY2xhc3MsIG5vdCBwZXIgY29uZmlndXJhdGlvbi4gQSBtb2RlbCBjbGFzcyBiZWxvbmdzIHRvIGFcbiAgICAvLyBzaW5nbGUgYmFja2VuZCBwcm9qZWN0L2NvbmZpZyBpbiBwcm9kdWN0aW9uLCBzbyBwZXItY29uZmlnIHJlZ2lzdHJhdGlvbiBvbmx5IGRpZmZlcnMgaW4gdGVzdHMgd2hlcmVcbiAgICAvLyB0aGUgc2FtZSBtb2RlbCBjbGFzcyBpcyByZWFjaGFibGUgZnJvbSBtdWx0aXBsZSBjb25maWdzIOKAlCB0aGVyZSBpdCBhdHRhY2hlcyBkdXBsaWNhdGUgYmVmb3JlQ3JlYXRlL1xuICAgIC8vIGFmdGVyU2F2ZS9hZnRlckRlc3Ryb3kgaG9va3MgdGhhdCBkb3VibGUtZmlyZSBicm9hZGNhc3RzIChhbmQgbGVhayBhY3Jvc3Mgc3BlY3MpLiBUaGUgaG9va3MgcmVhZCB0aGVcbiAgICAvLyBtb2RlbCdzIHJ1bnRpbWUgY29uZmlndXJhdGlvbiB3aGVuIGJyb2FkY2FzdGluZywgc28gYSBzaW5nbGUgcmVnaXN0cmF0aW9uIGlzIHN1ZmZpY2llbnQuXG4gICAgaWYgKG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MuaGFzKG1vZGVsQ2xhc3MpKSBjb250aW51ZVxuXG4gICAgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcy5hZGQobW9kZWxDbGFzcylcblxuICAgIG1vZGVsQ2xhc3MuYmVmb3JlQ3JlYXRlKChtb2RlbCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0UmVjb3JkfSAqLyAobW9kZWwpLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwiY3JlYXRlXCJcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVVcGRhdGUoKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCB3ZWJzb2NrZXRNb2RlbCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFJlY29yZH0gKi8gKG1vZGVsKVxuXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24gPSBcInVwZGF0ZVwiXG4gICAgICB3ZWJzb2NrZXRNb2RlbC5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRQcmV2aW91c0lkcyA9IGZyb250ZW5kTW9kZWxQcmV2aW91c1Jlc291cmNlSWRlbnRpdGllcyhtb2RlbClcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5hZnRlclNhdmUoKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24gPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRSZWNvcmR9ICovIChtb2RlbClcbiAgICAgIGNvbnN0IGFjdGlvbiA9IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cblxuICAgICAgaWYgKGFjdGlvbiAhPT0gXCJjcmVhdGVcIiAmJiBhY3Rpb24gIT09IFwidXBkYXRlXCIpIHJldHVyblxuICAgICAgY29uc3QgcHJldmlvdXNJZHMgPSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcblxuICAgICAgdm9pZCBtb2RlbC5jb25uZWN0aW9uKCkuYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnRzKG1vZGVsLCBhY3Rpb24sIG1vZGVsLmF0dHJpYnV0ZXMoKSwgcHJldmlvdXNJZHMpXG4gICAgICB9KVxuICAgICAgZGVsZXRlIG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cbiAgICAgIGRlbGV0ZSBtb2RlbFdpdGhXZWJzb2NrZXRBY3Rpb24uX19mcm9udGVuZE1vZGVsV2Vic29ja2V0UHJldmlvdXNJZHNcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5hZnRlckRlc3Ryb3koKG1vZGVsKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIFwiZGVzdHJveVwiKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBldmVyeSByZXNvdXJjZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgcmVjb3JkIGJlZm9yZSBpdHMgcGVuZGluZyB1cGRhdGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgYmVmb3JlIHVwZGF0ZS5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59IC0gUHJldmlvdXMgaWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJldmlvdXNSZXNvdXJjZUlkZW50aXRpZXMobW9kZWwpIHtcbiAgY29uc3QgcHVibGlzaGVyUmVzb3VyY2VzID0gcHVibGlzaGVyUmVzb3VyY2VzQnlDb25maWd1cmF0aW9uLmdldChtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpKT8uZ2V0KG1vZGVsLmdldE1vZGVsQ2xhc3MoKSlcbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59ICovXG4gIGNvbnN0IHByZXZpb3VzSWRzID0gbmV3IE1hcCgpXG5cbiAgaWYgKCFwdWJsaXNoZXJSZXNvdXJjZXMpIHJldHVybiBwcmV2aW91c0lkc1xuXG4gIGNvbnN0IGNoYW5nZXMgPSBtb2RlbC5jaGFuZ2VzKClcblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtwcmltYXJ5S2V5fV0gb2YgcHVibGlzaGVyUmVzb3VyY2VzKSB7XG4gICAgcHJldmlvdXNJZHMuc2V0KG1vZGVsTmFtZSwgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChPYmplY3QuaGFzT3duKGNoYW5nZXMsIGNvbHVtbk5hbWUpKSByZXR1cm4gY2hhbmdlc1tjb2x1bW5OYW1lXVswXVxuXG4gICAgICByZXR1cm4gbW9kZWwucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH0pKVxuICB9XG5cbiAgcmV0dXJuIHByZXZpb3VzSWRzXG59XG5cbi8qKlxuICogRmFucyBvbmUgYmFja2luZy1yZWNvcmQgbGlmZWN5Y2xlIGV2ZW50IG91dCB0aHJvdWdoIGV2ZXJ5IGNvbmZpZ3VyZWQgZnJvbnRlbmQtcmVzb3VyY2UgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEJhY2tpbmcgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFjdGlvbiAtIExpZmVjeWNsZSBhY3Rpb24uXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW3JlY29yZF0gLSBCYWNraW5nIHJlY29yZCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZT59IFtwcmV2aW91c0lkc10gLSBQcmV2aW91cyB1cGRhdGUgaWRlbnRpdGllcyBieSByZXNvdXJjZSBuYW1lLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudHMobW9kZWwsIGFjdGlvbiwgcmVjb3JkLCBwcmV2aW91c0lkcykge1xuICBjb25zdCBjb25maWd1cmF0aW9uID0gbW9kZWwuX2dldENvbmZpZ3VyYXRpb24oKVxuICBjb25zdCBwdWJsaXNoZXJSZXNvdXJjZXMgPSBwdWJsaXNoZXJSZXNvdXJjZXNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pPy5nZXQobW9kZWwuZ2V0TW9kZWxDbGFzcygpKVxuXG4gIGlmICghcHVibGlzaGVyUmVzb3VyY2VzKSByZXR1cm5cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHtoYXNBdHRhY2htZW50cywgcHJpbWFyeUtleX1dIG9mIHB1Ymxpc2hlclJlc291cmNlcykge1xuICAgIGNvbnN0IGlkID0gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiBtb2RlbC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpKVxuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBwcmV2aW91c0lkcz8uZ2V0KG1vZGVsTmFtZSlcbiAgICBjb25zdCBpZGVudGl0eUNoYW5nZWQgPSBwcmV2aW91c0lkICE9PSB1bmRlZmluZWRcbiAgICAgICYmIG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWQpICE9PSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZClcbiAgICBjb25zdCBsaWZlY3ljbGVSZWNvcmQgPSByZWNvcmQgJiYgaGFzQXR0YWNobWVudHNcbiAgICAgID8ge1xuICAgICAgICAgIC4uLnJlY29yZCxcbiAgICAgICAgICBbQVRUQUNITUVOVF9PV05FUl9LRVldOiB7XG4gICAgICAgICAgICByZWNvcmRJZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkobW9kZWwuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSwgbW9kZWwuaWQoKSksXG4gICAgICAgICAgICByZWNvcmRUeXBlOiBtb2RlbC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIDogcmVjb3JkXG5cbiAgICBicm9hZGNhc3RGcm9udGVuZE1vZGVsRXZlbnQoY29uZmlndXJhdGlvbiwgbW9kZWxOYW1lLCB7XG4gICAgICBhY3Rpb24sXG4gICAgICBpZCxcbiAgICAgIC4uLihpZGVudGl0eUNoYW5nZWQgPyB7cHJldmlvdXNJZH0gOiB7fSksXG4gICAgICAuLi4obGlmZWN5Y2xlUmVjb3JkID8ge3JlY29yZDogbGlmZWN5Y2xlUmVjb3JkfSA6IHt9KVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBGYW5zIGEgbGlmZWN5Y2xlIGV2ZW50IG91dCB0byBhbGwgVjIgXCJmcm9udGVuZC1tb2RlbHNcIiBzdWJzY3JpYmVyc1xuICogd2hvc2UgYHBhcmFtcy5tb2RlbGAgbWF0Y2hlcy4gUmVjb3JkIGF0dHJpYnV0ZXMgZ28gdGhyb3VnaCB0aGVcbiAqIHRyYW5zcG9ydCBzZXJpYWxpemVyIHNvIERhdGUvdW5kZWZpbmVkL2V0Yy4gc3Vydml2ZSB0aGUgSlNPTiBob3AuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAqIEBwYXJhbSB7e2FjdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgaWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwcmV2aW91c0lkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlY29yZD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGV2ZW50IC0gTGlmZWN5Y2xlIGV2ZW50LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChjb25maWd1cmF0aW9uLCBtb2RlbE5hbWUsIGV2ZW50KSB7XG4gIGNvbnN0IGJvZHkgPSB7XG4gICAgYWN0aW9uOiBldmVudC5hY3Rpb24sXG4gICAgaWQ6IGV2ZW50LmlkLFxuICAgIG1vZGVsOiBtb2RlbE5hbWUsXG4gICAgLi4uKGV2ZW50LnByZXZpb3VzSWQgIT09IHVuZGVmaW5lZCA/IHtwcmV2aW91c0lkOiBldmVudC5wcmV2aW91c0lkfSA6IHt9KSxcbiAgICAuLi4oZXZlbnQucmVjb3JkID8ge3JlY29yZDogc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGV2ZW50LnJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKX0gOiB7fSlcbiAgfVxuXG4gIGNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHttb2RlbDogbW9kZWxOYW1lfSwgYm9keSlcbn1cbiJdfQ==