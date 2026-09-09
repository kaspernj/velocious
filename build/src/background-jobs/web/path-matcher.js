// @ts-check
import { mountSubPath, normalizeMountPrefix } from "../../utils/mount-prefix.js";
/**
 * @typedef {object} JobsApiMatch
 * @property {string} action - Controller action to run.
 * @property {Record<string, string>} params - Extra params extracted from the path.
 */
export { normalizeMountPrefix };
/**
 * Matches an incoming request against the read-only jobs API routes that live
 * under the mount prefix. Returns the controller action plus any extracted
 * params, or null when the path/method isn't part of the jobs API.
 * @param {object} args - Options.
 * @param {string} args.prefix - Normalized mount prefix.
 * @param {string} args.path - Request path without query string.
 * @param {string} args.method - HTTP method.
 * @returns {JobsApiMatch | null} - Matched action or null.
 */
export function matchJobsApiPath({ prefix, path, method }) {
    const subPath = mountSubPath({ prefix, path });
    if (subPath === null)
        return null;
    if (method === "GET" && subPath === "/api/health")
        return { action: "health", params: {} };
    if (method === "GET" && subPath === "/api/stats")
        return { action: "stats", params: {} };
    if (method === "GET" && subPath === "/api/schedule")
        return { action: "schedule", params: {} };
    if (method === "GET" && subPath === "/api/jobs")
        return { action: "index", params: {} };
    if (method === "GET") {
        const jobMatch = subPath.match(/^\/api\/jobs\/([^/]+)$/);
        if (jobMatch) {
            let id;
            try {
                id = decodeURIComponent(jobMatch[1]);
            }
            catch {
                return null;
            }
            return { action: "show", params: { id } };
        }
    }
    return null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0aC1tYXRjaGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93ZWIvcGF0aC1tYXRjaGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsWUFBWSxFQUFFLG9CQUFvQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFFOUU7Ozs7R0FJRztBQUNILE9BQU8sRUFBQyxvQkFBb0IsRUFBQyxDQUFBO0FBRTdCOzs7Ozs7Ozs7R0FTRztBQUNILE1BQU0sVUFBVSxnQkFBZ0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFDO0lBQ3JELE1BQU0sT0FBTyxHQUFHLFlBQVksQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBRTVDLElBQUksT0FBTyxLQUFLLElBQUk7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUVqQyxJQUFJLE1BQU0sS0FBSyxLQUFLLElBQUksT0FBTyxLQUFLLGFBQWE7UUFBRSxPQUFPLEVBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFDLENBQUE7SUFDeEYsSUFBSSxNQUFNLEtBQUssS0FBSyxJQUFJLE9BQU8sS0FBSyxZQUFZO1FBQUUsT0FBTyxFQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBQyxDQUFBO0lBQ3RGLElBQUksTUFBTSxLQUFLLEtBQUssSUFBSSxPQUFPLEtBQUssZUFBZTtRQUFFLE9BQU8sRUFBQyxNQUFNLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUMsQ0FBQTtJQUM1RixJQUFJLE1BQU0sS0FBSyxLQUFLLElBQUksT0FBTyxLQUFLLFdBQVc7UUFBRSxPQUFPLEVBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFDLENBQUE7SUFFckYsSUFBSSxNQUFNLEtBQUssS0FBSyxFQUFFLENBQUM7UUFDckIsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBRXhELElBQUksUUFBUSxFQUFFLENBQUM7WUFDYixJQUFJLEVBQUUsQ0FBQTtZQUVOLElBQUksQ0FBQztnQkFDSCxFQUFFLEdBQUcsa0JBQWtCLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDdEMsQ0FBQztZQUFDLE1BQU0sQ0FBQztnQkFDUCxPQUFPLElBQUksQ0FBQTtZQUNiLENBQUM7WUFFRCxPQUFPLEVBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsRUFBQyxFQUFFLEVBQUMsRUFBQyxDQUFBO1FBQ3ZDLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7bW91bnRTdWJQYXRoLCBub3JtYWxpemVNb3VudFByZWZpeH0gZnJvbSBcIi4uLy4uL3V0aWxzL21vdW50LXByZWZpeC5qc1wiXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gSm9ic0FwaU1hdGNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYWN0aW9uIC0gQ29udHJvbGxlciBhY3Rpb24gdG8gcnVuLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBwYXJhbXMgLSBFeHRyYSBwYXJhbXMgZXh0cmFjdGVkIGZyb20gdGhlIHBhdGguXG4gKi9cbmV4cG9ydCB7bm9ybWFsaXplTW91bnRQcmVmaXh9XG5cbi8qKlxuICogTWF0Y2hlcyBhbiBpbmNvbWluZyByZXF1ZXN0IGFnYWluc3QgdGhlIHJlYWQtb25seSBqb2JzIEFQSSByb3V0ZXMgdGhhdCBsaXZlXG4gKiB1bmRlciB0aGUgbW91bnQgcHJlZml4LiBSZXR1cm5zIHRoZSBjb250cm9sbGVyIGFjdGlvbiBwbHVzIGFueSBleHRyYWN0ZWRcbiAqIHBhcmFtcywgb3IgbnVsbCB3aGVuIHRoZSBwYXRoL21ldGhvZCBpc24ndCBwYXJ0IG9mIHRoZSBqb2JzIEFQSS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByZWZpeCAtIE5vcm1hbGl6ZWQgbW91bnQgcHJlZml4LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGF0aCAtIFJlcXVlc3QgcGF0aCB3aXRob3V0IHF1ZXJ5IHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1ldGhvZCAtIEhUVFAgbWV0aG9kLlxuICogQHJldHVybnMge0pvYnNBcGlNYXRjaCB8IG51bGx9IC0gTWF0Y2hlZCBhY3Rpb24gb3IgbnVsbC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hdGNoSm9ic0FwaVBhdGgoe3ByZWZpeCwgcGF0aCwgbWV0aG9kfSkge1xuICBjb25zdCBzdWJQYXRoID0gbW91bnRTdWJQYXRoKHtwcmVmaXgsIHBhdGh9KVxuXG4gIGlmIChzdWJQYXRoID09PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gIGlmIChtZXRob2QgPT09IFwiR0VUXCIgJiYgc3ViUGF0aCA9PT0gXCIvYXBpL2hlYWx0aFwiKSByZXR1cm4ge2FjdGlvbjogXCJoZWFsdGhcIiwgcGFyYW1zOiB7fX1cbiAgaWYgKG1ldGhvZCA9PT0gXCJHRVRcIiAmJiBzdWJQYXRoID09PSBcIi9hcGkvc3RhdHNcIikgcmV0dXJuIHthY3Rpb246IFwic3RhdHNcIiwgcGFyYW1zOiB7fX1cbiAgaWYgKG1ldGhvZCA9PT0gXCJHRVRcIiAmJiBzdWJQYXRoID09PSBcIi9hcGkvc2NoZWR1bGVcIikgcmV0dXJuIHthY3Rpb246IFwic2NoZWR1bGVcIiwgcGFyYW1zOiB7fX1cbiAgaWYgKG1ldGhvZCA9PT0gXCJHRVRcIiAmJiBzdWJQYXRoID09PSBcIi9hcGkvam9ic1wiKSByZXR1cm4ge2FjdGlvbjogXCJpbmRleFwiLCBwYXJhbXM6IHt9fVxuXG4gIGlmIChtZXRob2QgPT09IFwiR0VUXCIpIHtcbiAgICBjb25zdCBqb2JNYXRjaCA9IHN1YlBhdGgubWF0Y2goL15cXC9hcGlcXC9qb2JzXFwvKFteL10rKSQvKVxuXG4gICAgaWYgKGpvYk1hdGNoKSB7XG4gICAgICBsZXQgaWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWQgPSBkZWNvZGVVUklDb21wb25lbnQoam9iTWF0Y2hbMV0pXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHthY3Rpb246IFwic2hvd1wiLCBwYXJhbXM6IHtpZH19XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cbiJdfQ==