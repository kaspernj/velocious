// @ts-check
import escapeStringRegexp from "escape-string-regexp";
import BaseRoute from "./base-route.js";
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
class VelociousRouteGetRoute extends BaseRoute {
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
            { method: "GET", action: this.name, path: this.name }
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
            // Prevent partial prefix matches (e.g., "params" matching "params-with-query")
            if (restPath && !restPath.startsWith("/"))
                return;
            assignActionAndController(params, this.name);
            return { restPath };
        }
    }
}
BaseRoute.registerRouteGetType(VelociousRouteGetRoute);
export default VelociousRouteGetRoute;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2V0LXJvdXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3JvdXRlcy9nZXQtcm91dGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sa0JBQWtCLE1BQU0sc0JBQXNCLENBQUE7QUFFckQsT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFDdkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQ7Ozs7O0dBS0c7QUFDSCxTQUFTLHlCQUF5QixDQUFDLE1BQU0sRUFBRSxJQUFJO0lBQzdDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBRXhFLElBQUksUUFBUSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUN6QixNQUFNLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQTtRQUNwQixPQUFNO0lBQ1IsQ0FBQztJQUVELE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBQ25ELE1BQU0sZ0JBQWdCLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDeEQsTUFBTSxrQkFBa0IsR0FBRyxPQUFPLE1BQU0sQ0FBQyxVQUFVLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO0lBRTNILE1BQU0sQ0FBQyxNQUFNLEdBQUcsYUFBYSxDQUFBO0lBQzdCLE1BQU0sQ0FBQyxVQUFVLEdBQUcsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLEdBQUcsa0JBQWtCLElBQUksZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUE7QUFDekcsQ0FBQztBQUVELE1BQU0sc0JBQXVCLFNBQVEsU0FBUztJQUM1Qzs7OztPQUlHO0lBQ0gsWUFBWSxFQUFDLElBQUksRUFBRSxHQUFHLFFBQVEsRUFBQztRQUM3QixLQUFLLEVBQUUsQ0FBQTtRQUNQLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN2QixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLEtBQUssa0JBQWtCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQ2pFLENBQUM7SUFFRCxhQUFhO1FBQ1gsT0FBTztZQUNMLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBQztTQUNwRCxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxhQUFhLENBQUMsRUFBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQztRQUNuQyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVyQyxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ1YsTUFBTSxDQUFDLGNBQWMsRUFBRSxZQUFZLEVBQUUsUUFBUSxDQUFDLEdBQUcsS0FBSyxDQUFBO1lBRXRELCtFQUErRTtZQUMvRSxJQUFJLFFBQVEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDO2dCQUFFLE9BQU07WUFFakQseUJBQXlCLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUU1QyxPQUFPLEVBQUMsUUFBUSxFQUFDLENBQUE7UUFDbkIsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVELFNBQVMsQ0FBQyxvQkFBb0IsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO0FBRXRELGVBQWUsc0JBQXNCLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGVzY2FwZVN0cmluZ1JlZ2V4cCBmcm9tIFwiZXNjYXBlLXN0cmluZy1yZWdleHBcIlxuXG5pbXBvcnQgQmFzZVJvdXRlIGZyb20gXCIuL2Jhc2Utcm91dGUuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbi8qKlxuICogUnVucyBhc3NpZ24gYWN0aW9uIGFuZCBjb250cm9sbGVyLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJvdXRlIHBhcmFtcyBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFJvdXRlIG5hbWUuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGFzc2lnbkFjdGlvbkFuZENvbnRyb2xsZXIocGFyYW1zLCBuYW1lKSB7XG4gIGNvbnN0IHNlZ21lbnRzID0gbmFtZS5zcGxpdChcIi9cIikuZmlsdGVyKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA+IDApXG5cbiAgaWYgKHNlZ21lbnRzLmxlbmd0aCA8PSAxKSB7XG4gICAgcGFyYW1zLmFjdGlvbiA9IG5hbWVcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGFjdGlvblNlZ21lbnQgPSBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXVxuICBjb25zdCBjb250cm9sbGVyU3VmZml4ID0gc2VnbWVudHMuc2xpY2UoMCwgLTEpLmpvaW4oXCIvXCIpXG4gIGNvbnN0IGV4aXN0aW5nQ29udHJvbGxlciA9IHR5cGVvZiBwYXJhbXMuY29udHJvbGxlciA9PT0gXCJzdHJpbmdcIiAmJiBwYXJhbXMuY29udHJvbGxlci5sZW5ndGggPiAwID8gcGFyYW1zLmNvbnRyb2xsZXIgOiBudWxsXG5cbiAgcGFyYW1zLmFjdGlvbiA9IGFjdGlvblNlZ21lbnRcbiAgcGFyYW1zLmNvbnRyb2xsZXIgPSBleGlzdGluZ0NvbnRyb2xsZXIgPyBgJHtleGlzdGluZ0NvbnRyb2xsZXJ9LyR7Y29udHJvbGxlclN1ZmZpeH1gIDogY29udHJvbGxlclN1ZmZpeFxufVxuXG5jbGFzcyBWZWxvY2lvdXNSb3V0ZUdldFJvdXRlIGV4dGVuZHMgQmFzZVJvdXRlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBOYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe25hbWUsIC4uLnJlc3RBcmdzfSkge1xuICAgIHN1cGVyKClcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIHRoaXMubmFtZSA9IG5hbWVcbiAgICB0aGlzLnJlZ0V4cCA9IG5ldyBSZWdFeHAoYF4oJHtlc2NhcGVTdHJpbmdSZWdleHAobmFtZSl9KSguKikkYClcbiAgfVxuXG4gIGdldEh1bWFuUGF0aHMoKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHttZXRob2Q6IFwiR0VUXCIsIGFjdGlvbjogdGhpcy5uYW1lLCBwYXRoOiB0aGlzLm5hbWV9XG4gICAgXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2ggd2l0aCBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wYXJhbXMgLSBQYXJhbWV0ZXJzIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge3tyZXN0UGF0aDogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBSRVNUIHBhdGggbWV0YWRhdGEgZm9yIHRoaXMgcm91dGUuXG4gICAqL1xuICBtYXRjaFdpdGhQYXRoKHtwYXJhbXMsIHBhdGgsIHJlcXVlc3R9KSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICBjb25zdCBtYXRjaCA9IHBhdGgubWF0Y2godGhpcy5yZWdFeHApXG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGNvbnN0IFtfYmVnaW5uaWdTbGFzaCwgX21hdGNoZWROYW1lLCByZXN0UGF0aF0gPSBtYXRjaFxuXG4gICAgICAvLyBQcmV2ZW50IHBhcnRpYWwgcHJlZml4IG1hdGNoZXMgKGUuZy4sIFwicGFyYW1zXCIgbWF0Y2hpbmcgXCJwYXJhbXMtd2l0aC1xdWVyeVwiKVxuICAgICAgaWYgKHJlc3RQYXRoICYmICFyZXN0UGF0aC5zdGFydHNXaXRoKFwiL1wiKSkgcmV0dXJuXG5cbiAgICAgIGFzc2lnbkFjdGlvbkFuZENvbnRyb2xsZXIocGFyYW1zLCB0aGlzLm5hbWUpXG5cbiAgICAgIHJldHVybiB7cmVzdFBhdGh9XG4gICAgfVxuICB9XG59XG5cbkJhc2VSb3V0ZS5yZWdpc3RlclJvdXRlR2V0VHlwZShWZWxvY2lvdXNSb3V0ZUdldFJvdXRlKVxuXG5leHBvcnQgZGVmYXVsdCBWZWxvY2lvdXNSb3V0ZUdldFJvdXRlXG4iXX0=