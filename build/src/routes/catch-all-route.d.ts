export type CatchAllRouteOptions = {
    /**
     * - Controller name unmatched requests resolve to.
     */
    controller?: string;
    /**
     * - Action name unmatched requests resolve to.
     */
    action?: string;
};
/**
 * Catch-all route options.
 * @typedef {object} CatchAllRouteOptions
 * @property {string} [controller] - Controller name unmatched requests resolve to.
 * @property {string} [action] - Action name unmatched requests resolve to.
 */
/**
 * Application-declared catch-all route created with `route.catchAll(...)` in
 * the routes file. It is not a path matcher: the resolver applies it only
 * when no other route in the tree matched, replacing the built-in errors
 * not-found response with the application's own controller/action (for
 * example a JSON error envelope) without hand-wiring a route resolver hook.
 */
export default class VelociousRouteCatchAllRoute {
    /**
     * Controller name unmatched requests resolve to.
     * @type {string} */
    controller: string;
    /**
     * Action name unmatched requests resolve to.
     * @type {string} */
    action: string;
    /**
     * Runs constructor.
     * @param {CatchAllRouteOptions} [options] - Catch-all options.
     */
    constructor({ controller, action, ...restArgs }?: CatchAllRouteOptions);
    /**
     * Runs get human paths.
     * @returns {Array<{action: string | null, method: string, path: string}>} - Route definitions for this route.
     */
    getHumanPaths(): Array<{
        action: string | null;
        method: string;
        path: string;
    }>;
}
//# sourceMappingURL=catch-all-route.d.ts.map