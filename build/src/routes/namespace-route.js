// @ts-check
import restArgsError from "../utils/rest-args-error.js";
import BaseRoute from "./base-route.js";
import BasicRoute from "./basic-route.js";
import escapeStringRegexp from "escape-string-regexp";
class VelociousRouteNamespaceRoute extends BasicRoute {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.name - Name.
     */
    constructor({ name, ...restArgs }) {
        super();
        restArgsError(restArgs);
        this.name = name;
        this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`);
    }
    getHumanPaths() {
        return [
            { method: "GET", action: null, path: this.name }
        ];
    }
    /**
     * Runs match with path.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Parameters object.
     * @param {string} args.path - Path.
     * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
     * @returns {{restPath: string} | undefined} - REST path metadata for this route.
     */
    matchWithPath({ params, path, request }) {
        const match = path.match(this.regExp);
        if (match) {
            const [_beginnigSlash, _matchedName, restPath] = match;
            params.controller = this.name;
            return { restPath };
        }
    }
}
BaseRoute.registerRouteNamespaceType(VelociousRouteNamespaceRoute);
export default VelociousRouteNamespaceRoute;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmFtZXNwYWNlLXJvdXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3JvdXRlcy9uYW1lc3BhY2Utcm91dGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBQ3ZDLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8sa0JBQWtCLE1BQU0sc0JBQXNCLENBQUE7QUFFckQsTUFBTSw0QkFBNkIsU0FBUSxVQUFVO0lBQ25EOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzdCLEtBQUssRUFBRSxDQUFBO1FBQ1AsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsS0FBSyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDakUsQ0FBQztJQUVELGFBQWE7UUFDWCxPQUFPO1lBQ0wsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUM7U0FDL0MsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsYUFBYSxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDbkMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFckMsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNWLE1BQU0sQ0FBQyxjQUFjLEVBQUUsWUFBWSxFQUFFLFFBQVEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUV0RCxNQUFNLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUE7WUFFN0IsT0FBTyxFQUFDLFFBQVEsRUFBQyxDQUFBO1FBQ25CLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFRCxTQUFTLENBQUMsMEJBQTBCLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtBQUVsRSxlQUFlLDRCQUE0QixDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IEJhc2VSb3V0ZSBmcm9tIFwiLi9iYXNlLXJvdXRlLmpzXCJcbmltcG9ydCBCYXNpY1JvdXRlIGZyb20gXCIuL2Jhc2ljLXJvdXRlLmpzXCJcbmltcG9ydCBlc2NhcGVTdHJpbmdSZWdleHAgZnJvbSBcImVzY2FwZS1zdHJpbmctcmVnZXhwXCJcblxuY2xhc3MgVmVsb2Npb3VzUm91dGVOYW1lc3BhY2VSb3V0ZSBleHRlbmRzIEJhc2ljUm91dGUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIE5hbWUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7bmFtZSwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgc3VwZXIoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgdGhpcy5uYW1lID0gbmFtZVxuICAgIHRoaXMucmVnRXhwID0gbmV3IFJlZ0V4cChgXigke2VzY2FwZVN0cmluZ1JlZ2V4cChuYW1lKX0pKC4qKSRgKVxuICB9XG5cbiAgZ2V0SHVtYW5QYXRocygpIHtcbiAgICByZXR1cm4gW1xuICAgICAge21ldGhvZDogXCJHRVRcIiwgYWN0aW9uOiBudWxsLCBwYXRoOiB0aGlzLm5hbWV9XG4gICAgXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2ggd2l0aCBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBQYXJhbWV0ZXJzIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge3tyZXN0UGF0aDogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBSRVNUIHBhdGggbWV0YWRhdGEgZm9yIHRoaXMgcm91dGUuXG4gICAqL1xuICBtYXRjaFdpdGhQYXRoKHtwYXJhbXMsIHBhdGgsIHJlcXVlc3R9KSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICBjb25zdCBtYXRjaCA9IHBhdGgubWF0Y2godGhpcy5yZWdFeHApXG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGNvbnN0IFtfYmVnaW5uaWdTbGFzaCwgX21hdGNoZWROYW1lLCByZXN0UGF0aF0gPSBtYXRjaFxuXG4gICAgICBwYXJhbXMuY29udHJvbGxlciA9IHRoaXMubmFtZVxuXG4gICAgICByZXR1cm4ge3Jlc3RQYXRofVxuICAgIH1cbiAgfVxufVxuXG5CYXNlUm91dGUucmVnaXN0ZXJSb3V0ZU5hbWVzcGFjZVR5cGUoVmVsb2Npb3VzUm91dGVOYW1lc3BhY2VSb3V0ZSlcblxuZXhwb3J0IGRlZmF1bHQgVmVsb2Npb3VzUm91dGVOYW1lc3BhY2VSb3V0ZVxuXG4iXX0=