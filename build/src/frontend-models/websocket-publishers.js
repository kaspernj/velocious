// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceDefinitionIsClass } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { readModelPrimaryKeyValue } from "../utils/model-primary-key.js";
const modelClassesWithRegisteredHooks = new WeakSet();
const channelClassRegisteredConfigurations = new WeakSet();
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
            const modelName = resourceClass.modelClass().getModelName();
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
    for (const resourceClass of Object.values(allFrontendModels)) {
        // An abstract base resource (no static ModelClass — e.g. an app's shared
        // `BaseResource` that other resources extend) backs no model, so there is
        // nothing to publish realtime events for. Skip it instead of throwing.
        if (!resourceClass.ModelClass)
            continue;
        const modelClass = resourceClass.modelClass();
        const modelName = modelClass.getModelName();
        const configuredPrimaryKey = resourceClass.resourceConfig().primaryKey;
        const modelPrimaryKey = modelClass.primaryKey();
        const primaryKey = configuredPrimaryKey || (Array.isArray(modelPrimaryKey)
            ? modelPrimaryKey.map((columnName) => modelClass.resolveAttributeName(columnName) || columnName)
            : modelClass.resolveAttributeName(modelPrimaryKey) || modelPrimaryKey);
        // Register lifecycle hooks once per model class, not per configuration. A model class belongs to a
        // single backend project/config in production, so per-config registration only differs in tests where
        // the same model class is reachable from multiple configs — there it attaches duplicate beforeCreate/
        // afterSave/afterDestroy hooks that double-fire broadcasts (and leak across specs). The hooks read the
        // model's runtime configuration when broadcasting, so a single registration is sufficient.
        if (modelClassesWithRegisteredHooks.has(modelClass))
            continue;
        modelClassesWithRegisteredHooks.add(modelClass);
        modelClass.beforeCreate((model) => {
            /** @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model).__frontendModelWebsocketAction = "create";
        });
        modelClass.beforeUpdate((model) => {
            /** @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model).__frontendModelWebsocketAction = "update";
        });
        modelClass.afterSave((model) => {
            const modelWithWebsocketAction = /** @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model);
            const action = modelWithWebsocketAction.__frontendModelWebsocketAction;
            if (action !== "create" && action !== "update")
                return;
            void model.connection().afterCommit(async () => {
                broadcastFrontendModelEvent(model._getConfiguration(), modelName, {
                    action,
                    id: readModelPrimaryKeyValue(primaryKey, (attributeName) => model.readAttribute(attributeName)),
                    record: model.attributes()
                });
            });
            delete modelWithWebsocketAction.__frontendModelWebsocketAction;
        });
        modelClass.afterDestroy((model) => {
            void model.connection().afterCommit(async () => {
                broadcastFrontendModelEvent(model._getConfiguration(), modelName, {
                    action: "destroy",
                    id: readModelPrimaryKeyValue(primaryKey, (attributeName) => model.readAttribute(attributeName))
                });
            });
        });
    }
}
/**
 * Fans a lifecycle event out to all V2 "frontend-models" subscribers
 * whose `params.model` matches. Record attributes go through the
 * transport serializer so Date/undefined/etc. survive the JSON hop.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @param {string} modelName - Model class name.
 * @param {{action: "create" | "update" | "destroy", id: ReturnType<typeof JSON.parse>, record?: Record<string, ReturnType<typeof JSON.parse>>}} event - Lifecycle event.
 * @returns {void}
 */
function broadcastFrontendModelEvent(configuration, modelName, event) {
    const body = {
        action: event.action,
        id: event.id,
        model: modelName,
        ...(event.record ? { record: serializeFrontendModelTransportValue(event.record, transportSerializationOptionsForConfiguration(configuration)) } : {})
    };
    configuration.broadcastToChannel(FRONTEND_MODELS_CHANNEL_NAME, { model: modelName }, body);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx3QkFBd0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRXRFLE1BQU0sK0JBQStCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUNyRCxNQUFNLG9DQUFvQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFMUQsMEVBQTBFO0FBQzFFLE1BQU0sQ0FBQyxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFBO0FBRTdEOzs7O0dBSUc7QUFDSCxTQUFTLDZDQUE2QyxDQUFDLGFBQWE7SUFDbEUsT0FBTztRQUNMLFFBQVEsRUFBRSxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDO0tBQzNFLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxpQ0FBaUMsQ0FBQyxTQUFTO0lBQ3pELE9BQU8sbUJBQW1CLFNBQVMsRUFBRSxDQUFBO0FBQ3ZDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyw4Q0FBOEMsQ0FBQyxnQkFBZ0I7SUFDdEU7O29HQUVnRztJQUNoRyxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUE7SUFFcEIsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0s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LE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBQyxNQUFNLEVBQUUsb0NBQW9DLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSw2Q0FBNkMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztLQUNwSixDQUFBO0lBRUQsYUFBYSxDQUFDLGtCQUFrQixDQUFDLDRCQUE0QixFQUFFLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQyxFQUFFLElBQUksQ0FBQyxDQUFBO0FBQzFGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3N9IGZyb20gXCIuL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7cmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG5jb25zdCBtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzID0gbmV3IFdlYWtTZXQoKVxuY29uc3QgY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zID0gbmV3IFdlYWtTZXQoKVxuXG4vKiogU2hhcmVkIGNoYW5uZWwgbmFtZSBmb3IgYWxsIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBzdWJzY3JpcHRpb25zLiAqL1xuZXhwb3J0IGNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnN9IC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICovXG5mdW5jdGlvbiB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICByZXR1cm4ge1xuICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUgaGVscGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJyb2FkY2FzdCBjaGFubmVsIG5hbWUgKGxlZ2FjeSwgcmV0YWluZWQgZm9yIG1pZ3JhdGlvbiBjb21wYXRpYmlsaXR5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxCcm9hZGNhc3RDaGFubmVsTmFtZShtb2RlbE5hbWUpIHtcbiAgcmV0dXJuIGBmcm9udGVuZC1tb2RlbHM6JHttb2RlbE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzIGZyb20gYWJpbGl0eSByZXNvdXJjZXMgbGlzdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BYmlsaXR5UmVzb3VyY2VDbGFzc1R5cGVbXX0gYWJpbGl0eVJlc291cmNlcyAtIEFiaWxpdHkgcmVzb3VyY2UgY2xhc3Nlcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59IC0gUmVzb3VyY2UgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKSB7XG4gIC8qKlxuICAgKiBSZXNvdXJjZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGFiaWxpdHlSZXNvdXJjZXMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlcyB0byBiZSBhbiBhcnJheSBidXQgZ290OiAke3R5cGVvZiBhYmlsaXR5UmVzb3VyY2VzfWApXG4gIH1cblxuICBpZiAoYWJpbGl0eVJlc291cmNlcy5sZW5ndGggPT09IDApIHJldHVybiByZXNvdXJjZXNcblxuICBmb3IgKGNvbnN0IHJlc291cmNlQ2xhc3Mgb2YgYWJpbGl0eVJlc291cmNlcykge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2UgdG8gYmUgYSBjbGFzcyBidXQgZ290OiAke3R5cGVvZiByZXNvdXJjZUNsYXNzfWApXG4gICAgfVxuXG4gICAgaWYgKGZyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzKHJlc291cmNlQ2xhc3MpKSB7XG4gICAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAgIC8vIGBCYXNlUmVzb3VyY2VgIHRoYXQgb3RoZXIgcmVzb3VyY2VzIGV4dGVuZCkgYmFja3Mgbm8gbW9kZWwsIHNvIGl0IGlzbid0IGFcbiAgICAgIC8vIHB1Ymxpc2hhYmxlIGZyb250ZW5kIG1vZGVsLiBTa2lwIGl0IGluc3RlYWQgb2YgbGV0dGluZyBgbW9kZWxDbGFzcygpYFxuICAgICAgLy8gdGhyb3cgYHJlcXVpcmVzIGEgc3RhdGljIE1vZGVsQ2xhc3NgIGR1cmluZyBhYmlsaXR5LXJlc291cmNlIGRpc2NvdmVyeS5cbiAgICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICByZXNvdXJjZXNbbW9kZWxOYW1lXSA9IHJlc291cmNlQ2xhc3NcbiAgICB9IGVsc2UgaWYgKHJlc291cmNlQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSkge1xuICAgICAgLy8gQXV0aG9yaXphdGlvbi1vbmx5IHJlc291cmNlIOKAlCB2YWxpZCBidXQgbm90IHJlbGV2YW50IGZvciBXZWJTb2NrZXQgcHVibGlzaGluZ1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZSBjbGFzczogJHtyZXNvdXJjZUNsYXNzLm5hbWV9LiBFeHBlY3RlZCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIG9yIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MuYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzb3VyY2VzXG59XG5cbi8qKlxuICogUnVucyB0aGUgZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkKGNvbmZpZ3VyYXRpb24pIHtcbiAgLyoqXG4gICAqIEFsbCBmcm9udGVuZCBtb2RlbHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZT59ICovXG4gIGxldCBhbGxGcm9udGVuZE1vZGVscyA9IHt9XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgY29uc3QgcHJvamVjdFJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgIGFsbEZyb250ZW5kTW9kZWxzID0gey4uLmFsbEZyb250ZW5kTW9kZWxzLCAuLi5wcm9qZWN0UmVzb3VyY2VzfVxuICB9XG5cbiAgLy8gQWx3YXlzIG1lcmdlIHRoZSBhYmlsaXR5IHJlc29sdmVyJ3MgcmVzb3VyY2UgbGlzdCB0b28uIEEgcHJvamVjdCBjYW4gZXhwb3NlIHNvbWVcbiAgLy8gcmVzb3VyY2VzIGFzIGRpc2NvdmVyYWJsZSBgc3JjL3Jlc291cmNlcy8qLmpzYCBmaWxlcyAoY29uZmlndXJlZCBvciBhdXRvLWRpc2NvdmVyZWQpXG4gIC8vIGFuZCBvdGhlcnMgb25seSB0aHJvdWdoIGBnZXRBYmlsaXR5UmVzb3VyY2VzKClgOyBib3RoIHNldHMgbmVlZCBsaWZlY3ljbGUgcHVibGlzaGVycyxcbiAgLy8gc28gcmVzb3VyY2UgZGlzY292ZXJ5IG11c3Qgbm90IHN1cHByZXNzIHRoaXMgbGlzdC5cbiAgY29uc3QgYWJpbGl0eVJlc291cmNlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0QWJpbGl0eVJlc291cmNlcygpXG5cbiAgYWxsRnJvbnRlbmRNb2RlbHMgPSB7XG4gICAgLi4uYWxsRnJvbnRlbmRNb2RlbHMsXG4gICAgLi4uZnJvbnRlbmRNb2RlbFJlc291cmNlc0Zyb21BYmlsaXR5UmVzb3VyY2VzTGlzdChhYmlsaXR5UmVzb3VyY2VzKVxuICB9XG5cbiAgLy8gUGhhc2UgMzogcmVnaXN0ZXIgdGhlIFYyIGNoYW5uZWwgY2xhc3Mgb25jZSBwZXIgY29uZmlndXJhdGlvbiBzb1xuICAvLyBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWx9fSlgIGZpbmRzIGl0LlxuICAvLyBEeW5hbWljIGltcG9ydCBrZWVwcyBzZXJ2ZXItb25seSBXZWJzb2NrZXRSZXF1ZXN0ICsgTm9kZSB1dGlsaXRpZXNcbiAgLy8gb3V0IG9mIGJyb3dzZXIgYnVuZGxlcyB0aGF0IHRyYW5zaXRpdmVseSBwdWxsIGluIHRoaXMgbW9kdWxlIHZpYVxuICAvLyBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIuXG4gIGlmICghY2hhbm5lbENsYXNzUmVnaXN0ZXJlZENvbmZpZ3VyYXRpb25zLmhhcyhjb25maWd1cmF0aW9uKSkge1xuICAgIGNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucy5hZGQoY29uZmlndXJhdGlvbilcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWx9ID0gYXdhaXQgaW1wb3J0KFwiLi93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKVxuXG4gICAgY29uZmlndXJhdGlvbi5yZWdpc3RlcldlYnNvY2tldENoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWwpXG4gIH1cblxuICBmb3IgKGNvbnN0IHJlc291cmNlQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyhhbGxGcm9udGVuZE1vZGVscykpIHtcbiAgICAvLyBBbiBhYnN0cmFjdCBiYXNlIHJlc291cmNlIChubyBzdGF0aWMgTW9kZWxDbGFzcyDigJQgZS5nLiBhbiBhcHAncyBzaGFyZWRcbiAgICAvLyBgQmFzZVJlc291cmNlYCB0aGF0IG90aGVyIHJlc291cmNlcyBleHRlbmQpIGJhY2tzIG5vIG1vZGVsLCBzbyB0aGVyZSBpc1xuICAgIC8vIG5vdGhpbmcgdG8gcHVibGlzaCByZWFsdGltZSBldmVudHMgZm9yLiBTa2lwIGl0IGluc3RlYWQgb2YgdGhyb3dpbmcuXG4gICAgaWYgKCFyZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICBjb25zdCBtb2RlbE5hbWUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3QgY29uZmlndXJlZFByaW1hcnlLZXkgPSByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKCkucHJpbWFyeUtleVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbmZpZ3VyZWRQcmltYXJ5S2V5IHx8IChBcnJheS5pc0FycmF5KG1vZGVsUHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKSB8fCBjb2x1bW5OYW1lKVxuICAgICAgOiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG1vZGVsUHJpbWFyeUtleSkgfHwgbW9kZWxQcmltYXJ5S2V5KVxuXG4gICAgLy8gUmVnaXN0ZXIgbGlmZWN5Y2xlIGhvb2tzIG9uY2UgcGVyIG1vZGVsIGNsYXNzLCBub3QgcGVyIGNvbmZpZ3VyYXRpb24uIEEgbW9kZWwgY2xhc3MgYmVsb25ncyB0byBhXG4gICAgLy8gc2luZ2xlIGJhY2tlbmQgcHJvamVjdC9jb25maWcgaW4gcHJvZHVjdGlvbiwgc28gcGVyLWNvbmZpZyByZWdpc3RyYXRpb24gb25seSBkaWZmZXJzIGluIHRlc3RzIHdoZXJlXG4gICAgLy8gdGhlIHNhbWUgbW9kZWwgY2xhc3MgaXMgcmVhY2hhYmxlIGZyb20gbXVsdGlwbGUgY29uZmlncyDigJQgdGhlcmUgaXQgYXR0YWNoZXMgZHVwbGljYXRlIGJlZm9yZUNyZWF0ZS9cbiAgICAvLyBhZnRlclNhdmUvYWZ0ZXJEZXN0cm95IGhvb2tzIHRoYXQgZG91YmxlLWZpcmUgYnJvYWRjYXN0cyAoYW5kIGxlYWsgYWNyb3NzIHNwZWNzKS4gVGhlIGhvb2tzIHJlYWQgdGhlXG4gICAgLy8gbW9kZWwncyBydW50aW1lIGNvbmZpZ3VyYXRpb24gd2hlbiBicm9hZGNhc3RpbmcsIHNvIGEgc2luZ2xlIHJlZ2lzdHJhdGlvbiBpcyBzdWZmaWNpZW50LlxuICAgIGlmIChtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzLmhhcyhtb2RlbENsYXNzKSkgY29udGludWVcblxuICAgIG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MuYWRkKG1vZGVsQ2xhc3MpXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZUNyZWF0ZSgobW9kZWwpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9fSAqLyAobW9kZWwpLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwiY3JlYXRlXCJcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVVcGRhdGUoKG1vZGVsKSA9PiB7XG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwifX0gKi8gKG1vZGVsKS5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24gPSBcInVwZGF0ZVwiXG4gICAgfSlcblxuICAgIG1vZGVsQ2xhc3MuYWZ0ZXJTYXZlKChtb2RlbCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCAmIHtfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIn19ICovIChtb2RlbClcbiAgICAgIGNvbnN0IGFjdGlvbiA9IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cblxuICAgICAgaWYgKGFjdGlvbiAhPT0gXCJjcmVhdGVcIiAmJiBhY3Rpb24gIT09IFwidXBkYXRlXCIpIHJldHVyblxuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpLCBtb2RlbE5hbWUsIHtcbiAgICAgICAgICBhY3Rpb24sXG4gICAgICAgICAgaWQ6IHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gbW9kZWwucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSksXG4gICAgICAgICAgcmVjb3JkOiBtb2RlbC5hdHRyaWJ1dGVzKClcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgICBkZWxldGUgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyRGVzdHJveSgobW9kZWwpID0+IHtcbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50KG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCksIG1vZGVsTmFtZSwge1xuICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgaWQ6IHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gbW9kZWwucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIEZhbnMgYSBsaWZlY3ljbGUgZXZlbnQgb3V0IHRvIGFsbCBWMiBcImZyb250ZW5kLW1vZGVsc1wiIHN1YnNjcmliZXJzXG4gKiB3aG9zZSBgcGFyYW1zLm1vZGVsYCBtYXRjaGVzLiBSZWNvcmQgYXR0cmlidXRlcyBnbyB0aHJvdWdoIHRoZVxuICogdHJhbnNwb3J0IHNlcmlhbGl6ZXIgc28gRGF0ZS91bmRlZmluZWQvZXRjLiBzdXJ2aXZlIHRoZSBKU09OIGhvcC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHt7YWN0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCBpZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlY29yZD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGV2ZW50IC0gTGlmZWN5Y2xlIGV2ZW50LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChjb25maWd1cmF0aW9uLCBtb2RlbE5hbWUsIGV2ZW50KSB7XG4gIGNvbnN0IGJvZHkgPSB7XG4gICAgYWN0aW9uOiBldmVudC5hY3Rpb24sXG4gICAgaWQ6IGV2ZW50LmlkLFxuICAgIG1vZGVsOiBtb2RlbE5hbWUsXG4gICAgLi4uKGV2ZW50LnJlY29yZCA/IHtyZWNvcmQ6IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShldmVudC5yZWNvcmQsIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSl9IDoge30pXG4gIH1cblxuICBjb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7bW9kZWw6IG1vZGVsTmFtZX0sIGJvZHkpXG59XG4iXX0=