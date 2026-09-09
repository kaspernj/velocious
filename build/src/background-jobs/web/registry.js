// @ts-check
/**
 * JobsMountOptions type.
 * @typedef {object} JobsMountOptions
 * @property {(args: {request: import("../../http-server/client/request.js").default | import("../../http-server/client/websocket-request.js").default, ability: (import("../../authorization/ability.js").default | undefined), token: (string | null), configuration: import("../../configuration.js").default}) => (boolean | void | Promise<boolean | void>)} [authorize] - Authorization callback. Return true to allow the request.
 * @property {string[]} [accessTokens] - Bearer tokens accepted for cross-origin/native access.
 * @property {string[]} [allowedOrigins] - Origins allowed for cross-origin browser access.
 * @property {boolean} [redactArgs] - When true, job arguments are omitted from API responses.
 * @property {string} [databaseIdentifier] - Database identifier the jobs store reads from.
 */
/**
 * Mount options are keyed by configuration so multiple configurations (e.g.
 * across tests) never share state, and by mount path so a single configuration
 * can mount the dashboard at more than one prefix. Functions in the options
 * (the `authorize` callback) can't travel through route params, so the
 * controller looks them up here using the plain `at` string it receives.
 * @type {WeakMap<import("../../configuration.js").default, Map<string, JobsMountOptions>>}
 */
const registry = new WeakMap();
/**
 * Runs the registerJobsMount helper.
 * @param {import("../../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @param {JobsMountOptions} options - Mount options.
 * @returns {void} - No return value.
 */
export function registerJobsMount(configuration, at, options) {
    let byPath = registry.get(configuration);
    if (!byPath) {
        byPath = new Map();
        registry.set(configuration, byPath);
    }
    byPath.set(at, options);
}
/**
 * Runs the getJobsMount helper.
 * @param {import("../../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @returns {JobsMountOptions | undefined} - Mount options if registered.
 */
export function getJobsMount(configuration, at) {
    return registry.get(configuration)?.get(at);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVnaXN0cnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3dlYi9yZWdpc3RyeS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7Ozs7O0dBUUc7QUFFSDs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxRQUFRLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUU5Qjs7Ozs7O0dBTUc7QUFDSCxNQUFNLFVBQVUsaUJBQWlCLENBQUMsYUFBYSxFQUFFLEVBQUUsRUFBRSxPQUFPO0lBQzFELElBQUksTUFBTSxHQUFHLFFBQVEsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7SUFFeEMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ1osTUFBTSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDbEIsUUFBUSxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUE7SUFDckMsQ0FBQztJQUVELE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFBO0FBQ3pCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSxZQUFZLENBQUMsYUFBYSxFQUFFLEVBQUU7SUFDNUMsT0FBTyxRQUFRLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUM3QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogSm9ic01vdW50T3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gSm9ic01vdW50T3B0aW9uc1xuICogQHByb3BlcnR5IHsoYXJnczoge3JlcXVlc3Q6IGltcG9ydChcIi4uLy4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi8uLi9odHRwLXNlcnZlci9jbGllbnQvd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdCwgYWJpbGl0eTogKGltcG9ydChcIi4uLy4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkKSwgdG9rZW46IChzdHJpbmcgfCBudWxsKSwgY29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSkgPT4gKGJvb2xlYW4gfCB2b2lkIHwgUHJvbWlzZTxib29sZWFuIHwgdm9pZD4pfSBbYXV0aG9yaXplXSAtIEF1dGhvcml6YXRpb24gY2FsbGJhY2suIFJldHVybiB0cnVlIHRvIGFsbG93IHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW2FjY2Vzc1Rva2Vuc10gLSBCZWFyZXIgdG9rZW5zIGFjY2VwdGVkIGZvciBjcm9zcy1vcmlnaW4vbmF0aXZlIGFjY2Vzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFthbGxvd2VkT3JpZ2luc10gLSBPcmlnaW5zIGFsbG93ZWQgZm9yIGNyb3NzLW9yaWdpbiBicm93c2VyIGFjY2Vzcy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3JlZGFjdEFyZ3NdIC0gV2hlbiB0cnVlLCBqb2IgYXJndW1lbnRzIGFyZSBvbWl0dGVkIGZyb20gQVBJIHJlc3BvbnNlcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIgdGhlIGpvYnMgc3RvcmUgcmVhZHMgZnJvbS5cbiAqL1xuXG4vKipcbiAqIE1vdW50IG9wdGlvbnMgYXJlIGtleWVkIGJ5IGNvbmZpZ3VyYXRpb24gc28gbXVsdGlwbGUgY29uZmlndXJhdGlvbnMgKGUuZy5cbiAqIGFjcm9zcyB0ZXN0cykgbmV2ZXIgc2hhcmUgc3RhdGUsIGFuZCBieSBtb3VudCBwYXRoIHNvIGEgc2luZ2xlIGNvbmZpZ3VyYXRpb25cbiAqIGNhbiBtb3VudCB0aGUgZGFzaGJvYXJkIGF0IG1vcmUgdGhhbiBvbmUgcHJlZml4LiBGdW5jdGlvbnMgaW4gdGhlIG9wdGlvbnNcbiAqICh0aGUgYGF1dGhvcml6ZWAgY2FsbGJhY2spIGNhbid0IHRyYXZlbCB0aHJvdWdoIHJvdXRlIHBhcmFtcywgc28gdGhlXG4gKiBjb250cm9sbGVyIGxvb2tzIHRoZW0gdXAgaGVyZSB1c2luZyB0aGUgcGxhaW4gYGF0YCBzdHJpbmcgaXQgcmVjZWl2ZXMuXG4gKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIEpvYnNNb3VudE9wdGlvbnM+Pn1cbiAqL1xuY29uc3QgcmVnaXN0cnkgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUnVucyB0aGUgcmVnaXN0ZXJKb2JzTW91bnQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IGF0IC0gTm9ybWFsaXplZCBtb3VudCBwYXRoLlxuICogQHBhcmFtIHtKb2JzTW91bnRPcHRpb25zfSBvcHRpb25zIC0gTW91bnQgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVySm9ic01vdW50KGNvbmZpZ3VyYXRpb24sIGF0LCBvcHRpb25zKSB7XG4gIGxldCBieVBhdGggPSByZWdpc3RyeS5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIWJ5UGF0aCkge1xuICAgIGJ5UGF0aCA9IG5ldyBNYXAoKVxuICAgIHJlZ2lzdHJ5LnNldChjb25maWd1cmF0aW9uLCBieVBhdGgpXG4gIH1cblxuICBieVBhdGguc2V0KGF0LCBvcHRpb25zKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGdldEpvYnNNb3VudCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXQgLSBOb3JtYWxpemVkIG1vdW50IHBhdGguXG4gKiBAcmV0dXJucyB7Sm9ic01vdW50T3B0aW9ucyB8IHVuZGVmaW5lZH0gLSBNb3VudCBvcHRpb25zIGlmIHJlZ2lzdGVyZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRKb2JzTW91bnQoY29uZmlndXJhdGlvbiwgYXQpIHtcbiAgcmV0dXJuIHJlZ2lzdHJ5LmdldChjb25maWd1cmF0aW9uKT8uZ2V0KGF0KVxufVxuIl19