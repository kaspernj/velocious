/**
 * AddRouteOptions type.
 * @typedef {object} AddRouteOptions
 * @property {Record<string, ReturnType<typeof JSON.parse>>} [params] - Static params to merge for matched route.
 * @property {[typeof import("../controller.js").default, string]} to - Controller class and action tuple.
 * @property {string} [viewPath] - Optional view path for controllers using renderView().
 */
export type AddRouteOptions = {
    /**
     * - Static params to merge for matched route.
     */
    params?: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Controller class and action tuple.
     */
    to: [typeof import("../controller.js").default, string];
    /**
     * - Optional view path for controllers using renderView().
     */
    viewPath?: string;
};
/** Lightweight plugin route DSL for route-hook backed endpoints. */
export default class PluginRoutes {
    configuration: import("../configuration.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor(args: {
        configuration: import("../configuration.js").default;
    });
    /**
     * Runs get.
     * @param {string} routePath - Route path.
     * @param {AddRouteOptions} options - Route options.
     * @returns {void} - No return value.
     */
    get(routePath: string, options: AddRouteOptions): void;
    /**
     * Runs post.
     * @param {string} routePath - Route path.
     * @param {AddRouteOptions} options - Route options.
     * @returns {void} - No return value.
     */
    post(routePath: string, options: AddRouteOptions): void;
    /**
     * Runs add route.
     * @param {"GET" | "POST"} method - HTTP method.
     * @param {string} routePath - Route path.
     * @param {AddRouteOptions} options - Route options.
     * @returns {void} - No return value.
     */
    addRoute(method: "GET" | "POST", routePath: string, options: AddRouteOptions): void;
    /**
     * Runs match path.
     * @param {string} routePath - Route pattern.
     * @param {string} currentPath - Current request path.
     * @returns {Record<string, string> | null} - Matched params or null.
     */
    matchPath(routePath: string, currentPath: string): Record<string, string> | null;
}
//# sourceMappingURL=plugin-routes.d.ts.map