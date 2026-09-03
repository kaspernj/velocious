// @ts-check
import Controller from "../controller.js";
import FrontendModelBaseResource, { frontendModelResourceInternalConstructor } from "../frontend-model-resource/base-resource.js";
/** Configurations whose sync.api routes have already been mounted. */
const mountedConfigurations = new WeakSet();
/**
 * Generic `/velocious/sync` transport controller.
 *
 * Apps provide a sync resource class; Velocious owns endpoint shape and
 * rendering. The app resource owns auth, scoping, and domain-specific
 * replay/change hooks.
 */
export default class SyncApiController extends Controller {
    /**
     * Renders a replay response from the configured sync resource.
     * @returns {Promise<void>}
     */
    async replay() {
        const resource = /** @type {FrontendModelBaseResource & {replay: () => Promise<unknown>}} */ (this.syncResource(this.params()));
        await this.render({ json: /** @type {object} */ (await resource.replay()) });
    }
    /**
     * Renders a change-feed response from the configured sync resource.
     * @returns {Promise<void>}
     */
    async changes() {
        const resource = /** @type {FrontendModelBaseResource & {changes: () => Promise<unknown>}} */ (this.syncResource(this.params()));
        await this.render({ json: /** @type {object} */ (await resource.changes()) });
    }
    /**
     * Builds the sync resource that backs the transport endpoint.
     * @param {Record<string, unknown>} params - Request params/body.
     * @returns {FrontendModelBaseResource} Sync resource instance.
     */
    syncResource(params) {
        const ResourceClass = this.syncResourceClass();
        const ResourceConstructor = frontendModelResourceInternalConstructor(ResourceClass);
        const ability = this.currentAbility();
        return new ResourceConstructor({
            ability,
            controller: /** @type {import("../frontend-model-resource/base-resource.js").FrontendModelResourceController} */ ( /** @type {unknown} */(this)),
            context: {
                ...(ability?.getContext() || {}),
                params: this.params(),
                request: this.request()
            },
            locals: ability?.getLocals() || {},
            modelClass: this.syncModelClass(),
            modelName: this.syncModelName(),
            params: /** @type {import("../configuration-types.js").VelociousParams} */ ( /** @type {unknown} */(params)),
            resourceConfiguration: this.syncResourceConfiguration(ResourceClass)
        });
    }
    /**
     * Returns the app-provided sync resource class.
     * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
     */
    syncResourceClass() {
        return this.missingSyncResourceClass();
    }
    /**
     * Builds a sync API controller class bound to the given resource.
     * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Sync resource class.
     * @returns {typeof SyncApiController} Controller class for the resource.
     */
    static withSyncResourceClass(ResourceClass) {
        return class ConfiguredSyncApiController extends this {
            /**
             * Returns the configured sync resource class.
             * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
             */
            syncResourceClass() {
                return ResourceClass;
            }
        };
    }
    /**
     * Mounts the standard Velocious sync endpoints into a route configuration.
     * @param {{configuration?: import("../configuration.js").default, at?: string, syncResourceClass?: import("../configuration-types.js").FrontendModelResourceClassType}} args - Mount args.
     * @returns {void}
     */
    static mountInto(args) {
        const { configuration, syncResourceClass } = args;
        const ControllerClass = syncResourceClass ? this.withSyncResourceClass(syncResourceClass) : this;
        const at = this.normalizedMountPath(args.at || "/velocious/sync");
        if (!configuration)
            throw new Error("SyncApiController.mountInto requires configuration");
        configuration.routes((routes) => {
            routes.post(`${at}/changes`, { to: [ControllerClass, "changes"] });
            routes.post(`${at}/replay`, { to: [ControllerClass, "replay"] });
        });
    }
    /**
     * Auto-mounts the sync endpoints configured through `sync.api` on a configuration.
     * No-op when `sync.api` is absent; guarded so repeated server boots with the
     * same configuration register the routes only once.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {void}
     */
    static mountFromConfiguration(configuration) {
        const api = configuration.getSyncConfiguration().api;
        if (!api || mountedConfigurations.has(configuration))
            return;
        mountedConfigurations.add(configuration);
        this.mountInto({ at: api.mountPath, configuration, syncResourceClass: api.resourceClass });
    }
    /**
     * Normalizes a sync mount path.
     * @param {string} at - Mount path.
     * @returns {string} Normalized mount path without trailing slash.
     */
    static normalizedMountPath(at) {
        if (typeof at !== "string" || !at.startsWith("/")) {
            throw new Error(`SyncApiController mount path must start with '/', got: ${String(at)}`);
        }
        return at.replace(/\/+$/u, "") || "/";
    }
    /**
     * Raises a configuration error for subclasses that do not provide a resource.
     * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
     */
    missingSyncResourceClass() {
        return /** @type {import("../configuration-types.js").FrontendModelResourceClassType} */ ( /** @type {unknown} */(this.raiseMissingSyncResourceClass()));
    }
    /** Raises a configuration error for subclasses that do not provide a resource. */
    raiseMissingSyncResourceClass() {
        throw new Error("SyncApiController.syncResourceClass must be implemented");
    }
    /**
     * Returns the model class exposed by the sync resource.
     * @returns {typeof import("../database/record/index.js").default} Sync model class.
     */
    syncModelClass() {
        const ResourceClass = this.syncResourceClass();
        const modelClass = ResourceClass.ModelClass;
        if (!modelClass)
            throw new Error("Sync resource class must define static ModelClass");
        return /** @type {typeof import("../database/record/index.js").default} */ ( /** @type {unknown} */(modelClass));
    }
    /**
     * Returns the model name used to initialize the resource.
     * @returns {string} Sync model name.
     */
    syncModelName() {
        return this.syncModelClass().name;
    }
    /**
     * Builds the minimal resource configuration needed by the sync resource.
     * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Sync resource class.
     * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} Resource configuration.
     */
    syncResourceConfiguration(ResourceClass) {
        return /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({
            attributes: ResourceClass.attributes || {},
            sync: { enabled: true }
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtYXBpLWNvbnRyb2xsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8seUJBQXlCLEVBQUUsRUFBQyx3Q0FBd0MsRUFBQyxNQUFNLDZDQUE2QyxDQUFBO0FBRS9ILHNFQUFzRTtBQUN0RSxNQUFNLHFCQUFxQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFM0M7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQkFBa0IsU0FBUSxVQUFVO0lBQ3ZEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxNQUFNO1FBQ1YsTUFBTSxRQUFRLEdBQUcsMkVBQTJFLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFFL0gsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUMsSUFBSSxFQUFFLHFCQUFxQixDQUFDLENBQUMsTUFBTSxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUE7SUFDNUUsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxRQUFRLEdBQUcsNEVBQTRFLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFFaEksTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUMsSUFBSSxFQUFFLHFCQUFxQixDQUFDLENBQUMsTUFBTSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUE7SUFDN0UsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZLENBQUMsTUFBTTtRQUNqQixNQUFNLGFBQWEsR0FBRyxJQUFJLENB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QUMxQyxJQUFJLEVBQUUsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFDO1NBQ3RCLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29udHJvbGxlciBmcm9tIFwiLi4vY29udHJvbGxlci5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSwge2Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3J9IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcblxuLyoqIENvbmZpZ3VyYXRpb25zIHdob3NlIHN5bmMuYXBpIHJvdXRlcyBoYXZlIGFscmVhZHkgYmVlbiBtb3VudGVkLiAqL1xuY29uc3QgbW91bnRlZENvbmZpZ3VyYXRpb25zID0gbmV3IFdlYWtTZXQoKVxuXG4vKipcbiAqIEdlbmVyaWMgYC92ZWxvY2lvdXMvc3luY2AgdHJhbnNwb3J0IGNvbnRyb2xsZXIuXG4gKlxuICogQXBwcyBwcm92aWRlIGEgc3luYyByZXNvdXJjZSBjbGFzczsgVmVsb2Npb3VzIG93bnMgZW5kcG9pbnQgc2hhcGUgYW5kXG4gKiByZW5kZXJpbmcuIFRoZSBhcHAgcmVzb3VyY2Ugb3ducyBhdXRoLCBzY29waW5nLCBhbmQgZG9tYWluLXNwZWNpZmljXG4gKiByZXBsYXkvY2hhbmdlIGhvb2tzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jQXBpQ29udHJvbGxlciBleHRlbmRzIENvbnRyb2xsZXIge1xuICAvKipcbiAgICogUmVuZGVycyBhIHJlcGxheSByZXNwb25zZSBmcm9tIHRoZSBjb25maWd1cmVkIHN5bmMgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwbGF5KCkge1xuICAgIGNvbnN0IHJlc291cmNlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlICYge3JlcGxheTogKCkgPT4gUHJvbWlzZTx1bmtub3duPn19ICovICh0aGlzLnN5bmNSZXNvdXJjZSh0aGlzLnBhcmFtcygpKSlcblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiAvKiogQHR5cGUge29iamVjdH0gKi8gKGF3YWl0IHJlc291cmNlLnJlcGxheSgpKX0pXG4gIH1cblxuICAvKipcbiAgICogUmVuZGVycyBhIGNoYW5nZS1mZWVkIHJlc3BvbnNlIGZyb20gdGhlIGNvbmZpZ3VyZWQgc3luYyByZXNvdXJjZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjaGFuZ2VzKCkge1xuICAgIGNvbnN0IHJlc291cmNlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlICYge2NoYW5nZXM6ICgpID0+IFByb21pc2U8dW5rbm93bj59fSAqLyAodGhpcy5zeW5jUmVzb3VyY2UodGhpcy5wYXJhbXMoKSkpXG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7anNvbjogLyoqIEB0eXBlIHtvYmplY3R9ICovIChhd2FpdCByZXNvdXJjZS5jaGFuZ2VzKCkpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHN5bmMgcmVzb3VyY2UgdGhhdCBiYWNrcyB0aGUgdHJhbnNwb3J0IGVuZHBvaW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy9ib2R5LlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gU3luYyByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICovXG4gIHN5bmNSZXNvdXJjZShwYXJhbXMpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gdGhpcy5zeW5jUmVzb3VyY2VDbGFzcygpXG4gICAgY29uc3QgUmVzb3VyY2VDb25zdHJ1Y3RvciA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoUmVzb3VyY2VDbGFzcylcbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5jdXJyZW50QWJpbGl0eSgpXG5cbiAgICByZXR1cm4gbmV3IFJlc291cmNlQ29uc3RydWN0b3Ioe1xuICAgICAgYWJpbGl0eSxcbiAgICAgIGNvbnRyb2xsZXI6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcykpLFxuICAgICAgY29udGV4dDoge1xuICAgICAgICAuLi4oYWJpbGl0eT8uZ2V0Q29udGV4dCgpIHx8IHt9KSxcbiAgICAgICAgcGFyYW1zOiB0aGlzLnBhcmFtcygpLFxuICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QoKVxuICAgICAgfSxcbiAgICAgIGxvY2FsczogYWJpbGl0eT8uZ2V0TG9jYWxzKCkgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLnN5bmNNb2RlbENsYXNzKCksXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuc3luY01vZGVsTmFtZSgpLFxuICAgICAgcGFyYW1zOiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAocGFyYW1zKSksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHRoaXMuc3luY1Jlc291cmNlQ29uZmlndXJhdGlvbihSZXNvdXJjZUNsYXNzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwLXByb3ZpZGVkIHN5bmMgcmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gU3luYyByZXNvdXJjZSBjbGFzcy5cbiAgICovXG4gIHN5bmNSZXNvdXJjZUNsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLm1pc3NpbmdTeW5jUmVzb3VyY2VDbGFzcygpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3luYyBBUEkgY29udHJvbGxlciBjbGFzcyBib3VuZCB0byB0aGUgZ2l2ZW4gcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBTeW5jIHJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFN5bmNBcGlDb250cm9sbGVyfSBDb250cm9sbGVyIGNsYXNzIGZvciB0aGUgcmVzb3VyY2UuXG4gICAqL1xuICBzdGF0aWMgd2l0aFN5bmNSZXNvdXJjZUNsYXNzKFJlc291cmNlQ2xhc3MpIHtcbiAgICByZXR1cm4gY2xhc3MgQ29uZmlndXJlZFN5bmNBcGlDb250cm9sbGVyIGV4dGVuZHMgdGhpcyB7XG4gICAgICAvKipcbiAgICAgICAqIFJldHVybnMgdGhlIGNvbmZpZ3VyZWQgc3luYyByZXNvdXJjZSBjbGFzcy5cbiAgICAgICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gU3luYyByZXNvdXJjZSBjbGFzcy5cbiAgICAgICAqL1xuICAgICAgc3luY1Jlc291cmNlQ2xhc3MoKSB7XG4gICAgICAgIHJldHVybiBSZXNvdXJjZUNsYXNzXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdW50cyB0aGUgc3RhbmRhcmQgVmVsb2Npb3VzIHN5bmMgZW5kcG9pbnRzIGludG8gYSByb3V0ZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uPzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBhdD86IHN0cmluZywgc3luY1Jlc291cmNlQ2xhc3M/OiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX19IGFyZ3MgLSBNb3VudCBhcmdzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBtb3VudEludG8oYXJncykge1xuICAgIGNvbnN0IHtjb25maWd1cmF0aW9uLCBzeW5jUmVzb3VyY2VDbGFzc30gPSBhcmdzXG4gICAgY29uc3QgQ29udHJvbGxlckNsYXNzID0gc3luY1Jlc291cmNlQ2xhc3MgPyB0aGlzLndpdGhTeW5jUmVzb3VyY2VDbGFzcyhzeW5jUmVzb3VyY2VDbGFzcykgOiB0aGlzXG4gICAgY29uc3QgYXQgPSB0aGlzLm5vcm1hbGl6ZWRNb3VudFBhdGgoYXJncy5hdCB8fCBcIi92ZWxvY2lvdXMvc3luY1wiKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQXBpQ29udHJvbGxlci5tb3VudEludG8gcmVxdWlyZXMgY29uZmlndXJhdGlvblwiKVxuXG4gICAgY29uZmlndXJhdGlvbi5yb3V0ZXMoKHJvdXRlcykgPT4ge1xuICAgICAgcm91dGVzLnBvc3QoYCR7YXR9L2NoYW5nZXNgLCB7dG86IFtDb250cm9sbGVyQ2xhc3MsIFwiY2hhbmdlc1wiXX0pXG4gICAgICByb3V0ZXMucG9zdChgJHthdH0vcmVwbGF5YCwge3RvOiBbQ29udHJvbGxlckNsYXNzLCBcInJlcGxheVwiXX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRvLW1vdW50cyB0aGUgc3luYyBlbmRwb2ludHMgY29uZmlndXJlZCB0aHJvdWdoIGBzeW5jLmFwaWAgb24gYSBjb25maWd1cmF0aW9uLlxuICAgKiBOby1vcCB3aGVuIGBzeW5jLmFwaWAgaXMgYWJzZW50OyBndWFyZGVkIHNvIHJlcGVhdGVkIHNlcnZlciBib290cyB3aXRoIHRoZVxuICAgKiBzYW1lIGNvbmZpZ3VyYXRpb24gcmVnaXN0ZXIgdGhlIHJvdXRlcyBvbmx5IG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgbW91bnRGcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgYXBpID0gY29uZmlndXJhdGlvbi5nZXRTeW5jQ29uZmlndXJhdGlvbigpLmFwaVxuXG4gICAgaWYgKCFhcGkgfHwgbW91bnRlZENvbmZpZ3VyYXRpb25zLmhhcyhjb25maWd1cmF0aW9uKSkgcmV0dXJuXG5cbiAgICBtb3VudGVkQ29uZmlndXJhdGlvbnMuYWRkKGNvbmZpZ3VyYXRpb24pXG5cbiAgICB0aGlzLm1vdW50SW50byh7YXQ6IGFwaS5tb3VudFBhdGgsIGNvbmZpZ3VyYXRpb24sIHN5bmNSZXNvdXJjZUNsYXNzOiBhcGkucmVzb3VyY2VDbGFzc30pXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHN5bmMgbW91bnQgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0IC0gTW91bnQgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gTm9ybWFsaXplZCBtb3VudCBwYXRoIHdpdGhvdXQgdHJhaWxpbmcgc2xhc2guXG4gICAqL1xuICBzdGF0aWMgbm9ybWFsaXplZE1vdW50UGF0aChhdCkge1xuICAgIGlmICh0eXBlb2YgYXQgIT09IFwic3RyaW5nXCIgfHwgIWF0LnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNBcGlDb250cm9sbGVyIG1vdW50IHBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhhdCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gYXQucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlzZXMgYSBjb25maWd1cmF0aW9uIGVycm9yIGZvciBzdWJjbGFzc2VzIHRoYXQgZG8gbm90IHByb3ZpZGUgYSByZXNvdXJjZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBTeW5jIHJlc291cmNlIGNsYXNzLlxuICAgKi9cbiAgbWlzc2luZ1N5bmNSZXNvdXJjZUNsYXNzKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcy5yYWlzZU1pc3NpbmdTeW5jUmVzb3VyY2VDbGFzcygpKSlcbiAgfVxuXG4gIC8qKiBSYWlzZXMgYSBjb25maWd1cmF0aW9uIGVycm9yIGZvciBzdWJjbGFzc2VzIHRoYXQgZG8gbm90IHByb3ZpZGUgYSByZXNvdXJjZS4gKi9cbiAgcmFpc2VNaXNzaW5nU3luY1Jlc291cmNlQ2xhc3MoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0FwaUNvbnRyb2xsZXIuc3luY1Jlc291cmNlQ2xhc3MgbXVzdCBiZSBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG1vZGVsIGNsYXNzIGV4cG9zZWQgYnkgdGhlIHN5bmMgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzeW5jTW9kZWxDbGFzcygpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gdGhpcy5zeW5jUmVzb3VyY2VDbGFzcygpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IFJlc291cmNlQ2xhc3MuTW9kZWxDbGFzc1xuXG4gICAgaWYgKCFtb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIHJlc291cmNlIGNsYXNzIG11c3QgZGVmaW5lIHN0YXRpYyBNb2RlbENsYXNzXCIpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChtb2RlbENsYXNzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBtb2RlbCBuYW1lIHVzZWQgdG8gaW5pdGlhbGl6ZSB0aGUgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFN5bmMgbW9kZWwgbmFtZS5cbiAgICovXG4gIHN5bmNNb2RlbE5hbWUoKSB7XG4gICAgcmV0dXJuIHRoaXMuc3luY01vZGVsQ2xhc3MoKS5uYW1lXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBtaW5pbWFsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gbmVlZGVkIGJ5IHRoZSBzeW5jIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gU3luYyByZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gUmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN5bmNSZXNvdXJjZUNvbmZpZ3VyYXRpb24oUmVzb3VyY2VDbGFzcykge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHtcbiAgICAgIGF0dHJpYnV0ZXM6IFJlc291cmNlQ2xhc3MuYXR0cmlidXRlcyB8fCB7fSxcbiAgICAgIHN5bmM6IHtlbmFibGVkOiB0cnVlfVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==