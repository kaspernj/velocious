// @ts-check
import restArgsError from "../utils/rest-args-error.js";
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
    controller;
    /**
     * Action name unmatched requests resolve to.
     * @type {string} */
    action;
    /**
     * Runs constructor.
     * @param {CatchAllRouteOptions} [options] - Catch-all options.
     */
    constructor({ controller = "_root", action = "notFound", ...restArgs } = {}) {
        restArgsError(restArgs);
        if (typeof controller !== "string" || controller.length < 1) {
            throw new Error(`Expected catch-all 'controller' to be a non-empty string, got: ${String(controller)}`);
        }
        if (typeof action !== "string" || action.length < 1) {
            throw new Error(`Expected catch-all 'action' to be a non-empty string, got: ${String(action)}`);
        }
        this.controller = controller;
        this.action = action;
    }
    /**
     * Runs get human paths.
     * @returns {Array<{action: string | null, method: string, path: string}>} - Route definitions for this route.
     */
    getHumanPaths() {
        return [
            { method: "ANY", action: this.action, path: "*" }
        ];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2F0Y2gtYWxsLXJvdXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3JvdXRlcy9jYXRjaC1hbGwtcm91dGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZEOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTywyQkFBMkI7SUFDOUM7O3dCQUVvQjtJQUNwQixVQUFVLENBQUE7SUFFVjs7d0JBRW9CO0lBQ3BCLE1BQU0sQ0FBQTtJQUVOOzs7T0FHRztJQUNILFlBQVksRUFBQyxVQUFVLEdBQUcsT0FBTyxFQUFFLE1BQU0sR0FBRyxVQUFVLEVBQUUsR0FBRyxRQUFRLEVBQUMsR0FBRyxFQUFFO1FBQ3ZFLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLE9BQU8sVUFBVSxLQUFLLFFBQVEsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzVELE1BQU0sSUFBSSxLQUFLLENBQUMsa0VBQWtFLE1BQU0sQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDekcsQ0FBQztRQUVELElBQUksT0FBTyxNQUFNLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDcEQsTUFBTSxJQUFJLEtBQUssQ0FBQyw4REFBOEQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNqRyxDQUFDO1FBRUQsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7UUFDNUIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILGFBQWE7UUFDWCxPQUFPO1lBQ0wsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUM7U0FDaEQsQ0FBQTtJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBDYXRjaC1hbGwgcm91dGUgb3B0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENhdGNoQWxsUm91dGVPcHRpb25zXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbnRyb2xsZXJdIC0gQ29udHJvbGxlciBuYW1lIHVubWF0Y2hlZCByZXF1ZXN0cyByZXNvbHZlIHRvLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFthY3Rpb25dIC0gQWN0aW9uIG5hbWUgdW5tYXRjaGVkIHJlcXVlc3RzIHJlc29sdmUgdG8uXG4gKi9cblxuLyoqXG4gKiBBcHBsaWNhdGlvbi1kZWNsYXJlZCBjYXRjaC1hbGwgcm91dGUgY3JlYXRlZCB3aXRoIGByb3V0ZS5jYXRjaEFsbCguLi4pYCBpblxuICogdGhlIHJvdXRlcyBmaWxlLiBJdCBpcyBub3QgYSBwYXRoIG1hdGNoZXI6IHRoZSByZXNvbHZlciBhcHBsaWVzIGl0IG9ubHlcbiAqIHdoZW4gbm8gb3RoZXIgcm91dGUgaW4gdGhlIHRyZWUgbWF0Y2hlZCwgcmVwbGFjaW5nIHRoZSBidWlsdC1pbiBlcnJvcnNcbiAqIG5vdC1mb3VuZCByZXNwb25zZSB3aXRoIHRoZSBhcHBsaWNhdGlvbidzIG93biBjb250cm9sbGVyL2FjdGlvbiAoZm9yXG4gKiBleGFtcGxlIGEgSlNPTiBlcnJvciBlbnZlbG9wZSkgd2l0aG91dCBoYW5kLXdpcmluZyBhIHJvdXRlIHJlc29sdmVyIGhvb2suXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1JvdXRlQ2F0Y2hBbGxSb3V0ZSB7XG4gIC8qKlxuICAgKiBDb250cm9sbGVyIG5hbWUgdW5tYXRjaGVkIHJlcXVlc3RzIHJlc29sdmUgdG8uXG4gICAqIEB0eXBlIHtzdHJpbmd9ICovXG4gIGNvbnRyb2xsZXJcblxuICAvKipcbiAgICogQWN0aW9uIG5hbWUgdW5tYXRjaGVkIHJlcXVlc3RzIHJlc29sdmUgdG8uXG4gICAqIEB0eXBlIHtzdHJpbmd9ICovXG4gIGFjdGlvblxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0NhdGNoQWxsUm91dGVPcHRpb25zfSBbb3B0aW9uc10gLSBDYXRjaC1hbGwgb3B0aW9ucy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb250cm9sbGVyID0gXCJfcm9vdFwiLCBhY3Rpb24gPSBcIm5vdEZvdW5kXCIsIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICh0eXBlb2YgY29udHJvbGxlciAhPT0gXCJzdHJpbmdcIiB8fCBjb250cm9sbGVyLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgY2F0Y2gtYWxsICdjb250cm9sbGVyJyB0byBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcoY29udHJvbGxlcil9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhY3Rpb24ubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBjYXRjaC1hbGwgJ2FjdGlvbicgdG8gYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKGFjdGlvbil9YClcbiAgICB9XG5cbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBjb250cm9sbGVyXG4gICAgdGhpcy5hY3Rpb24gPSBhY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBodW1hbiBwYXRocy5cbiAgICogQHJldHVybnMge0FycmF5PHthY3Rpb246IHN0cmluZyB8IG51bGwsIG1ldGhvZDogc3RyaW5nLCBwYXRoOiBzdHJpbmd9Pn0gLSBSb3V0ZSBkZWZpbml0aW9ucyBmb3IgdGhpcyByb3V0ZS5cbiAgICovXG4gIGdldEh1bWFuUGF0aHMoKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHttZXRob2Q6IFwiQU5ZXCIsIGFjdGlvbjogdGhpcy5hY3Rpb24sIHBhdGg6IFwiKlwifVxuICAgIF1cbiAgfVxufVxuIl19