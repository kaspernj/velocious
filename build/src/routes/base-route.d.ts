export default class VelociousBaseRoute {
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./get-route.js").default} */
    static GetRouteType: typeof import("./get-route.js").default;
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./namespace-route.js").default} */
    static NameSpaceRouteType: typeof import("./namespace-route.js").default;
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./post-route.js").default} */
    static PostRouteType: typeof import("./post-route.js").default;
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./resource-route.js").default} */
    static ResourceRouteType: typeof import("./resource-route.js").default;
    /**
     * Runs register route get type.
     * @param {typeof import("./get-route.js").default} RouteClass - Route class to register.
     */
    static registerRouteGetType(RouteClass: typeof import("./get-route.js").default): void;
    /**
     * Runs register route namespace type.
     * @param {typeof import("./namespace-route.js").default} RouteClass - Route class to register.
     */
    static registerRouteNamespaceType(RouteClass: typeof import("./namespace-route.js").default): void;
    /**
     * Runs register route post type.
     * @param {typeof import("./post-route.js").default} RouteClass - Route class to register.
     */
    static registerRoutePostType(RouteClass: typeof import("./post-route.js").default): void;
    /**
     * Runs register route resource type.
     * @param {typeof import("./resource-route.js").default} RouteClass - Route class to register.
     */
    static registerRouteResourceType(RouteClass: typeof import("./resource-route.js").default): void;
    /**
     * Routes.
     * @type {Array<VelociousBaseRoute>} */
    routes: Array<VelociousBaseRoute>;
    /**
     * Mounts.
     * @type {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ReturnType<typeof JSON.parse>>}>} */
    mounts: Array<{
        mountable: {
            mountInto: (args: object) => void;
        };
        options: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
    constructor();
    /**
     * Runs get mounts.
     * @returns {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ReturnType<typeof JSON.parse>>}>} - Mounts declared on this route.
     */
    getMounts(): Array<{
        mountable: {
            mountInto: (args: object) => void;
        };
        options: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
    /**
     * Runs get.
     * @abstract
     * @param {string} name - Name.
     */
    get(name: string): void;
    /**
     * Runs get human paths.
     * @abstract
     * @returns {Array<{action: string | null, method: string, path: string}>} - Route definitions for this resource.
     */
    getHumanPaths(): Array<{
        action: string | null;
        method: string;
        path: string;
    }>;
    /**
     * Runs get sub routes.
     * @returns {Array<VelociousBaseRoute>} - The sub routes.
     */
    getSubRoutes(): Array<VelociousBaseRoute>;
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
     * Runs namespace.
     * @abstract
     * @param {string} name - Name.
     * @param {(arg: import("./namespace-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    namespace(name: string, callback: (arg: import("./namespace-route.js").default) => void): void;
    /**
     * Runs post.
     * @abstract
     * @param {string} name - Name.
     * @returns {void} - No return value.
     */
    post(name: string): void;
    /**
     * Runs resources.
     * @abstract
     * @param {string} name - Name.
     * @param {(arg: import("./resource-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    resources(name: string, callback: (arg: import("./resource-route.js").default) => void): void;
}
//# sourceMappingURL=base-route.d.ts.map