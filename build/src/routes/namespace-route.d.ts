import BasicRoute from "./basic-route.js";
declare class VelociousRouteNamespaceRoute extends BasicRoute {
    name: string;
    regExp: RegExp;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.name - Name.
     */
    constructor({ name, ...restArgs }: {
        name: string;
    });
    getHumanPaths(): {
        method: string;
        action: null;
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
export default VelociousRouteNamespaceRoute;
//# sourceMappingURL=namespace-route.d.ts.map