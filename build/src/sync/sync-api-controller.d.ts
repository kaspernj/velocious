import Controller from "../controller.js";
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js";
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
    replay(): Promise<void>;
    /**
     * Renders a change-feed response from the configured sync resource.
     * @returns {Promise<void>}
     */
    changes(): Promise<void>;
    /**
     * Builds the sync resource that backs the transport endpoint.
     * @param {Record<string, unknown>} params - Request params/body.
     * @returns {FrontendModelBaseResource} Sync resource instance.
     */
    syncResource(params: Record<string, unknown>): FrontendModelBaseResource;
    /**
     * Returns the app-provided sync resource class.
     * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
     */
    syncResourceClass(): import("../configuration-types.js").FrontendModelResourceClassType;
    /**
     * Builds a sync API controller class bound to the given resource.
     * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Sync resource class.
     * @returns {typeof SyncApiController} Controller class for the resource.
     */
    static withSyncResourceClass(ResourceClass: import("../configuration-types.js").FrontendModelResourceClassType): typeof SyncApiController;
    /**
     * Mounts the standard Velocious sync endpoints into a route configuration.
     * @param {{configuration?: import("../configuration.js").default, at?: string, syncResourceClass?: import("../configuration-types.js").FrontendModelResourceClassType}} args - Mount args.
     * @returns {void}
     */
    static mountInto(args: {
        configuration?: import("../configuration.js").default;
        at?: string;
        syncResourceClass?: import("../configuration-types.js").FrontendModelResourceClassType;
    }): void;
    /**
     * Auto-mounts the sync endpoints configured through `sync.api` on a configuration.
     * No-op when `sync.api` is absent; guarded so repeated server boots with the
     * same configuration register the routes only once.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {void}
     */
    static mountFromConfiguration(configuration: import("../configuration.js").default): void;
    /**
     * Normalizes a sync mount path.
     * @param {string} at - Mount path.
     * @returns {string} Normalized mount path without trailing slash.
     */
    static normalizedMountPath(at: string): string;
    /**
     * Raises a configuration error for subclasses that do not provide a resource.
     * @returns {import("../configuration-types.js").FrontendModelResourceClassType} Sync resource class.
     */
    missingSyncResourceClass(): import("../configuration-types.js").FrontendModelResourceClassType;
    /** Raises a configuration error for subclasses that do not provide a resource. */
    raiseMissingSyncResourceClass(): void;
    /**
     * Returns the model class exposed by the sync resource.
     * @returns {typeof import("../database/record/index.js").default} Sync model class.
     */
    syncModelClass(): typeof import("../database/record/index.js").default;
    /**
     * Returns the model name used to initialize the resource.
     * @returns {string} Sync model name.
     */
    syncModelName(): string;
    /**
     * Builds the minimal resource configuration needed by the sync resource.
     * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Sync resource class.
     * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} Resource configuration.
     */
    syncResourceConfiguration(ResourceClass: import("../configuration-types.js").FrontendModelResourceClassType): import("../configuration-types.js").FrontendModelResourceConfiguration;
}
//# sourceMappingURL=sync-api-controller.d.ts.map