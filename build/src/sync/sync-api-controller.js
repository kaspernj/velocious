// @ts-check
import Controller from "../controller.js";
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js";
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
        const ability = this.currentAbility();
        return new ResourceClass({
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
        return modelClass;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtYXBpLWNvbnRyb2xsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8seUJBQXlCLE1BQU0sNkNBQTZDLENBQUE7QUFFbkYsc0VBQXNFO0FBQ3RFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUzQzs7Ozs7O0dBTUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGlCQUFrQixTQUFRLFVBQVU7SUFDdkQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixNQUFNLFFBQVEsR0FBRywyRUFBMkUsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUUvSCxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBQyxJQUFJLEVBQUUscUJBQXFCLENBQUMsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFDLENBQUMsQ0FBQTtJQUM1RSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLFFBQVEsR0FBRyw0RUFBNEUsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUVoSSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBQyxJQUFJLEVBQUUscUJBQXFCLENBQUMsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxFQUFDLENBQUMsQ0FBQTtJQUM3RSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFlBQVksQ0FBQyxNQUFNO1FBQ2pCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQzlDLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUVyQyxPQUFPLElBQUksYUFBYSxDQUFDO1lBQ3ZCLE9BQU87WUFDUCxVQUFVLEVBQUUsb0dBQW9HLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNoSixPQUFPLEVBQUU7Z0JBQ1AsR0FBRyxDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLENBQUM7Z0JBQ2hDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFO2dCQUNyQixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRTthQUN4QjtZQUNELE1BQU0sRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRTtZQUNsQyxVQUFVLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRTtZQUNqQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRTtZQUMvQixNQUFNLEVBQUUsa0VBQWtFLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUM1RyxxQkFBcUIsRUFBRSxJQUFJLENBQUMseUJBQXlCLENBQUMsYUFBYSxDQUFDO1NBQ3JFLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxpQkFBaUI7UUFDZixPQUFPLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLHFCQUFxQixDQUFDLGFBQWE7UUFDeEMsT0FBTyxNQUFNLDJCQUE0QixTQUFRLElBQUk7WUFDbkQ7OztlQUdHO1lBQ0gsaUJBQWlCO2dCQUNmLE9BQU8sYUFBYSxDQUFBO1lBQ3RCLENBQUM7U0FDRixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUk7UUFDbkIsTUFBTSxFQUFDLGFBQWEsRUFBRSxpQkFBaUIsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUMvQyxNQUFNLGVBQWUsR0FBRyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUNoRyxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxpQkFBaUIsQ0FBQyxDQUFBO1FBRWpFLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvREFBb0QsQ0FBQyxDQUFBO1FBRXpGLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTtZQUM5QixNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxVQUFVLEVBQUUsRUFBQyxFQUFFLEVBQUUsQ0FBQyxlQUFlLEVBQUUsU0FBUyxDQUFDLEVBQUMsQ0FBQyxDQUFBO1lBQ2hFLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLFNBQVMsRUFBRSxFQUFDLEVBQUUsRUFBRSxDQUFDLGVBQWUsRUFBRSxRQUFRLENBQUMsRUFBQyxDQUFDLENBQUE7UUFDaEUsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLHNCQUFzQixDQUFDLGFBQWE7UUFDekMsTUFBTSxHQUFHLEdBQUcsYUFBYSxDQUFDLG9CQUFvQixFQUFFLENBQUMsR0FBRyxDQUFBO1FBRXBELElBQUksQ0FBQyxHQUFHLElBQUkscUJBQXFCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQztZQUFFLE9BQU07UUFFNUQscUJBQXFCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRXhDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7SUFDMUYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsbUJBQW1CLENBQUMsRUFBRTtRQUMzQixJQUFJLE9BQU8sRUFBRSxLQUFLLFFBQVEsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLElBQUksS0FBSyxDQUFDLDBEQUEwRCxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ3pGLENBQUM7UUFFRCxPQUFPLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxJQUFJLEdBQUcsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsd0JBQXdCO1FBQ3RCLE9BQU8saUZBQWlGLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQyxDQUFDLENBQUE7SUFDMUosQ0FBQztJQUVELGtGQUFrRjtJQUNsRiw2QkFBNkI7UUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsQ0FBQyxDQUFBO0lBQzVFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjO1FBQ1osTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDOUMsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLFVBQVUsQ0FBQTtRQUUzQyxJQUFJLENBQUMsVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbURBQW1ELENBQUMsQ0FBQTtRQUVyRixPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsYUFBYTtRQUNYLE9BQU8sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLElBQUksQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHlCQUF5QixDQUFDLGFBQWE7UUFDckMsT0FBTyxxRkFBcUYsQ0FBQyxDQUFDO1lBQzVGLFVBQVUsRUFBRSxhQUFhLENBQUMsVUFBVSxJQUFJLEVBQUU7WUFDMUMsSUFBSSxFQUFFLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBQztTQUN0QixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbnRyb2xsZXIgZnJvbSBcIi4uL2NvbnRyb2xsZXIuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIlxuXG4vKiogQ29uZmlndXJhdGlvbnMgd2hvc2Ugc3luYy5hcGkgcm91dGVzIGhhdmUgYWxyZWFkeSBiZWVuIG1vdW50ZWQuICovXG5jb25zdCBtb3VudGVkQ29uZmlndXJhdGlvbnMgPSBuZXcgV2Vha1NldCgpXG5cbi8qKlxuICogR2VuZXJpYyBgL3ZlbG9jaW91cy9zeW5jYCB0cmFuc3BvcnQgY29udHJvbGxlci5cbiAqXG4gKiBBcHBzIHByb3ZpZGUgYSBzeW5jIHJlc291cmNlIGNsYXNzOyBWZWxvY2lvdXMgb3ducyBlbmRwb2ludCBzaGFwZSBhbmRcbiAqIHJlbmRlcmluZy4gVGhlIGFwcCByZXNvdXJjZSBvd25zIGF1dGgsIHNjb3BpbmcsIGFuZCBkb21haW4tc3BlY2lmaWNcbiAqIHJlcGxheS9jaGFuZ2UgaG9va3MuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNBcGlDb250cm9sbGVyIGV4dGVuZHMgQ29udHJvbGxlciB7XG4gIC8qKlxuICAgKiBSZW5kZXJzIGEgcmVwbGF5IHJlc3BvbnNlIGZyb20gdGhlIGNvbmZpZ3VyZWQgc3luYyByZXNvdXJjZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBsYXkoKSB7XG4gICAgY29uc3QgcmVzb3VyY2UgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgJiB7cmVwbGF5OiAoKSA9PiBQcm9taXNlPHVua25vd24+fX0gKi8gKHRoaXMuc3luY1Jlc291cmNlKHRoaXMucGFyYW1zKCkpKVxuXG4gICAgYXdhaXQgdGhpcy5yZW5kZXIoe2pzb246IC8qKiBAdHlwZSB7b2JqZWN0fSAqLyAoYXdhaXQgcmVzb3VyY2UucmVwbGF5KCkpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW5kZXJzIGEgY2hhbmdlLWZlZWQgcmVzcG9uc2UgZnJvbSB0aGUgY29uZmlndXJlZCBzeW5jIHJlc291cmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNoYW5nZXMoKSB7XG4gICAgY29uc3QgcmVzb3VyY2UgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgJiB7Y2hhbmdlczogKCkgPT4gUHJvbWlzZTx1bmtub3duPn19ICovICh0aGlzLnN5bmNSZXNvdXJjZSh0aGlzLnBhcmFtcygpKSlcblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiAvKiogQHR5cGUge29iamVjdH0gKi8gKGF3YWl0IHJlc291cmNlLmNoYW5nZXMoKSl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3luYyByZXNvdXJjZSB0aGF0IGJhY2tzIHRoZSB0cmFuc3BvcnQgZW5kcG9pbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zL2JvZHkuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSBTeW5jIHJlc291cmNlIGluc3RhbmNlLlxuICAgKi9cbiAgc3luY1Jlc291cmNlKHBhcmFtcykge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSB0aGlzLnN5bmNSZXNvdXJjZUNsYXNzKClcbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5jdXJyZW50QWJpbGl0eSgpXG5cbiAgICByZXR1cm4gbmV3IFJlc291cmNlQ2xhc3Moe1xuICAgICAgYWJpbGl0eSxcbiAgICAgIGNvbnRyb2xsZXI6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcykpLFxuICAgICAgY29udGV4dDoge1xuICAgICAgICAuLi4oYWJpbGl0eT8uZ2V0Q29udGV4dCgpIHx8IHt9KSxcbiAgICAgICAgcGFyYW1zOiB0aGlzLnBhcmFtcygpLFxuICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QoKVxuICAgICAgfSxcbiAgICAgIGxvY2FsczogYWJpbGl0eT8uZ2V0TG9jYWxzKCkgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLnN5bmNNb2RlbENsYXNzKCksXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuc3luY01vZGVsTmFtZSgpLFxuICAgICAgcGFyYW1zOiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAocGFyYW1zKSksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHRoaXMuc3luY1Jlc291cmNlQ29uZmlndXJhdGlvbihSZXNvdXJjZUNsYXNzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwLXByb3ZpZGVkIHN5bmMgcmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gU3luYyByZXNvdXJjZSBjbGFzcy5cbiAgICovXG4gIHN5bmNSZXNvdXJjZUNsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLm1pc3NpbmdTeW5jUmVzb3VyY2VDbGFzcygpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3luYyBBUEkgY29udHJvbGxlciBjbGFzcyBib3VuZCB0byB0aGUgZ2l2ZW4gcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBTeW5jIHJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFN5bmNBcGlDb250cm9sbGVyfSBDb250cm9sbGVyIGNsYXNzIGZvciB0aGUgcmVzb3VyY2UuXG4gICAqL1xuICBzdGF0aWMgd2l0aFN5bmNSZXNvdXJjZUNsYXNzKFJlc291cmNlQ2xhc3MpIHtcbiAgICByZXR1cm4gY2xhc3MgQ29uZmlndXJlZFN5bmNBcGlDb250cm9sbGVyIGV4dGVuZHMgdGhpcyB7XG4gICAgICAvKipcbiAgICAgICAqIFJldHVybnMgdGhlIGNvbmZpZ3VyZWQgc3luYyByZXNvdXJjZSBjbGFzcy5cbiAgICAgICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gU3luYyByZXNvdXJjZSBjbGFzcy5cbiAgICAgICAqL1xuICAgICAgc3luY1Jlc291cmNlQ2xhc3MoKSB7XG4gICAgICAgIHJldHVybiBSZXNvdXJjZUNsYXNzXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdW50cyB0aGUgc3RhbmRhcmQgVmVsb2Npb3VzIHN5bmMgZW5kcG9pbnRzIGludG8gYSByb3V0ZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uPzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBhdD86IHN0cmluZywgc3luY1Jlc291cmNlQ2xhc3M/OiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX19IGFyZ3MgLSBNb3VudCBhcmdzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBtb3VudEludG8oYXJncykge1xuICAgIGNvbnN0IHtjb25maWd1cmF0aW9uLCBzeW5jUmVzb3VyY2VDbGFzc30gPSBhcmdzXG4gICAgY29uc3QgQ29udHJvbGxlckNsYXNzID0gc3luY1Jlc291cmNlQ2xhc3MgPyB0aGlzLndpdGhTeW5jUmVzb3VyY2VDbGFzcyhzeW5jUmVzb3VyY2VDbGFzcykgOiB0aGlzXG4gICAgY29uc3QgYXQgPSB0aGlzLm5vcm1hbGl6ZWRNb3VudFBhdGgoYXJncy5hdCB8fCBcIi92ZWxvY2lvdXMvc3luY1wiKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQXBpQ29udHJvbGxlci5tb3VudEludG8gcmVxdWlyZXMgY29uZmlndXJhdGlvblwiKVxuXG4gICAgY29uZmlndXJhdGlvbi5yb3V0ZXMoKHJvdXRlcykgPT4ge1xuICAgICAgcm91dGVzLnBvc3QoYCR7YXR9L2NoYW5nZXNgLCB7dG86IFtDb250cm9sbGVyQ2xhc3MsIFwiY2hhbmdlc1wiXX0pXG4gICAgICByb3V0ZXMucG9zdChgJHthdH0vcmVwbGF5YCwge3RvOiBbQ29udHJvbGxlckNsYXNzLCBcInJlcGxheVwiXX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRvLW1vdW50cyB0aGUgc3luYyBlbmRwb2ludHMgY29uZmlndXJlZCB0aHJvdWdoIGBzeW5jLmFwaWAgb24gYSBjb25maWd1cmF0aW9uLlxuICAgKiBOby1vcCB3aGVuIGBzeW5jLmFwaWAgaXMgYWJzZW50OyBndWFyZGVkIHNvIHJlcGVhdGVkIHNlcnZlciBib290cyB3aXRoIHRoZVxuICAgKiBzYW1lIGNvbmZpZ3VyYXRpb24gcmVnaXN0ZXIgdGhlIHJvdXRlcyBvbmx5IG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgbW91bnRGcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgYXBpID0gY29uZmlndXJhdGlvbi5nZXRTeW5jQ29uZmlndXJhdGlvbigpLmFwaVxuXG4gICAgaWYgKCFhcGkgfHwgbW91bnRlZENvbmZpZ3VyYXRpb25zLmhhcyhjb25maWd1cmF0aW9uKSkgcmV0dXJuXG5cbiAgICBtb3VudGVkQ29uZmlndXJhdGlvbnMuYWRkKGNvbmZpZ3VyYXRpb24pXG5cbiAgICB0aGlzLm1vdW50SW50byh7YXQ6IGFwaS5tb3VudFBhdGgsIGNvbmZpZ3VyYXRpb24sIHN5bmNSZXNvdXJjZUNsYXNzOiBhcGkucmVzb3VyY2VDbGFzc30pXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHN5bmMgbW91bnQgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0IC0gTW91bnQgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gTm9ybWFsaXplZCBtb3VudCBwYXRoIHdpdGhvdXQgdHJhaWxpbmcgc2xhc2guXG4gICAqL1xuICBzdGF0aWMgbm9ybWFsaXplZE1vdW50UGF0aChhdCkge1xuICAgIGlmICh0eXBlb2YgYXQgIT09IFwic3RyaW5nXCIgfHwgIWF0LnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNBcGlDb250cm9sbGVyIG1vdW50IHBhdGggbXVzdCBzdGFydCB3aXRoICcvJywgZ290OiAke1N0cmluZyhhdCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gYXQucmVwbGFjZSgvXFwvKyQvdSwgXCJcIikgfHwgXCIvXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlzZXMgYSBjb25maWd1cmF0aW9uIGVycm9yIGZvciBzdWJjbGFzc2VzIHRoYXQgZG8gbm90IHByb3ZpZGUgYSByZXNvdXJjZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBTeW5jIHJlc291cmNlIGNsYXNzLlxuICAgKi9cbiAgbWlzc2luZ1N5bmNSZXNvdXJjZUNsYXNzKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcy5yYWlzZU1pc3NpbmdTeW5jUmVzb3VyY2VDbGFzcygpKSlcbiAgfVxuXG4gIC8qKiBSYWlzZXMgYSBjb25maWd1cmF0aW9uIGVycm9yIGZvciBzdWJjbGFzc2VzIHRoYXQgZG8gbm90IHByb3ZpZGUgYSByZXNvdXJjZS4gKi9cbiAgcmFpc2VNaXNzaW5nU3luY1Jlc291cmNlQ2xhc3MoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0FwaUNvbnRyb2xsZXIuc3luY1Jlc291cmNlQ2xhc3MgbXVzdCBiZSBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG1vZGVsIGNsYXNzIGV4cG9zZWQgYnkgdGhlIHN5bmMgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzeW5jTW9kZWxDbGFzcygpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gdGhpcy5zeW5jUmVzb3VyY2VDbGFzcygpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IFJlc291cmNlQ2xhc3MuTW9kZWxDbGFzc1xuXG4gICAgaWYgKCFtb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIHJlc291cmNlIGNsYXNzIG11c3QgZGVmaW5lIHN0YXRpYyBNb2RlbENsYXNzXCIpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG1vZGVsIG5hbWUgdXNlZCB0byBpbml0aWFsaXplIHRoZSByZXNvdXJjZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gU3luYyBtb2RlbCBuYW1lLlxuICAgKi9cbiAgc3luY01vZGVsTmFtZSgpIHtcbiAgICByZXR1cm4gdGhpcy5zeW5jTW9kZWxDbGFzcygpLm5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIG1pbmltYWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBuZWVkZWQgYnkgdGhlIHN5bmMgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBTeW5jIHJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBSZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3luY1Jlc291cmNlQ29uZmlndXJhdGlvbihSZXNvdXJjZUNsYXNzKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqLyAoe1xuICAgICAgYXR0cmlidXRlczogUmVzb3VyY2VDbGFzcy5hdHRyaWJ1dGVzIHx8IHt9LFxuICAgICAgc3luYzoge2VuYWJsZWQ6IHRydWV9XG4gICAgfSlcbiAgfVxufVxuIl19