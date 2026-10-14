// @ts-check
import BasicRoute from "./basic-route.js";
import CatchAllRoute from "./catch-all-route.js";
export default class VelociousRootRoute extends BasicRoute {
    /**
     * Application catch-all route declared with `route.catchAll(...)`, or null
     * when the application did not declare one.
     * @type {CatchAllRoute | null} */
    catchAllRoute = null;
    /**
     * Runs catch all. Declares the application's catch-all route: unmatched
     * requests resolve to the given controller/action instead of the built-in
     * errors not-found response.
     * @param {import("./catch-all-route.js").CatchAllRouteOptions} [options] - Catch-all options.
     * @returns {void} - No return value.
     */
    catchAll(options = {}) {
        if (this.catchAllRoute)
            throw new Error("Only one catchAll route can be declared");
        this.catchAllRoute = new CatchAllRoute(options);
    }
    getHumanPaths() {
        /** @type {Array<{action: string | null, method: string, path: string}>} */
        const humanPaths = [
            { method: "GET", action: "index", path: "/" }
        ];
        if (this.catchAllRoute)
            humanPaths.push(...this.catchAllRoute.getHumanPaths());
        return humanPaths;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm9vdC1yb3V0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9yb3V0ZXMvcm9vdC1yb3V0ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFFaEQsTUFBTSxDQUFDLE9BQU8sT0FBTyxrQkFBbUIsU0FBUSxVQUFVO0lBQ3hEOzs7c0NBR2tDO0lBQ2xDLGFBQWEsR0FBRyxJQUFJLENBQUE7SUFFcEI7Ozs7OztPQU1HO0lBQ0gsUUFBUSxDQUFDLE9BQU8sR0FBRyxFQUFFO1FBQ25CLElBQUksSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlDQUF5QyxDQUFDLENBQUE7UUFFbEYsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUNqRCxDQUFDO0lBRUQsYUFBYTtRQUNYLDJFQUEyRTtRQUMzRSxNQUFNLFVBQVUsR0FBRztZQUNqQixFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFDO1NBQzVDLENBQUE7UUFFRCxJQUFJLElBQUksQ0FBQyxhQUFhO1lBQUUsVUFBVSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQTtRQUU5RSxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2ljUm91dGUgZnJvbSBcIi4vYmFzaWMtcm91dGUuanNcIlxuaW1wb3J0IENhdGNoQWxsUm91dGUgZnJvbSBcIi4vY2F0Y2gtYWxsLXJvdXRlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzUm9vdFJvdXRlIGV4dGVuZHMgQmFzaWNSb3V0ZSB7XG4gIC8qKlxuICAgKiBBcHBsaWNhdGlvbiBjYXRjaC1hbGwgcm91dGUgZGVjbGFyZWQgd2l0aCBgcm91dGUuY2F0Y2hBbGwoLi4uKWAsIG9yIG51bGxcbiAgICogd2hlbiB0aGUgYXBwbGljYXRpb24gZGlkIG5vdCBkZWNsYXJlIG9uZS5cbiAgICogQHR5cGUge0NhdGNoQWxsUm91dGUgfCBudWxsfSAqL1xuICBjYXRjaEFsbFJvdXRlID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIGNhdGNoIGFsbC4gRGVjbGFyZXMgdGhlIGFwcGxpY2F0aW9uJ3MgY2F0Y2gtYWxsIHJvdXRlOiB1bm1hdGNoZWRcbiAgICogcmVxdWVzdHMgcmVzb2x2ZSB0byB0aGUgZ2l2ZW4gY29udHJvbGxlci9hY3Rpb24gaW5zdGVhZCBvZiB0aGUgYnVpbHQtaW5cbiAgICogZXJyb3JzIG5vdC1mb3VuZCByZXNwb25zZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NhdGNoLWFsbC1yb3V0ZS5qc1wiKS5DYXRjaEFsbFJvdXRlT3B0aW9uc30gW29wdGlvbnNdIC0gQ2F0Y2gtYWxsIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNhdGNoQWxsKG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICh0aGlzLmNhdGNoQWxsUm91dGUpIHRocm93IG5ldyBFcnJvcihcIk9ubHkgb25lIGNhdGNoQWxsIHJvdXRlIGNhbiBiZSBkZWNsYXJlZFwiKVxuXG4gICAgdGhpcy5jYXRjaEFsbFJvdXRlID0gbmV3IENhdGNoQWxsUm91dGUob3B0aW9ucylcbiAgfVxuXG4gIGdldEh1bWFuUGF0aHMoKSB7XG4gICAgLyoqIEB0eXBlIHtBcnJheTx7YWN0aW9uOiBzdHJpbmcgfCBudWxsLCBtZXRob2Q6IHN0cmluZywgcGF0aDogc3RyaW5nfT59ICovXG4gICAgY29uc3QgaHVtYW5QYXRocyA9IFtcbiAgICAgIHttZXRob2Q6IFwiR0VUXCIsIGFjdGlvbjogXCJpbmRleFwiLCBwYXRoOiBcIi9cIn1cbiAgICBdXG5cbiAgICBpZiAodGhpcy5jYXRjaEFsbFJvdXRlKSBodW1hblBhdGhzLnB1c2goLi4udGhpcy5jYXRjaEFsbFJvdXRlLmdldEh1bWFuUGF0aHMoKSlcblxuICAgIHJldHVybiBodW1hblBhdGhzXG4gIH1cbn1cbiJdfQ==