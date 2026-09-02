// @ts-check
export default class VelociousBaseRoute {
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./get-route.js").default} */
    static GetRouteType;
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./namespace-route.js").default} */
    static NameSpaceRouteType;
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./post-route.js").default} */
    static PostRouteType;
    /**
     * Narrows the runtime value to the documented type.
     * @type {typeof import("./resource-route.js").default} */
    static ResourceRouteType;
    /**
     * Runs register route get type.
     * @param {typeof import("./get-route.js").default} RouteClass - Route class to register.
     */
    static registerRouteGetType(RouteClass) {
        this.GetRouteType = RouteClass;
    }
    /**
     * Runs register route namespace type.
     * @param {typeof import("./namespace-route.js").default} RouteClass - Route class to register.
     */
    static registerRouteNamespaceType(RouteClass) {
        this.NameSpaceRouteType = RouteClass;
    }
    /**
     * Runs register route post type.
     * @param {typeof import("./post-route.js").default} RouteClass - Route class to register.
     */
    static registerRoutePostType(RouteClass) {
        this.PostRouteType = RouteClass;
    }
    /**
     * Runs register route resource type.
     * @param {typeof import("./resource-route.js").default} RouteClass - Route class to register.
     */
    static registerRouteResourceType(RouteClass) {
        this.ResourceRouteType = RouteClass;
    }
    /**
     * Routes.
     * @type {Array<VelociousBaseRoute>} */
    routes = [];
    /**
     * Mounts.
     * @type {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ReturnType<typeof JSON.parse>>}>} */
    mounts = [];
    constructor() {
        // Nothing
    }
    /**
     * Runs get mounts.
     * @returns {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ReturnType<typeof JSON.parse>>}>} - Mounts declared on this route.
     */
    getMounts() { return this.mounts; }
    /**
     * Runs get.
     * @abstract
     * @param {string} name - Name.
     */
    get(name) { throw new Error("'get' not implemented"); } // eslint-disable-line no-unused-vars
    /**
     * Runs get human paths.
     * @abstract
     * @returns {Array<{action: string | null, method: string, path: string}>} - Route definitions for this resource.
     */
    getHumanPaths() { throw new Error(`'getHumanPaths' not implemented for ${this.constructor.name}`); }
    /**
     * Runs get sub routes.
     * @returns {Array<VelociousBaseRoute>} - The sub routes.
     */
    getSubRoutes() { return this.routes; }
    /**
     * Runs match with path.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Parameters object.
     * @param {string} args.path - Path.
     * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
     * @returns {{restPath: string} | undefined} - REST path metadata for this route.
     */
    matchWithPath({ params, path, request }) {
        throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`);
    }
    /**
     * Runs namespace.
     * @abstract
     * @param {string} name - Name.
     * @param {(arg: import("./namespace-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    namespace(name, callback) { throw new Error("'namespace' not implemented"); } // eslint-disable-line no-unused-vars
    /**
     * Runs post.
     * @abstract
     * @param {string} name - Name.
     * @returns {void} - No return value.
     */
    post(name) { throw new Error("'post' not implemented"); } // eslint-disable-line no-unused-vars
    /**
     * Runs resources.
     * @abstract
     * @param {string} name - Name.
     * @param {(arg: import("./resource-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    resources(name, callback) { throw new Error("'resources' not implemented"); } // eslint-disable-line no-unused-vars
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yb3V0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9yb3V0ZXMvYmFzZS1yb3V0ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosTUFBTSxDQUFDLE9BQU8sT0FBTyxrQkFBa0I7SUFDckM7O3lEQUVxRDtJQUNyRCxNQUFNLENBQUMsWUFBWSxDQUFBO0lBRW5COzsrREFFMkQ7SUFDM0QsTUFBTSxDQUFDLGtCQUFrQixDQUFBO0lBRXpCOzswREFFc0Q7SUFDdEQsTUFBTSxDQUFDLGFBQWEsQ0FBQTtJQUVwQjs7OERBRTBEO0lBQzFELE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQTtJQUV4Qjs7O09BR0c7SUFDSCxNQUFNLENBQUMsb0JBQW9CLENBQUMsVUFBVTtRQUNwQyxJQUFJLENBQUMsWUFBWSxHQUFHLFVBQVUsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLDBCQUEwQixDQUFDLFVBQVU7UUFDMUMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFVBQVUsQ0FBQTtJQUN0QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLHFCQUFxQixDQUFDLFVBQVU7UUFDckMsSUFBSSxDQUFDLGFBQWEsR0FBRyxVQUFVLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQyxVQUFVO1FBQ3pDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxVQUFVLENBQUE7SUFDckMsQ0FBQztJQUVEOzsyQ0FFdUM7SUFDdkMsTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUVYOztpSUFFNkg7SUFDN0gsTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUVYO1FBQ0UsVUFBVTtJQUNaLENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFBLENBQUMsQ0FBQztJQUVsQzs7OztPQUlHO0lBQ0gsR0FBRyxDQUFDLElBQUksSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUEsQ0FBQyxDQUFDLENBQUMscUNBQXFDO0lBRTVGOzs7O09BSUc7SUFDSCxhQUFhLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVuRzs7O09BR0c7SUFDSCxZQUFZLEtBQUssT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFBLENBQUMsQ0FBQztJQUVyQzs7Ozs7OztPQU9HO0lBQ0gsYUFBYSxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDbkMsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO0lBQy9FLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixDQUFDLENBQUEsQ0FBQyxDQUFDLENBQUMscUNBQXFDO0lBRWxIOzs7OztPQUtHO0lBQ0gsSUFBSSxDQUFDLElBQUksSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUEsQ0FBQyxDQUFDLENBQUMscUNBQXFDO0lBRTlGOzs7Ozs7T0FNRztJQUNILFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQSxDQUFDLENBQUMsQ0FBQyxxQ0FBcUM7Q0FDbkgiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQmFzZVJvdXRlIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2dldC1yb3V0ZS5qc1wiKS5kZWZhdWx0fSAqL1xuICBzdGF0aWMgR2V0Um91dGVUeXBlXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL25hbWVzcGFjZS1yb3V0ZS5qc1wiKS5kZWZhdWx0fSAqL1xuICBzdGF0aWMgTmFtZVNwYWNlUm91dGVUeXBlXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL3Bvc3Qtcm91dGUuanNcIikuZGVmYXVsdH0gKi9cbiAgc3RhdGljIFBvc3RSb3V0ZVR5cGVcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vcmVzb3VyY2Utcm91dGUuanNcIikuZGVmYXVsdH0gKi9cbiAgc3RhdGljIFJlc291cmNlUm91dGVUeXBlXG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgcm91dGUgZ2V0IHR5cGUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZ2V0LXJvdXRlLmpzXCIpLmRlZmF1bHR9IFJvdXRlQ2xhc3MgLSBSb3V0ZSBjbGFzcyB0byByZWdpc3Rlci5cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlclJvdXRlR2V0VHlwZShSb3V0ZUNsYXNzKSB7XG4gICAgdGhpcy5HZXRSb3V0ZVR5cGUgPSBSb3V0ZUNsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciByb3V0ZSBuYW1lc3BhY2UgdHlwZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9uYW1lc3BhY2Utcm91dGUuanNcIikuZGVmYXVsdH0gUm91dGVDbGFzcyAtIFJvdXRlIGNsYXNzIHRvIHJlZ2lzdGVyLlxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUm91dGVOYW1lc3BhY2VUeXBlKFJvdXRlQ2xhc3MpIHtcbiAgICB0aGlzLk5hbWVTcGFjZVJvdXRlVHlwZSA9IFJvdXRlQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIHJvdXRlIHBvc3QgdHlwZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9wb3N0LXJvdXRlLmpzXCIpLmRlZmF1bHR9IFJvdXRlQ2xhc3MgLSBSb3V0ZSBjbGFzcyB0byByZWdpc3Rlci5cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlclJvdXRlUG9zdFR5cGUoUm91dGVDbGFzcykge1xuICAgIHRoaXMuUG9zdFJvdXRlVHlwZSA9IFJvdXRlQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIHJvdXRlIHJlc291cmNlIHR5cGUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vcmVzb3VyY2Utcm91dGUuanNcIikuZGVmYXVsdH0gUm91dGVDbGFzcyAtIFJvdXRlIGNsYXNzIHRvIHJlZ2lzdGVyLlxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUm91dGVSZXNvdXJjZVR5cGUoUm91dGVDbGFzcykge1xuICAgIHRoaXMuUmVzb3VyY2VSb3V0ZVR5cGUgPSBSb3V0ZUNsYXNzXG4gIH1cblxuICAvKipcbiAgICogUm91dGVzLlxuICAgKiBAdHlwZSB7QXJyYXk8VmVsb2Npb3VzQmFzZVJvdXRlPn0gKi9cbiAgcm91dGVzID0gW11cblxuICAvKipcbiAgICogTW91bnRzLlxuICAgKiBAdHlwZSB7QXJyYXk8e21vdW50YWJsZToge21vdW50SW50bzogKGFyZ3M6IG9iamVjdCkgPT4gdm9pZH0sIG9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICBtb3VudHMgPSBbXVxuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIC8vIE5vdGhpbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb3VudHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7bW91bnRhYmxlOiB7bW91bnRJbnRvOiAoYXJnczogb2JqZWN0KSA9PiB2b2lkfSwgb3B0aW9uczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IC0gTW91bnRzIGRlY2xhcmVkIG9uIHRoaXMgcm91dGUuXG4gICAqL1xuICBnZXRNb3VudHMoKSB7IHJldHVybiB0aGlzLm1vdW50cyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKi9cbiAgZ2V0KG5hbWUpIHsgdGhyb3cgbmV3IEVycm9yKFwiJ2dldCcgbm90IGltcGxlbWVudGVkXCIpIH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBodW1hbiBwYXRocy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtBcnJheTx7YWN0aW9uOiBzdHJpbmcgfCBudWxsLCBtZXRob2Q6IHN0cmluZywgcGF0aDogc3RyaW5nfT59IC0gUm91dGUgZGVmaW5pdGlvbnMgZm9yIHRoaXMgcmVzb3VyY2UuXG4gICAqL1xuICBnZXRIdW1hblBhdGhzKCkgeyB0aHJvdyBuZXcgRXJyb3IoYCdnZXRIdW1hblBhdGhzJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3ViIHJvdXRlcy5cbiAgICogQHJldHVybnMge0FycmF5PFZlbG9jaW91c0Jhc2VSb3V0ZT59IC0gVGhlIHN1YiByb3V0ZXMuXG4gICAqL1xuICBnZXRTdWJSb3V0ZXMoKSB7IHJldHVybiB0aGlzLnJvdXRlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2ggd2l0aCBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBQYXJhbWV0ZXJzIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge3tyZXN0UGF0aDogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBSRVNUIHBhdGggbWV0YWRhdGEgZm9yIHRoaXMgcm91dGUuXG4gICAqL1xuICBtYXRjaFdpdGhQYXRoKHtwYXJhbXMsIHBhdGgsIHJlcXVlc3R9KSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vICdtYXRjaFdpdGhQYXRoJyBpbXBsZW1lbnRlZCBvbiAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmFtZXNwYWNlLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0geyhhcmc6IGltcG9ydChcIi4vbmFtZXNwYWNlLXJvdXRlLmpzXCIpLmRlZmF1bHQpID0+IHZvaWR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG5hbWVzcGFjZShuYW1lLCBjYWxsYmFjaykgeyB0aHJvdyBuZXcgRXJyb3IoXCInbmFtZXNwYWNlJyBub3QgaW1wbGVtZW50ZWRcIikgfSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbiAgLyoqXG4gICAqIFJ1bnMgcG9zdC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcG9zdChuYW1lKSB7IHRocm93IG5ldyBFcnJvcihcIidwb3N0JyBub3QgaW1wbGVtZW50ZWRcIikgfSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2VzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0geyhhcmc6IGltcG9ydChcIi4vcmVzb3VyY2Utcm91dGUuanNcIikuZGVmYXVsdCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVzb3VyY2VzKG5hbWUsIGNhbGxiYWNrKSB7IHRocm93IG5ldyBFcnJvcihcIidyZXNvdXJjZXMnIG5vdCBpbXBsZW1lbnRlZFwiKSB9IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbn1cbiJdfQ==