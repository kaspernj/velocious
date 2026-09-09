// @ts-check
/** Platform-neutral producer client for a configured adapter. */
export default class BackgroundJobsAdapterClient {
    /**
     * Creates an adapter-backed producer.
     * @param {{configuration: import("../configuration.js").default}} args - Client options.
     */
    constructor({ configuration }) {
        this.configuration = configuration;
    }
    /**
     * Enqueues a job through the configured adapter.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Job request.
     * @returns {Promise<string>} - Job id.
     */
    async enqueue(args) {
        const adapter = await this.configuration.acquireReadyBackgroundJobsAdapter();
        return await adapter.enqueue(args);
    }
    /**
     * Replaces a stable schedule through the configured adapter.
     * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Replacement request.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    async replaceScheduled(args) {
        const adapter = await this.configuration.acquireReadyBackgroundJobsAdapter();
        return await adapter.replaceScheduled(args);
    }
    /**
     * Cancels a stable schedule through the configured adapter.
     * @param {{scheduleKey: string}} args - Cancellation request.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    async cancelScheduled({ scheduleKey }) {
        const adapter = await this.configuration.acquireReadyBackgroundJobsAdapter();
        return await adapter.cancelScheduled(scheduleKey);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWRhcHRlci1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXItY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixpRUFBaUU7QUFDakUsTUFBTSxDQUFDLE9BQU8sT0FBTywyQkFBMkI7SUFDOUM7OztPQUdHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBQztRQUN6QixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSTtRQUNoQixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsaUNBQWlDLEVBQUUsQ0FBQTtRQUU1RSxPQUFPLE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJO1FBQ3pCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQ0FBaUMsRUFBRSxDQUFBO1FBRTVFLE9BQU8sTUFBTSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLEVBQUMsV0FBVyxFQUFDO1FBQ2pDLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQ0FBaUMsRUFBRSxDQUFBO1FBRTVFLE9BQU8sTUFBTSxPQUFPLENBQUMsZUFBZSxDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBQ25ELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKiogUGxhdGZvcm0tbmV1dHJhbCBwcm9kdWNlciBjbGllbnQgZm9yIGEgY29uZmlndXJlZCBhZGFwdGVyLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNBZGFwdGVyQ2xpZW50IHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYW4gYWRhcHRlci1iYWNrZWQgcHJvZHVjZXIuXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19IGFyZ3MgLSBDbGllbnQgb3B0aW9ucy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9ufSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnF1ZXVlcyBhIGpvYiB0aHJvdWdoIHRoZSBjb25maWd1cmVkIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7e2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IGFyZ3MgLSBKb2IgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKGFyZ3MpIHtcbiAgICBjb25zdCBhZGFwdGVyID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgYWRhcHRlci5lbnF1ZXVlKGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgYSBzdGFibGUgc2NoZWR1bGUgdGhyb3VnaCB0aGUgY29uZmlndXJlZCBhZGFwdGVyLlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBhcmdzIC0gUmVwbGFjZW1lbnQgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoYXJncykge1xuICAgIGNvbnN0IGFkYXB0ZXIgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIHJldHVybiBhd2FpdCBhZGFwdGVyLnJlcGxhY2VTY2hlZHVsZWQoYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGEgc3RhYmxlIHNjaGVkdWxlIHRocm91Z2ggdGhlIGNvbmZpZ3VyZWQgYWRhcHRlci5cbiAgICogQHBhcmFtIHt7c2NoZWR1bGVLZXk6IHN0cmluZ319IGFyZ3MgLSBDYW5jZWxsYXRpb24gcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsU2NoZWR1bGVkKHtzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCBhZGFwdGVyID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmFjcXVpcmVSZWFkeUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgYWRhcHRlci5jYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpXG4gIH1cbn1cbiJdfQ==