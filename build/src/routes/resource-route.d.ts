import BasicRoute from "./basic-route.js";
declare class VelociousRouteResourceRoute extends BasicRoute {
    name: string;
    regExp: RegExp;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<string>} */
    collectionRouteNames: Set<string>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.name - Name.
     */
    constructor({ name, ...restArgs }: {
        name: string;
    });
    /**
     * Runs get.
     * @param {string} name - Name.
     * @param {{on?: "member" | "collection"}} [options] - Route options for scope.
     */
    get(name: string, options?: {
        on?: "member" | "collection";
    }): void;
    /**
     * Runs post.
     * @param {string} name - Name.
     * @param {{on?: "member" | "collection"}} [options] - Route options for scope.
     */
    post(name: string, options?: {
        on?: "member" | "collection";
    }): void;
    getHumanPaths(): {
        method: string;
        action: string;
        path: string;
    }[];
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
}
export default VelociousRouteResourceRoute;
//# sourceMappingURL=resource-route.d.ts.map