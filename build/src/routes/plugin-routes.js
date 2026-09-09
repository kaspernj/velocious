/**
 * AddRouteOptions type.
 * @typedef {object} AddRouteOptions
 * @property {Record<string, ReturnType<typeof JSON.parse>>} [params] - Static params to merge for matched route.
 * @property {[typeof import("../controller.js").default, string]} to - Controller class and action tuple.
 * @property {string} [viewPath] - Optional view path for controllers using renderView().
 */
/** Lightweight plugin route DSL for route-hook backed endpoints. */
export default class PluginRoutes {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor(args) {
        const { configuration } = args;
        if (!configuration)
            throw new Error("No configuration given");
        this.configuration = configuration;
    }
    /**
     * Runs get.
     * @param {string} routePath - Route path.
     * @param {AddRouteOptions} options - Route options.
     * @returns {void} - No return value.
     */
    get(routePath, options) {
        this.addRoute("GET", routePath, options);
    }
    /**
     * Runs post.
     * @param {string} routePath - Route path.
     * @param {AddRouteOptions} options - Route options.
     * @returns {void} - No return value.
     */
    post(routePath, options) {
        this.addRoute("POST", routePath, options);
    }
    /**
     * Runs add route.
     * @param {"GET" | "POST"} method - HTTP method.
     * @param {string} routePath - Route path.
     * @param {AddRouteOptions} options - Route options.
     * @returns {void} - No return value.
     */
    addRoute(method, routePath, options) {
        if (typeof routePath !== "string" || !routePath.startsWith("/")) {
            throw new Error(`Expected route path to be a string starting with '/', got: ${String(routePath)}`);
        }
        const to = options?.to;
        const staticParams = options?.params;
        const viewPath = options?.viewPath;
        const controllerClass = to?.[0];
        const action = to?.[1];
        if (typeof action !== "string" || action.length < 1) {
            throw new Error(`Expected route action to be a non-empty string, got: ${String(action)}`);
        }
        if (typeof controllerClass !== "function") {
            throw new Error(`Expected route controller class in 'to: [ControllerClass, action]', got: ${String(controllerClass)}`);
        }
        const controllerName = typeof controllerClass.name === "string" && controllerClass.name.length > 0
            ? controllerClass.name
            : "pluginController";
        if (viewPath !== undefined && typeof viewPath !== "string") {
            throw new Error(`Expected route viewPath to be a string when provided, got: ${String(viewPath)}`);
        }
        this.configuration.addRouteResolverHook(({ currentPath, request }) => {
            if (request.httpMethod() !== method)
                return null;
            const matchedParams = this.matchPath(routePath, currentPath);
            if (!matchedParams)
                return null;
            return {
                action,
                controller: controllerName,
                controllerClass,
                params: {
                    ...(staticParams || {}),
                    ...matchedParams
                },
                viewPath: viewPath || `${this.configuration.getDirectory()}/src/routes`
            };
        });
    }
    /**
     * Runs match path.
     * @param {string} routePath - Route pattern.
     * @param {string} currentPath - Current request path.
     * @returns {Record<string, string> | null} - Matched params or null.
     */
    matchPath(routePath, currentPath) {
        const routeSegments = routePath.replace(/^\/+|\/+$/g, "").split("/");
        const currentSegments = currentPath.replace(/^\/+|\/+$/g, "").split("/");
        if (routePath === "/") {
            return currentPath === "/" ? {} : null;
        }
        if (routeSegments.length !== currentSegments.length)
            return null;
        /**
         * Params.
         * @type {Record<string, string>} */
        const params = {};
        for (let index = 0; index < routeSegments.length; index += 1) {
            const routeSegment = routeSegments[index];
            const currentSegment = currentSegments[index];
            if (routeSegment.startsWith(":")) {
                const key = routeSegment.slice(1);
                if (!key)
                    return null;
                try {
                    params[key] = decodeURIComponent(currentSegment);
                }
                catch {
                    return null;
                }
                continue;
            }
            if (routeSegment !== currentSegment)
                return null;
        }
        return params;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9yb3V0ZXMvcGx1Z2luLXJvdXRlcy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7O0dBTUc7QUFFSCxvRUFBb0U7QUFDcEUsTUFBTSxDQUFDLE9BQU8sT0FBTyxZQUFZO0lBQy9COzs7O09BSUc7SUFDSCxZQUFZLElBQUk7UUFDZCxNQUFNLEVBQUMsYUFBYSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBRTVCLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBRTdELElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEdBQUcsQ0FBQyxTQUFTLEVBQUUsT0FBTztRQUNwQixJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsSUFBSSxDQUFDLFNBQVMsRUFBRSxPQUFPO1FBQ3JCLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQTtJQUMzQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsUUFBUSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsT0FBTztRQUNqQyxJQUFJLE9BQU8sU0FBUyxLQUFLLFFBQVEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNoRSxNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RCxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ3BHLENBQUM7UUFFRCxNQUFNLEVBQUUsR0FBRyxPQUFPLEVBQUUsRUFBRSxDQUFBO1FBQ3RCLE1BQU0sWUFBWSxHQUFHLE9BQU8sRUFBRSxNQUFNLENBQUE7UUFDcEMs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QyxLQUFLLENBQUMsQ0FBQTtZQUU3QyxJQUFJLFlBQVksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDakMsTUFBTSxHQUFHLEdBQUcsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtnQkFFakMsSUFBSSxDQUFDLEdBQUc7b0JBQUUsT0FBTyxJQUFJLENBQUE7Z0JBRXJCLElBQUksQ0FBQztvQkFDSCxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsa0JBQWtCLENBQUMsY0FBYyxDQUFDLENBQUE7Z0JBQ2xELENBQUM7Z0JBQUMsTUFBTSxDQUFDO29CQUNQLE9BQU8sSUFBSSxDQUFBO2dCQUNiLENBQUM7Z0JBRUQsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLFlBQVksS0FBSyxjQUFjO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1FBQ2xELENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQWRkUm91dGVPcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBZGRSb3V0ZU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbcGFyYW1zXSAtIFN0YXRpYyBwYXJhbXMgdG8gbWVyZ2UgZm9yIG1hdGNoZWQgcm91dGUuXG4gKiBAcHJvcGVydHkge1t0eXBlb2YgaW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0LCBzdHJpbmddfSB0byAtIENvbnRyb2xsZXIgY2xhc3MgYW5kIGFjdGlvbiB0dXBsZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdmlld1BhdGhdIC0gT3B0aW9uYWwgdmlldyBwYXRoIGZvciBjb250cm9sbGVycyB1c2luZyByZW5kZXJWaWV3KCkuXG4gKi9cblxuLyoqIExpZ2h0d2VpZ2h0IHBsdWdpbiByb3V0ZSBEU0wgZm9yIHJvdXRlLWhvb2sgYmFja2VkIGVuZHBvaW50cy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFBsdWdpblJvdXRlcyB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MpIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbn0gPSBhcmdzXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW5cIilcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJvdXRlUGF0aCAtIFJvdXRlIHBhdGguXG4gICAqIEBwYXJhbSB7QWRkUm91dGVPcHRpb25zfSBvcHRpb25zIC0gUm91dGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZ2V0KHJvdXRlUGF0aCwgb3B0aW9ucykge1xuICAgIHRoaXMuYWRkUm91dGUoXCJHRVRcIiwgcm91dGVQYXRoLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcG9zdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJvdXRlUGF0aCAtIFJvdXRlIHBhdGguXG4gICAqIEBwYXJhbSB7QWRkUm91dGVPcHRpb25zfSBvcHRpb25zIC0gUm91dGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcG9zdChyb3V0ZVBhdGgsIG9wdGlvbnMpIHtcbiAgICB0aGlzLmFkZFJvdXRlKFwiUE9TVFwiLCByb3V0ZVBhdGgsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgcm91dGUuXG4gICAqIEBwYXJhbSB7XCJHRVRcIiB8IFwiUE9TVFwifSBtZXRob2QgLSBIVFRQIG1ldGhvZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJvdXRlUGF0aCAtIFJvdXRlIHBhdGguXG4gICAqIEBwYXJhbSB7QWRkUm91dGVPcHRpb25zfSBvcHRpb25zIC0gUm91dGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkUm91dGUobWV0aG9kLCByb3V0ZVBhdGgsIG9wdGlvbnMpIHtcbiAgICBpZiAodHlwZW9mIHJvdXRlUGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhcm91dGVQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHJvdXRlIHBhdGggdG8gYmUgYSBzdHJpbmcgc3RhcnRpbmcgd2l0aCAnLycsIGdvdDogJHtTdHJpbmcocm91dGVQYXRoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRvID0gb3B0aW9ucz8udG9cbiAgICBjb25zdCBzdGF0aWNQYXJhbXMgPSBvcHRpb25zPy5wYXJhbXNcbiAgICBjb25zdCB2aWV3UGF0aCA9IG9wdGlvbnM/LnZpZXdQYXRoXG4gICAgY29uc3QgY29udHJvbGxlckNsYXNzID0gdG8/LlswXVxuICAgIGNvbnN0IGFjdGlvbiA9IHRvPy5bMV1cblxuICAgIGlmICh0eXBlb2YgYWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHJvdXRlIGFjdGlvbiB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcoYWN0aW9uKX1gKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgY29udHJvbGxlckNsYXNzICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcm91dGUgY29udHJvbGxlciBjbGFzcyBpbiAndG86IFtDb250cm9sbGVyQ2xhc3MsIGFjdGlvbl0nLCBnb3Q6ICR7U3RyaW5nKGNvbnRyb2xsZXJDbGFzcyl9YClcbiAgICB9XG5cbiAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IHR5cGVvZiBjb250cm9sbGVyQ2xhc3MubmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBjb250cm9sbGVyQ2xhc3MubmFtZS5sZW5ndGggPiAwXG4gICAgICA/IGNvbnRyb2xsZXJDbGFzcy5uYW1lXG4gICAgICA6IFwicGx1Z2luQ29udHJvbGxlclwiXG5cbiAgICBpZiAodmlld1BhdGggIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygdmlld1BhdGggIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcm91dGUgdmlld1BhdGggdG8gYmUgYSBzdHJpbmcgd2hlbiBwcm92aWRlZCwgZ290OiAke1N0cmluZyh2aWV3UGF0aCl9YClcbiAgICB9XG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uYWRkUm91dGVSZXNvbHZlckhvb2soKHtjdXJyZW50UGF0aCwgcmVxdWVzdH0pID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSAhPT0gbWV0aG9kKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgbWF0Y2hlZFBhcmFtcyA9IHRoaXMubWF0Y2hQYXRoKHJvdXRlUGF0aCwgY3VycmVudFBhdGgpXG5cbiAgICAgIGlmICghbWF0Y2hlZFBhcmFtcykgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uLFxuICAgICAgICBjb250cm9sbGVyOiBjb250cm9sbGVyTmFtZSxcbiAgICAgICAgY29udHJvbGxlckNsYXNzLFxuICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAuLi4oc3RhdGljUGFyYW1zIHx8IHt9KSxcbiAgICAgICAgICAuLi5tYXRjaGVkUGFyYW1zXG4gICAgICAgIH0sXG4gICAgICAgIHZpZXdQYXRoOiB2aWV3UGF0aCB8fCBgJHt0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9yb3V0ZXNgXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByb3V0ZVBhdGggLSBSb3V0ZSBwYXR0ZXJuLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY3VycmVudFBhdGggLSBDdXJyZW50IHJlcXVlc3QgcGF0aC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsfSAtIE1hdGNoZWQgcGFyYW1zIG9yIG51bGwuXG4gICAqL1xuICBtYXRjaFBhdGgocm91dGVQYXRoLCBjdXJyZW50UGF0aCkge1xuICAgIGNvbnN0IHJvdXRlU2VnbWVudHMgPSByb3V0ZVBhdGgucmVwbGFjZSgvXlxcLyt8XFwvKyQvZywgXCJcIikuc3BsaXQoXCIvXCIpXG4gICAgY29uc3QgY3VycmVudFNlZ21lbnRzID0gY3VycmVudFBhdGgucmVwbGFjZSgvXlxcLyt8XFwvKyQvZywgXCJcIikuc3BsaXQoXCIvXCIpXG5cbiAgICBpZiAocm91dGVQYXRoID09PSBcIi9cIikge1xuICAgICAgcmV0dXJuIGN1cnJlbnRQYXRoID09PSBcIi9cIiA/IHt9IDogbnVsbFxuICAgIH1cblxuICAgIGlmIChyb3V0ZVNlZ21lbnRzLmxlbmd0aCAhPT0gY3VycmVudFNlZ21lbnRzLmxlbmd0aCkgcmV0dXJuIG51bGxcblxuICAgIC8qKlxuICAgICAqIFBhcmFtcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICBjb25zdCBwYXJhbXMgPSB7fVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IHJvdXRlU2VnbWVudHMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICBjb25zdCByb3V0ZVNlZ21lbnQgPSByb3V0ZVNlZ21lbnRzW2luZGV4XVxuICAgICAgY29uc3QgY3VycmVudFNlZ21lbnQgPSBjdXJyZW50U2VnbWVudHNbaW5kZXhdXG5cbiAgICAgIGlmIChyb3V0ZVNlZ21lbnQuc3RhcnRzV2l0aChcIjpcIikpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcm91dGVTZWdtZW50LnNsaWNlKDEpXG5cbiAgICAgICAgaWYgKCFrZXkpIHJldHVybiBudWxsXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBwYXJhbXNba2V5XSA9IGRlY29kZVVSSUNvbXBvbmVudChjdXJyZW50U2VnbWVudClcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChyb3V0ZVNlZ21lbnQgIT09IGN1cnJlbnRTZWdtZW50KSByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIHJldHVybiBwYXJhbXNcbiAgfVxufVxuIl19