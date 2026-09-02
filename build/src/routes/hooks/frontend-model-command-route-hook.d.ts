/**
 * Runs frontend model command route hook.
 * @param {object} args - Hook args.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {string} args.currentPath - Request path without query.
 * @param {boolean} [args.hasMatchingCustomRoute] - Set when the request path matches an explicit custom route.
 * @returns {Promise<import("../../configuration-types.js").RouteResolverHookResult | null>} - Route override or null.
 */
export default function frontendModelCommandRouteHook({ configuration, currentPath, hasMatchingCustomRoute }: {
    configuration: import("../../configuration.js").default;
    currentPath: string;
    hasMatchingCustomRoute?: boolean;
}): Promise<import("../../configuration-types.js").RouteResolverHookResult | null>;
//# sourceMappingURL=frontend-model-command-route-hook.d.ts.map