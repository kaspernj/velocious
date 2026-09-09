// @ts-check
import VelociousBackgroundJobsWebController from "./controller.js";
import BackgroundJobCountsChannel from "./counts-channel.js";
import { matchJobsApiPath, normalizeMountPrefix } from "./path-matcher.js";
import { registerJobsMount } from "./registry.js";
/**
 * Mountable read-only background-jobs dashboard API. Include it in a routes file
 * the way Sidekiq::Web is mounted in Rails:
 *
 * ```js
 * routes.draw((route) => {
 *   route.mount(VelociousBackgroundJobsApi, {
 *     at: "/velocious/jobs",
 *     authorize: async ({request, ability}) => { ... },
 *     accessTokens: [process.env.VELOCIOUS_JOBS_TOKEN]
 *   })
 * })
 * ```
 */
export default class VelociousBackgroundJobsApi {
    /**
     * Registers the jobs API under `at`. Implemented as a route-resolver hook so
     * the controller can live inside the velocious package rather than the host
     * app's `src/routes` directory. Invoked by the routing layer for each
     * `route.mount(...)` registration.
     * @param {object} args - Options.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.at - Mount path prefix (e.g. "/velocious/jobs").
     * @param {import("./registry.js").JobsMountOptions["authorize"]} [args.authorize] - Authorization callback.
     * @param {string[]} [args.accessTokens] - Accepted bearer tokens for cross-origin/native access.
     * @param {string[]} [args.allowedOrigins] - Allowed CORS origins for browser access.
     * @param {boolean} [args.redactArgs] - When true, job arguments are omitted from responses.
     * @param {string} [args.databaseIdentifier] - Database identifier the jobs store reads from.
     * @returns {void} - No return value.
     */
    static mountInto({ accessTokens, allowedOrigins, at, authorize, configuration, databaseIdentifier, redactArgs }) {
        if (!configuration)
            throw new Error("No configuration given");
        const prefix = normalizeMountPrefix(at);
        registerJobsMount(configuration, prefix, { accessTokens, allowedOrigins, authorize, databaseIdentifier, redactArgs });
        BackgroundJobCountsChannel.register(configuration);
        configuration.addRouteResolverHook(({ currentPath, request }) => {
            const match = matchJobsApiPath({ method: request.httpMethod(), path: currentPath, prefix });
            if (!match)
                return null;
            return {
                action: match.action,
                controller: "velociousBackgroundJobsWeb",
                controllerClass: VelociousBackgroundJobsWebController,
                params: { ...match.params, velociousJobsMountAt: prefix }
            };
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3dlYi9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxvQ0FBb0MsTUFBTSxpQkFBaUIsQ0FBQTtBQUNsRSxPQUFPLDBCQUEwQixNQUFNLHFCQUFxQixDQUFBO0FBQzVELE9BQU8sRUFBQyxnQkFBZ0IsRUFBRSxvQkFBb0IsRUFBQyxNQUFNLG1CQUFtQixDQUFBO0FBQ3hFLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLGVBQWUsQ0FBQTtBQUUvQzs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTywwQkFBMEI7SUFDN0M7Ozs7Ozs7Ozs7Ozs7O09BY0c7SUFDSCxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQUMsWUFBWSxFQUFFLGNBQWMsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEVBQUM7UUFDM0csSUFBSSxDQUFDLGFBQWE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFFN0QsTUFBTSxNQUFNLEdBQUcsb0JBQW9CLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFdkMsaUJBQWlCLENBQUMsYUFBYSxFQUFFLE1BQU0sRUFBRSxFQUFDLFlBQVksRUFBRSxjQUFjLEVBQUUsU0FBUyxFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDbkgsMEJBQTBCLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRWxELGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLEVBQUMsV0FBVyxFQUFFLE9BQU8sRUFBQyxFQUFFLEVBQUU7WUFDNUQsTUFBTSxLQUFLLEdBQUcsZ0JBQWdCLENBQUMsRUFBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUV6RixJQUFJLENBQUMsS0FBSztnQkFBRSxPQUFPLElBQUksQ0FBQTtZQUV2QixPQUFPO2dCQUNMLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtnQkFDcEIsVUFBVSxFQUFFLDRCQUE0QjtnQkFDeEMsZUFBZSxFQUFFLG9DQUFvQztnQkFDckQsTUFBTSxFQUFFLEVBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLG9CQUFvQixFQUFFLE1BQU0sRUFBQzthQUN4RCxDQUFBO1FBQ0gsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFZlbG9jaW91c0JhY2tncm91bmRKb2JzV2ViQ29udHJvbGxlciBmcm9tIFwiLi9jb250cm9sbGVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iQ291bnRzQ2hhbm5lbCBmcm9tIFwiLi9jb3VudHMtY2hhbm5lbC5qc1wiXG5pbXBvcnQge21hdGNoSm9ic0FwaVBhdGgsIG5vcm1hbGl6ZU1vdW50UHJlZml4fSBmcm9tIFwiLi9wYXRoLW1hdGNoZXIuanNcIlxuaW1wb3J0IHtyZWdpc3RlckpvYnNNb3VudH0gZnJvbSBcIi4vcmVnaXN0cnkuanNcIlxuXG4vKipcbiAqIE1vdW50YWJsZSByZWFkLW9ubHkgYmFja2dyb3VuZC1qb2JzIGRhc2hib2FyZCBBUEkuIEluY2x1ZGUgaXQgaW4gYSByb3V0ZXMgZmlsZVxuICogdGhlIHdheSBTaWRla2lxOjpXZWIgaXMgbW91bnRlZCBpbiBSYWlsczpcbiAqXG4gKiBgYGBqc1xuICogcm91dGVzLmRyYXcoKHJvdXRlKSA9PiB7XG4gKiAgIHJvdXRlLm1vdW50KFZlbG9jaW91c0JhY2tncm91bmRKb2JzQXBpLCB7XG4gKiAgICAgYXQ6IFwiL3ZlbG9jaW91cy9qb2JzXCIsXG4gKiAgICAgYXV0aG9yaXplOiBhc3luYyAoe3JlcXVlc3QsIGFiaWxpdHl9KSA9PiB7IC4uLiB9LFxuICogICAgIGFjY2Vzc1Rva2VuczogW3Byb2Nlc3MuZW52LlZFTE9DSU9VU19KT0JTX1RPS0VOXVxuICogICB9KVxuICogfSlcbiAqIGBgYFxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNCYWNrZ3JvdW5kSm9ic0FwaSB7XG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhlIGpvYnMgQVBJIHVuZGVyIGBhdGAuIEltcGxlbWVudGVkIGFzIGEgcm91dGUtcmVzb2x2ZXIgaG9vayBzb1xuICAgKiB0aGUgY29udHJvbGxlciBjYW4gbGl2ZSBpbnNpZGUgdGhlIHZlbG9jaW91cyBwYWNrYWdlIHJhdGhlciB0aGFuIHRoZSBob3N0XG4gICAqIGFwcCdzIGBzcmMvcm91dGVzYCBkaXJlY3RvcnkuIEludm9rZWQgYnkgdGhlIHJvdXRpbmcgbGF5ZXIgZm9yIGVhY2hcbiAgICogYHJvdXRlLm1vdW50KC4uLilgIHJlZ2lzdHJhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXQgLSBNb3VudCBwYXRoIHByZWZpeCAoZS5nLiBcIi92ZWxvY2lvdXMvam9ic1wiKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlZ2lzdHJ5LmpzXCIpLkpvYnNNb3VudE9wdGlvbnNbXCJhdXRob3JpemVcIl19IFthcmdzLmF1dGhvcml6ZV0gLSBBdXRob3JpemF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5hY2Nlc3NUb2tlbnNdIC0gQWNjZXB0ZWQgYmVhcmVyIHRva2VucyBmb3IgY3Jvc3Mtb3JpZ2luL25hdGl2ZSBhY2Nlc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLmFsbG93ZWRPcmlnaW5zXSAtIEFsbG93ZWQgQ09SUyBvcmlnaW5zIGZvciBicm93c2VyIGFjY2Vzcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZWRhY3RBcmdzXSAtIFdoZW4gdHJ1ZSwgam9iIGFyZ3VtZW50cyBhcmUgb21pdHRlZCBmcm9tIHJlc3BvbnNlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyIHRoZSBqb2JzIHN0b3JlIHJlYWRzIGZyb20uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBtb3VudEludG8oe2FjY2Vzc1Rva2VucywgYWxsb3dlZE9yaWdpbnMsIGF0LCBhdXRob3JpemUsIGNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgcmVkYWN0QXJnc30pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW5cIilcblxuICAgIGNvbnN0IHByZWZpeCA9IG5vcm1hbGl6ZU1vdW50UHJlZml4KGF0KVxuXG4gICAgcmVnaXN0ZXJKb2JzTW91bnQoY29uZmlndXJhdGlvbiwgcHJlZml4LCB7YWNjZXNzVG9rZW5zLCBhbGxvd2VkT3JpZ2lucywgYXV0aG9yaXplLCBkYXRhYmFzZUlkZW50aWZpZXIsIHJlZGFjdEFyZ3N9KVxuICAgIEJhY2tncm91bmRKb2JDb3VudHNDaGFubmVsLnJlZ2lzdGVyKGNvbmZpZ3VyYXRpb24pXG5cbiAgICBjb25maWd1cmF0aW9uLmFkZFJvdXRlUmVzb2x2ZXJIb29rKCh7Y3VycmVudFBhdGgsIHJlcXVlc3R9KSA9PiB7XG4gICAgICBjb25zdCBtYXRjaCA9IG1hdGNoSm9ic0FwaVBhdGgoe21ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kKCksIHBhdGg6IGN1cnJlbnRQYXRoLCBwcmVmaXh9KVxuXG4gICAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3Rpb246IG1hdGNoLmFjdGlvbixcbiAgICAgICAgY29udHJvbGxlcjogXCJ2ZWxvY2lvdXNCYWNrZ3JvdW5kSm9ic1dlYlwiLFxuICAgICAgICBjb250cm9sbGVyQ2xhc3M6IFZlbG9jaW91c0JhY2tncm91bmRKb2JzV2ViQ29udHJvbGxlcixcbiAgICAgICAgcGFyYW1zOiB7Li4ubWF0Y2gucGFyYW1zLCB2ZWxvY2lvdXNKb2JzTW91bnRBdDogcHJlZml4fVxuICAgICAgfVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==