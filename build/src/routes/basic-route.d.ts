import BaseRoute from "./base-route.js";
export default class VelociousBasicRoute extends BaseRoute {
    /**
     * Runs get.
     * @param {string} name - Route name.
     */
    get(name: string): void;
    /**
     * Runs match with path.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Parameters object.
     * @param {string} args.path - Path.
     * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
     * @returns {{restPath: string} | undefined} - REST path metadata for this route.
     */
    matchWithPath({ params, path, request }: {
        params: Record<string, ReturnType<typeof JSON.parse>>;
        path: string;
        request: import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default;
    }): {
        restPath: string;
    } | undefined;
    /**
     * Mounts a sub-application (e.g. the background-jobs dashboard API) at a path
     * prefix, similar to mounting Sidekiq::Web in a Rails routes file. The
     * mountable's `mountInto({configuration, ...options})` is invoked when the
     * configuration receives the routes.
     * @param {{mountInto: (args: object) => void}} mountable - Mountable with a static `mountInto` method.
     * @param {object} [options] - Mount options. Must include an `at` path prefix starting with "/".
     * @returns {void} - No return value.
     */
    mount(mountable: {
        mountInto: (args: object) => void;
    }, options?: object): void;
    /**
     * Runs namespace.
     * @param {string} name - Name.
     * @param {(arg: import("./namespace-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    namespace(name: string, callback: (arg: import("./namespace-route.js").default) => void): void;
    /**
     * Runs post.
     * @param {string} name - Name.
     * @returns {void} - No return value.
     */
    post(name: string): void;
    /**
     * Runs resources.
     * @param {string} name - Name.
     * @param {(arg: import("./resource-route.js").default) => void} [callback] - Callback function.
     * @returns {void} - No return value.
     */
    resources(name: string, callback?: (arg: import("./resource-route.js").default) => void): void;
}
//# sourceMappingURL=basic-route.d.ts.map