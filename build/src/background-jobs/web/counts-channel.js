// @ts-check
import { BACKGROUND_JOB_COUNTS_CHANNEL } from "../store.js";
import VelociousWebsocketChannel from "../../http-server/websocket-channel.js";
import { authorizeJobsRequest } from "./authorization.js";
import { getJobsMount } from "./registry.js";
import { normalizeMountPrefix } from "./path-matcher.js";
/**
 * Authorized dashboard count-delta channel. Clients subscribe with the mount
 * path and their normal bearer token as `authenticationToken`.
 */
export default class BackgroundJobCountsChannel extends VelociousWebsocketChannel {
    /**
     * Authorizes the subscription.
     * @returns {Promise<boolean>} Whether the mount's normal dashboard authorization allows the subscription.
     */
    async canSubscribe() {
        if (typeof this.params.mountAt !== "string")
            return false;
        const mountAt = normalizeMountPrefix(this.params.mountAt);
        const options = getJobsMount(this.session.configuration, mountAt);
        if (!options || !this.session.upgradeRequest)
            return false;
        const token = typeof this.params.authenticationToken === "string"
            ? this.params.authenticationToken
            : null;
        const ability = await this.session.configuration.resolveAbility({
            params: this.params,
            request: this.session.upgradeRequest
        });
        const authorized = await authorizeJobsRequest({
            ability,
            configuration: this.session.configuration,
            options,
            request: this.session.upgradeRequest,
            token
        });
        if (!authorized)
            return false;
        this.databaseIdentifier = options.databaseIdentifier
            || this.session.configuration.getBackgroundJobsConfig().databaseIdentifier
            || "default";
        return true;
    }
    /**
     * Matches only events from the database selected by the authorized mount.
     * @param {import("../../http-server/websocket-channel.js").WebsocketJsonValue} broadcastParams - Publisher scope.
     * @returns {boolean} Whether this subscription should receive the event.
     */
    matches(broadcastParams) {
        if (!broadcastParams || typeof broadcastParams !== "object" || Array.isArray(broadcastParams))
            return false;
        return String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (broadcastParams).databaseIdentifier) === this.databaseIdentifier;
    }
    /**
     * Builds diagnostics.
     * @returns {Record<string, string>} Non-sensitive diagnostics.
     */
    debugSnapshot() {
        return { databaseIdentifier: this.databaseIdentifier };
    }
    /** @type {string} */
    databaseIdentifier = "";
    /**
     * Registers the framework channel used by mounted jobs dashboards.
     * @param {import("../../configuration.js").default} configuration - Configuration.
     */
    static register(configuration) {
        configuration.registerWebsocketChannel(BACKGROUND_JOB_COUNTS_CHANNEL, this);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY291bnRzLWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3dlYi9jb3VudHMtY2hhbm5lbC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLDZCQUE2QixFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3pELE9BQU8seUJBQXlCLE1BQU0sd0NBQXdDLENBQUE7QUFDOUUsT0FBTyxFQUFDLG9CQUFvQixFQUFDLE1BQU0sb0JBQW9CLENBQUE7QUFDdkQsT0FBTyxFQUFDLFlBQVksRUFBQyxNQUFNLGVBQWUsQ0FBQTtBQUMxQyxPQUFPLEVBQUMsb0JBQW9CLEVBQUMsTUFBTSxtQkFBbUIsQ0FBQTtBQUV0RDs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEyQixTQUFRLHlCQUF5QjtJQUMvRTs7O09BR0c7SUFDSCxLQUFLLENBQUMsWUFBWTtRQUNoQixJQUFJLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEtBQUssUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXpELE1BQU0sT0FBTyxHQUFHLG9CQUFvQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDekQsTUFBTSxPQUFPLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBRWpFLElBQUksQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUUxRCxNQUFNLEtBQUssR0FBRyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEtBQUssUUFBUTtZQUMvRCxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUI7WUFDakMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUNSLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsY0FBYyxDQUFDO1lBQzlELE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNuQixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjO1NBQ3JDLENBQUMsQ0FBQTtRQUNGLE1BQU0sVUFBVSxHQUFHLE1BQU0sb0JBQW9CLENBQUM7WUFDNUMsT0FBTztZQUNQLGFBQWEsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWE7WUFDekMsT0FBTztZQUNQLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWM7WUFDcEMsS0FBSztTQUNOLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxVQUFVO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFN0IsSUFBSSxDQUFDLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxrQkFBa0I7ZUFDL0MsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQyxrQkFBa0I7ZUFDdkUsU0FBUyxDQUFBO1FBRWQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE9BQU8sQ0FBQyxlQUFlO1FBQ3JCLElBQUksQ0FBQyxlQUFlLElBQUksT0FBTyxlQUFlLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFM0csT0FBTyxNQUFNLENBQUMsNERBQTRELENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLElBQUksQ0FBQyxrQkFBa0IsQ0FBQTtJQUM5SSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsYUFBYTtRQUNYLE9BQU8sRUFBQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsa0JBQWtCLEVBQUMsQ0FBQTtJQUN0RCxDQUFDO0lBRUQscUJBQXFCO0lBQ3JCLGtCQUFrQixHQUFHLEVBQUUsQ0FBQTtJQUV2Qjs7O09BR0c7SUFDSCxNQUFNLENBQUMsUUFBUSxDQUFDLGFBQWE7UUFDM0IsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDZCQUE2QixFQUFFLElBQUksQ0FBQyxDQUFBO0lBQzdFLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge0JBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMfSBmcm9tIFwiLi4vc3RvcmUuanNcIlxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWwgZnJvbSBcIi4uLy4uL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCJcbmltcG9ydCB7YXV0aG9yaXplSm9ic1JlcXVlc3R9IGZyb20gXCIuL2F1dGhvcml6YXRpb24uanNcIlxuaW1wb3J0IHtnZXRKb2JzTW91bnR9IGZyb20gXCIuL3JlZ2lzdHJ5LmpzXCJcbmltcG9ydCB7bm9ybWFsaXplTW91bnRQcmVmaXh9IGZyb20gXCIuL3BhdGgtbWF0Y2hlci5qc1wiXG5cbi8qKlxuICogQXV0aG9yaXplZCBkYXNoYm9hcmQgY291bnQtZGVsdGEgY2hhbm5lbC4gQ2xpZW50cyBzdWJzY3JpYmUgd2l0aCB0aGUgbW91bnRcbiAqIHBhdGggYW5kIHRoZWlyIG5vcm1hbCBiZWFyZXIgdG9rZW4gYXMgYGF1dGhlbnRpY2F0aW9uVG9rZW5gLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9iQ291bnRzQ2hhbm5lbCBleHRlbmRzIFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWwge1xuICAvKipcbiAgICogQXV0aG9yaXplcyB0aGUgc3Vic2NyaXB0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgbW91bnQncyBub3JtYWwgZGFzaGJvYXJkIGF1dGhvcml6YXRpb24gYWxsb3dzIHRoZSBzdWJzY3JpcHRpb24uXG4gICAqL1xuICBhc3luYyBjYW5TdWJzY3JpYmUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBhcmFtcy5tb3VudEF0ICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG1vdW50QXQgPSBub3JtYWxpemVNb3VudFByZWZpeCh0aGlzLnBhcmFtcy5tb3VudEF0KVxuICAgIGNvbnN0IG9wdGlvbnMgPSBnZXRKb2JzTW91bnQodGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb24sIG1vdW50QXQpXG5cbiAgICBpZiAoIW9wdGlvbnMgfHwgIXRoaXMuc2Vzc2lvbi51cGdyYWRlUmVxdWVzdCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0b2tlbiA9IHR5cGVvZiB0aGlzLnBhcmFtcy5hdXRoZW50aWNhdGlvblRva2VuID09PSBcInN0cmluZ1wiXG4gICAgICA/IHRoaXMucGFyYW1zLmF1dGhlbnRpY2F0aW9uVG9rZW5cbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGFiaWxpdHkgPSBhd2FpdCB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvbi5yZXNvbHZlQWJpbGl0eSh7XG4gICAgICBwYXJhbXM6IHRoaXMucGFyYW1zLFxuICAgICAgcmVxdWVzdDogdGhpcy5zZXNzaW9uLnVwZ3JhZGVSZXF1ZXN0XG4gICAgfSlcbiAgICBjb25zdCBhdXRob3JpemVkID0gYXdhaXQgYXV0aG9yaXplSm9ic1JlcXVlc3Qoe1xuICAgICAgYWJpbGl0eSxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIHJlcXVlc3Q6IHRoaXMuc2Vzc2lvbi51cGdyYWRlUmVxdWVzdCxcbiAgICAgIHRva2VuXG4gICAgfSlcblxuICAgIGlmICghYXV0aG9yaXplZCkgcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IG9wdGlvbnMuZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgICB8fCB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLmRhdGFiYXNlSWRlbnRpZmllclxuICAgICAgfHwgXCJkZWZhdWx0XCJcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogTWF0Y2hlcyBvbmx5IGV2ZW50cyBmcm9tIHRoZSBkYXRhYmFzZSBzZWxlY3RlZCBieSB0aGUgYXV0aG9yaXplZCBtb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRKc29uVmFsdWV9IGJyb2FkY2FzdFBhcmFtcyAtIFB1Ymxpc2hlciBzY29wZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhpcyBzdWJzY3JpcHRpb24gc2hvdWxkIHJlY2VpdmUgdGhlIGV2ZW50LlxuICAgKi9cbiAgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpIHtcbiAgICBpZiAoIWJyb2FkY2FzdFBhcmFtcyB8fCB0eXBlb2YgYnJvYWRjYXN0UGFyYW1zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYnJvYWRjYXN0UGFyYW1zKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYnJvYWRjYXN0UGFyYW1zKS5kYXRhYmFzZUlkZW50aWZpZXIpID09PSB0aGlzLmRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IE5vbi1zZW5zaXRpdmUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7ZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcn1cbiAgfVxuXG4gIC8qKiBAdHlwZSB7c3RyaW5nfSAqL1xuICBkYXRhYmFzZUlkZW50aWZpZXIgPSBcIlwiXG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGUgZnJhbWV3b3JrIGNoYW5uZWwgdXNlZCBieSBtb3VudGVkIGpvYnMgZGFzaGJvYXJkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCwgdGhpcylcbiAgfVxufVxuIl19