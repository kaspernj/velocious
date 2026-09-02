// @ts-check
import BaseRoute from "./base-route.js";
import escapeStringRegexp from "escape-string-regexp";
import restArgsError from "../utils/rest-args-error.js";
/**
 * Runs assign action and controller.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Route params object.
 * @param {string} name - Route name.
 * @returns {void} - No return value.
 */
function assignActionAndController(params, name) {
    const segments = name.split("/").filter((segment) => segment.length > 0);
    if (segments.length <= 1) {
        params.action = name;
        return;
    }
    const actionSegment = segments[segments.length - 1];
    const controllerSuffix = segments.slice(0, -1).join("/");
    const existingController = typeof params.controller === "string" && params.controller.length > 0 ? params.controller : null;
    params.action = actionSegment;
    params.controller = existingController ? `${existingController}/${controllerSuffix}` : controllerSuffix;
}
class VelociousRoutePostRoute extends BaseRoute {
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
        return [{
                method: "POST", action: this.name, path: this.name
            }
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
            // Prevent partial prefix matches (e.g., "update" matching "update-password")
            if (restPath && !restPath.startsWith("/"))
                return;
            assignActionAndController(params, this.name);
            return { restPath };
        }
    }
}
BaseRoute.registerRoutePostType(VelociousRoutePostRoute);
export default VelociousRoutePostRoute;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9zdC1yb3V0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9yb3V0ZXMvcG9zdC1yb3V0ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFDdkMsT0FBTyxrQkFBa0IsTUFBTSxzQkFBc0IsQ0FBQTtBQUNyRCxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RDs7Ozs7R0FLRztBQUNILFNBQVMseUJBQXlCLENBQUMsTUFBTSxFQUFFLElBQUk7SUFDN0MsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUE7SUFFeEUsSUFBSSxRQUFRLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQ3pCLE1BQU0sQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFBO1FBQ3BCLE9BQU07SUFDUixDQUFDO0lBRUQsTUFBTSxhQUFhLEdBQUcsUUFBUSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUE7SUFDbkQsTUFBTSxnQkFBZ0IsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUN4RCxNQUFNLGtCQUFrQixHQUFHLE9BQU8sTUFBTSxDQUFDLFVBQVUsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFFM0gsTUFBTSxDQUFDLE1BQU0sR0FBRyxhQUFhLENBQUE7SUFDN0IsTUFBTSxDQUFDLFVBQVUsR0FBRyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsR0FBRyxrQkFBa0IsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQTtBQUN6RyxDQUFDO0FBRUQsTUFBTSx1QkFBd0IsU0FBUSxTQUFTO0lBQzdDOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzdCLEtBQUssRUFBRSxDQUFBO1FBQ1AsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsS0FBSyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDakUsQ0FBQztJQUVELGFBQWE7UUFDWCxPQUFPLENBQUM7Z0JBQ04sTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7YUFBQztTQUNwRCxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxhQUFhLENBQUMsRUFBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQztRQUNuQyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVyQyxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ1YsTUFBTSxDQUFDLGNBQWMsRUFBRSxZQUFZLEVBQUUsUUFBUSxDQUFDLEdBQUcsS0FBSyxDQUFBO1lBRXRELDZFQUE2RTtZQUM3RSxJQUFJLFFBQVEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDO2dCQUFFLE9BQU07WUFFakQseUJBQXlCLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUU1QyxPQUFPLEVBQUMsUUFBUSxFQUFDLENBQUE7UUFDbkIsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVELFNBQVMsQ0FBQyxxQkFBcUIsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO0FBRXhELGVBQWUsdUJBQXVCLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VSb3V0ZSBmcm9tIFwiLi9iYXNlLXJvdXRlLmpzXCJcbmltcG9ydCBlc2NhcGVTdHJpbmdSZWdleHAgZnJvbSBcImVzY2FwZS1zdHJpbmctcmVnZXhwXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG4vKipcbiAqIFJ1bnMgYXNzaWduIGFjdGlvbiBhbmQgY29udHJvbGxlci5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSb3V0ZSBwYXJhbXMgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBSb3V0ZSBuYW1lLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5mdW5jdGlvbiBhc3NpZ25BY3Rpb25BbmRDb250cm9sbGVyKHBhcmFtcywgbmFtZSkge1xuICBjb25zdCBzZWdtZW50cyA9IG5hbWUuc3BsaXQoXCIvXCIpLmZpbHRlcigoc2VnbWVudCkgPT4gc2VnbWVudC5sZW5ndGggPiAwKVxuXG4gIGlmIChzZWdtZW50cy5sZW5ndGggPD0gMSkge1xuICAgIHBhcmFtcy5hY3Rpb24gPSBuYW1lXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBhY3Rpb25TZWdtZW50ID0gc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV1cbiAgY29uc3QgY29udHJvbGxlclN1ZmZpeCA9IHNlZ21lbnRzLnNsaWNlKDAsIC0xKS5qb2luKFwiL1wiKVxuICBjb25zdCBleGlzdGluZ0NvbnRyb2xsZXIgPSB0eXBlb2YgcGFyYW1zLmNvbnRyb2xsZXIgPT09IFwic3RyaW5nXCIgJiYgcGFyYW1zLmNvbnRyb2xsZXIubGVuZ3RoID4gMCA/IHBhcmFtcy5jb250cm9sbGVyIDogbnVsbFxuXG4gIHBhcmFtcy5hY3Rpb24gPSBhY3Rpb25TZWdtZW50XG4gIHBhcmFtcy5jb250cm9sbGVyID0gZXhpc3RpbmdDb250cm9sbGVyID8gYCR7ZXhpc3RpbmdDb250cm9sbGVyfS8ke2NvbnRyb2xsZXJTdWZmaXh9YCA6IGNvbnRyb2xsZXJTdWZmaXhcbn1cblxuY2xhc3MgVmVsb2Npb3VzUm91dGVQb3N0Um91dGUgZXh0ZW5kcyBCYXNlUm91dGUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIE5hbWUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7bmFtZSwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgc3VwZXIoKVxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgdGhpcy5uYW1lID0gbmFtZVxuICAgIHRoaXMucmVnRXhwID0gbmV3IFJlZ0V4cChgXigke2VzY2FwZVN0cmluZ1JlZ2V4cChuYW1lKX0pKC4qKSRgKVxuICB9XG5cbiAgZ2V0SHVtYW5QYXRocygpIHtcbiAgICByZXR1cm4gW3tcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsIGFjdGlvbjogdGhpcy5uYW1lLCBwYXRoOiB0aGlzLm5hbWV9XG4gICAgXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2ggd2l0aCBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBQYXJhbWV0ZXJzIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge3tyZXN0UGF0aDogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBSRVNUIHBhdGggbWV0YWRhdGEgZm9yIHRoaXMgcm91dGUuXG4gICAqL1xuICBtYXRjaFdpdGhQYXRoKHtwYXJhbXMsIHBhdGgsIHJlcXVlc3R9KSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICBjb25zdCBtYXRjaCA9IHBhdGgubWF0Y2godGhpcy5yZWdFeHApXG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGNvbnN0IFtfYmVnaW5uaWdTbGFzaCwgX21hdGNoZWROYW1lLCByZXN0UGF0aF0gPSBtYXRjaFxuXG4gICAgICAvLyBQcmV2ZW50IHBhcnRpYWwgcHJlZml4IG1hdGNoZXMgKGUuZy4sIFwidXBkYXRlXCIgbWF0Y2hpbmcgXCJ1cGRhdGUtcGFzc3dvcmRcIilcbiAgICAgIGlmIChyZXN0UGF0aCAmJiAhcmVzdFBhdGguc3RhcnRzV2l0aChcIi9cIikpIHJldHVyblxuXG4gICAgICBhc3NpZ25BY3Rpb25BbmRDb250cm9sbGVyKHBhcmFtcywgdGhpcy5uYW1lKVxuXG4gICAgICByZXR1cm4ge3Jlc3RQYXRofVxuICAgIH1cbiAgfVxufVxuXG5CYXNlUm91dGUucmVnaXN0ZXJSb3V0ZVBvc3RUeXBlKFZlbG9jaW91c1JvdXRlUG9zdFJvdXRlKVxuXG5leHBvcnQgZGVmYXVsdCBWZWxvY2lvdXNSb3V0ZVBvc3RSb3V0ZVxuIl19