// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceDefinitionIsClass } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
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
                    id: model.id(),
                    record: model.attributes()
                });
            });
            delete modelWithWebsocketAction.__frontendModelWebsocketAction;
        });
        modelClass.afterDestroy((model) => {
            void model.connection().afterCommit(async () => {
                broadcastFrontendModelEvent(model._getConfiguration(), modelName, {
                    action: "destroy",
                    id: model.id()
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXB1Ymxpc2hlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQy9FLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBRWpGLE1BQU0sK0JBQStCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUNyRCxNQUFNLG9DQUFvQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFMUQsMEVBQTBFO0FBQzFFLE1BQU0sQ0FBQyxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFBO0FBRTdEOzs7O0dBSUc7QUFDSCxTQUFTLDZDQUE2QyxDQUFDLGFBQWE7SUFDbEUsT0FBTztRQUNMLFFBQVEsRUFBRSxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDO0tBQzNFLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxpQ0FBaUMsQ0FBQyxTQUFTO0lBQ3pELE9BQU8sbUJBQW1CLFNBQVMsRUFBRSxDQUFBO0FBQ3ZDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyw4Q0FBOEMsQ0FBQyxnQkFBZ0I7SUFDdEU7O29HQUVnRztJQUNoRyxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUE7SUFFcEIsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sSUFBSSxLQUFLLENBQUMsc0RBQXNELE9BQU8sZ0JBQWdCLEVBQUUsQ0FBQyxD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QkFDN0MsMkJBQTJCLENBQUMsS0FBSyxDQUFDLGlCQUFpQixFQUFFLEVBQUUsU0FBUyxFQUFFO29CQUNoRSxNQUFNLEVBQUUsU0FBUztvQkFDakIsRUFBRSxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUU7aUJBQ2YsQ0FBQyxDQUFBO1lBQ0osQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxTQUFTLDJCQUEyQixDQUFDLGFBQWEsRUFBRSxTQUFTLEVBQUUsS0FBSztJQUNsRSxNQUFNLElBQUksR0FBRztRQUNYLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtRQUNwQixFQUFFLEVBQUUsS0FBSyxDQUFDLEVBQUU7UUFDWixLQUFLLEVBQUUsU0FBUztRQUNoQixHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBQyxNQUFNLEVBQUUsb0NBQW9DLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSw2Q0FBNkMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztLQUNwSixDQUFBO0lBRUQsYUFBYSxDQUFDLGtCQUFrQixDQUFDLDRCQUE0QixFQUFFLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQyxFQUFFLElBQUksQ0FBQyxDQUFBO0FBQzFGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3N9IGZyb20gXCIuL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcblxuY29uc3QgbW9kZWxDbGFzc2VzV2l0aFJlZ2lzdGVyZWRIb29rcyA9IG5ldyBXZWFrU2V0KClcbmNvbnN0IGNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucyA9IG5ldyBXZWFrU2V0KClcblxuLyoqIFNoYXJlZCBjaGFubmVsIG5hbWUgZm9yIGFsbCBmcm9udGVuZC1tb2RlbCBsaWZlY3ljbGUgc3Vic2NyaXB0aW9ucy4gKi9cbmV4cG9ydCBjb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEJyb2FkY2FzdENoYW5uZWxOYW1lIGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCcm9hZGNhc3QgY2hhbm5lbCBuYW1lIChsZWdhY3ksIHJldGFpbmVkIGZvciBtaWdyYXRpb24gY29tcGF0aWJpbGl0eSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsQnJvYWRjYXN0Q2hhbm5lbE5hbWUobW9kZWxOYW1lKSB7XG4gIHJldHVybiBgZnJvbnRlbmQtbW9kZWxzOiR7bW9kZWxOYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcyBmcm9tIGFiaWxpdHkgcmVzb3VyY2VzIGxpc3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQWJpbGl0eVJlc291cmNlQ2xhc3NUeXBlW119IGFiaWxpdHlSZXNvdXJjZXMgLSBBYmlsaXR5IHJlc291cmNlIGNsYXNzZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAtIFJlc291cmNlIGRlZmluaXRpb25zIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGcm9tQWJpbGl0eVJlc291cmNlc0xpc3QoYWJpbGl0eVJlc291cmNlcykge1xuICAvKipcbiAgICogUmVzb3VyY2VzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAqL1xuICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShhYmlsaXR5UmVzb3VyY2VzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYWJpbGl0eSByZXNvdXJjZXMgdG8gYmUgYW4gYXJyYXkgYnV0IGdvdDogJHt0eXBlb2YgYWJpbGl0eVJlc291cmNlc31gKVxuICB9XG5cbiAgaWYgKGFiaWxpdHlSZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcmVzb3VyY2VzXG5cbiAgZm9yIChjb25zdCByZXNvdXJjZUNsYXNzIG9mIGFiaWxpdHlSZXNvdXJjZXMpIHtcbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhYmlsaXR5IHJlc291cmNlIHRvIGJlIGEgY2xhc3MgYnV0IGdvdDogJHt0eXBlb2YgcmVzb3VyY2VDbGFzc31gKVxuICAgIH1cblxuICAgIGlmIChmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyhyZXNvdXJjZUNsYXNzKSkge1xuICAgICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgICAvLyBgQmFzZVJlc291cmNlYCB0aGF0IG90aGVyIHJlc291cmNlcyBleHRlbmQpIGJhY2tzIG5vIG1vZGVsLCBzbyBpdCBpc24ndCBhXG4gICAgICAvLyBwdWJsaXNoYWJsZSBmcm9udGVuZCBtb2RlbC4gU2tpcCBpdCBpbnN0ZWFkIG9mIGxldHRpbmcgYG1vZGVsQ2xhc3MoKWBcbiAgICAgIC8vIHRocm93IGByZXF1aXJlcyBhIHN0YXRpYyBNb2RlbENsYXNzYCBkdXJpbmcgYWJpbGl0eS1yZXNvdXJjZSBkaXNjb3ZlcnkuXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgcmVzb3VyY2VzW21vZGVsTmFtZV0gPSByZXNvdXJjZUNsYXNzXG4gICAgfSBlbHNlIGlmIChyZXNvdXJjZUNsYXNzLnByb3RvdHlwZSBpbnN0YW5jZW9mIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UpIHtcbiAgICAgIC8vIEF1dGhvcml6YXRpb24tb25seSByZXNvdXJjZSDigJQgdmFsaWQgYnV0IG5vdCByZWxldmFudCBmb3IgV2ViU29ja2V0IHB1Ymxpc2hpbmdcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIGFiaWxpdHkgcmVzb3VyY2UgY2xhc3M6ICR7cmVzb3VyY2VDbGFzcy5uYW1lfS4gRXhwZWN0ZWQgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSBvciBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzLmApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlc291cmNlc1xufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGVuc3VyZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzUmVnaXN0ZXJlZCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzUmVnaXN0ZXJlZChjb25maWd1cmF0aW9uKSB7XG4gIC8qKlxuICAgKiBBbGwgZnJvbnRlbmQgbW9kZWxzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU+fSAqL1xuICBsZXQgYWxsRnJvbnRlbmRNb2RlbHMgPSB7fVxuXG4gIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgIGNvbnN0IHByb2plY3RSZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICBhbGxGcm9udGVuZE1vZGVscyA9IHsuLi5hbGxGcm9udGVuZE1vZGVscywgLi4ucHJvamVjdFJlc291cmNlc31cbiAgfVxuXG4gIC8vIEFsd2F5cyBtZXJnZSB0aGUgYWJpbGl0eSByZXNvbHZlcidzIHJlc291cmNlIGxpc3QgdG9vLiBBIHByb2plY3QgY2FuIGV4cG9zZSBzb21lXG4gIC8vIHJlc291cmNlcyBhcyBkaXNjb3ZlcmFibGUgYHNyYy9yZXNvdXJjZXMvKi5qc2AgZmlsZXMgKGNvbmZpZ3VyZWQgb3IgYXV0by1kaXNjb3ZlcmVkKVxuICAvLyBhbmQgb3RoZXJzIG9ubHkgdGhyb3VnaCBgZ2V0QWJpbGl0eVJlc291cmNlcygpYDsgYm90aCBzZXRzIG5lZWQgbGlmZWN5Y2xlIHB1Ymxpc2hlcnMsXG4gIC8vIHNvIHJlc291cmNlIGRpc2NvdmVyeSBtdXN0IG5vdCBzdXBwcmVzcyB0aGlzIGxpc3QuXG4gIGNvbnN0IGFiaWxpdHlSZXNvdXJjZXMgPSBjb25maWd1cmF0aW9uLmdldEFiaWxpdHlSZXNvdXJjZXMoKVxuXG4gIGFsbEZyb250ZW5kTW9kZWxzID0ge1xuICAgIC4uLmFsbEZyb250ZW5kTW9kZWxzLFxuICAgIC4uLmZyb250ZW5kTW9kZWxSZXNvdXJjZXNGcm9tQWJpbGl0eVJlc291cmNlc0xpc3QoYWJpbGl0eVJlc291cmNlcylcbiAgfVxuXG4gIC8vIFBoYXNlIDM6IHJlZ2lzdGVyIHRoZSBWMiBjaGFubmVsIGNsYXNzIG9uY2UgcGVyIGNvbmZpZ3VyYXRpb24gc29cbiAgLy8gYHN1YnNjcmliZUNoYW5uZWwoXCJmcm9udGVuZC1tb2RlbHNcIiwge3BhcmFtczoge21vZGVsfX0pYCBmaW5kcyBpdC5cbiAgLy8gRHluYW1pYyBpbXBvcnQga2VlcHMgc2VydmVyLW9ubHkgV2Vic29ja2V0UmVxdWVzdCArIE5vZGUgdXRpbGl0aWVzXG4gIC8vIG91dCBvZiBicm93c2VyIGJ1bmRsZXMgdGhhdCB0cmFuc2l0aXZlbHkgcHVsbCBpbiB0aGlzIG1vZHVsZSB2aWFcbiAgLy8gY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyLlxuICBpZiAoIWNoYW5uZWxDbGFzc1JlZ2lzdGVyZWRDb25maWd1cmF0aW9ucy5oYXMoY29uZmlndXJhdGlvbikpIHtcbiAgICBjaGFubmVsQ2xhc3NSZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMuYWRkKGNvbmZpZ3VyYXRpb24pXG4gICAgY29uc3Qge2RlZmF1bHQ6IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsfSA9IGF3YWl0IGltcG9ydChcIi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIilcblxuICAgIGNvbmZpZ3VyYXRpb24ucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsKVxuICB9XG5cbiAgZm9yIChjb25zdCByZXNvdXJjZUNsYXNzIG9mIE9iamVjdC52YWx1ZXMoYWxsRnJvbnRlbmRNb2RlbHMpKSB7XG4gICAgLy8gQW4gYWJzdHJhY3QgYmFzZSByZXNvdXJjZSAobm8gc3RhdGljIE1vZGVsQ2xhc3Mg4oCUIGUuZy4gYW4gYXBwJ3Mgc2hhcmVkXG4gICAgLy8gYEJhc2VSZXNvdXJjZWAgdGhhdCBvdGhlciByZXNvdXJjZXMgZXh0ZW5kKSBiYWNrcyBubyBtb2RlbCwgc28gdGhlcmUgaXNcbiAgICAvLyBub3RoaW5nIHRvIHB1Ymxpc2ggcmVhbHRpbWUgZXZlbnRzIGZvci4gU2tpcCBpdCBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICAgIGlmICghcmVzb3VyY2VDbGFzcy5Nb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gICAgLy8gUmVnaXN0ZXIgbGlmZWN5Y2xlIGhvb2tzIG9uY2UgcGVyIG1vZGVsIGNsYXNzLCBub3QgcGVyIGNvbmZpZ3VyYXRpb24uIEEgbW9kZWwgY2xhc3MgYmVsb25ncyB0byBhXG4gICAgLy8gc2luZ2xlIGJhY2tlbmQgcHJvamVjdC9jb25maWcgaW4gcHJvZHVjdGlvbiwgc28gcGVyLWNvbmZpZyByZWdpc3RyYXRpb24gb25seSBkaWZmZXJzIGluIHRlc3RzIHdoZXJlXG4gICAgLy8gdGhlIHNhbWUgbW9kZWwgY2xhc3MgaXMgcmVhY2hhYmxlIGZyb20gbXVsdGlwbGUgY29uZmlncyDigJQgdGhlcmUgaXQgYXR0YWNoZXMgZHVwbGljYXRlIGJlZm9yZUNyZWF0ZS9cbiAgICAvLyBhZnRlclNhdmUvYWZ0ZXJEZXN0cm95IGhvb2tzIHRoYXQgZG91YmxlLWZpcmUgYnJvYWRjYXN0cyAoYW5kIGxlYWsgYWNyb3NzIHNwZWNzKS4gVGhlIGhvb2tzIHJlYWQgdGhlXG4gICAgLy8gbW9kZWwncyBydW50aW1lIGNvbmZpZ3VyYXRpb24gd2hlbiBicm9hZGNhc3RpbmcsIHNvIGEgc2luZ2xlIHJlZ2lzdHJhdGlvbiBpcyBzdWZmaWNpZW50LlxuICAgIGlmIChtb2RlbENsYXNzZXNXaXRoUmVnaXN0ZXJlZEhvb2tzLmhhcyhtb2RlbENsYXNzKSkgY29udGludWVcblxuICAgIG1vZGVsQ2xhc3Nlc1dpdGhSZWdpc3RlcmVkSG9va3MuYWRkKG1vZGVsQ2xhc3MpXG5cbiAgICBtb2RlbENsYXNzLmJlZm9yZUNyZWF0ZSgobW9kZWwpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X19mcm9udGVuZE1vZGVsV2Vic29ja2V0QWN0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9fSAqLyAobW9kZWwpLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbiA9IFwiY3JlYXRlXCJcbiAgICB9KVxuXG4gICAgbW9kZWxDbGFzcy5iZWZvcmVVcGRhdGUoKG1vZGVsKSA9PiB7XG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwifX0gKi8gKG1vZGVsKS5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24gPSBcInVwZGF0ZVwiXG4gICAgfSlcblxuICAgIG1vZGVsQ2xhc3MuYWZ0ZXJTYXZlKChtb2RlbCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCAmIHtfX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIn19ICovIChtb2RlbClcbiAgICAgIGNvbnN0IGFjdGlvbiA9IG1vZGVsV2l0aFdlYnNvY2tldEFjdGlvbi5fX2Zyb250ZW5kTW9kZWxXZWJzb2NrZXRBY3Rpb25cblxuICAgICAgaWYgKGFjdGlvbiAhPT0gXCJjcmVhdGVcIiAmJiBhY3Rpb24gIT09IFwidXBkYXRlXCIpIHJldHVyblxuXG4gICAgICB2b2lkIG1vZGVsLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChtb2RlbC5fZ2V0Q29uZmlndXJhdGlvbigpLCBtb2RlbE5hbWUsIHtcbiAgICAgICAgICBhY3Rpb24sXG4gICAgICAgICAgaWQ6IG1vZGVsLmlkKCksXG4gICAgICAgICAgcmVjb3JkOiBtb2RlbC5hdHRyaWJ1dGVzKClcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgICBkZWxldGUgbW9kZWxXaXRoV2Vic29ja2V0QWN0aW9uLl9fZnJvbnRlbmRNb2RlbFdlYnNvY2tldEFjdGlvblxuICAgIH0pXG5cbiAgICBtb2RlbENsYXNzLmFmdGVyRGVzdHJveSgobW9kZWwpID0+IHtcbiAgICAgIHZvaWQgbW9kZWwuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYnJvYWRjYXN0RnJvbnRlbmRNb2RlbEV2ZW50KG1vZGVsLl9nZXRDb25maWd1cmF0aW9uKCksIG1vZGVsTmFtZSwge1xuICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgaWQ6IG1vZGVsLmlkKClcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIEZhbnMgYSBsaWZlY3ljbGUgZXZlbnQgb3V0IHRvIGFsbCBWMiBcImZyb250ZW5kLW1vZGVsc1wiIHN1YnNjcmliZXJzXG4gKiB3aG9zZSBgcGFyYW1zLm1vZGVsYCBtYXRjaGVzLiBSZWNvcmQgYXR0cmlidXRlcyBnbyB0aHJvdWdoIHRoZVxuICogdHJhbnNwb3J0IHNlcmlhbGl6ZXIgc28gRGF0ZS91bmRlZmluZWQvZXRjLiBzdXJ2aXZlIHRoZSBKU09OIGhvcC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHt7YWN0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCBpZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlY29yZD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGV2ZW50IC0gTGlmZWN5Y2xlIGV2ZW50LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJyb2FkY2FzdEZyb250ZW5kTW9kZWxFdmVudChjb25maWd1cmF0aW9uLCBtb2RlbE5hbWUsIGV2ZW50KSB7XG4gIGNvbnN0IGJvZHkgPSB7XG4gICAgYWN0aW9uOiBldmVudC5hY3Rpb24sXG4gICAgaWQ6IGV2ZW50LmlkLFxuICAgIG1vZGVsOiBtb2RlbE5hbWUsXG4gICAgLi4uKGV2ZW50LnJlY29yZCA/IHtyZWNvcmQ6IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShldmVudC5yZWNvcmQsIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSl9IDoge30pXG4gIH1cblxuICBjb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7bW9kZWw6IG1vZGVsTmFtZX0sIGJvZHkpXG59XG4iXX0=