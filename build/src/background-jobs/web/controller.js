// @ts-check
import Controller from "../../controller.js";
import BackgroundJobsStore from "../store.js";
import { authorizeJobsRequest } from "./authorization.js";
import { getJobsMount } from "./registry.js";
const DASHBOARD_STATUSES = ["queued", "handed_off", "completed", "failed", "orphaned"];
const SORTABLE_KEYS = ["attempts", "completedAtMs", "createdAtMs", "failedAtMs", "handedOffAtMs", "scheduledAtMs"];
const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;
/**
 * Read-only HTTP API backing the background-jobs dashboard. Mounted by
 * {@link import("./index.js").default} as a route-resolver hook so it can ship
 * inside the velocious package. Every action is gated by {@link authorizeJobsRequest}.
 */
export default class VelociousBackgroundJobsWebController extends Controller {
    /**
     * Runs mount options.
     * @returns {import("./registry.js").JobsMountOptions} - Options for the mount that matched this request.
     */
    _mountOptions() {
        const at = this.params().velociousJobsMountAt;
        return getJobsMount(this.getConfiguration(), at) || {};
    }
    /**
     * Runs store.
     * @returns {BackgroundJobsStore} - Jobs store scoped to the mount's database.
     */
    _store() {
        if (!this._jobsStore) {
            this._jobsStore = new BackgroundJobsStore({
                configuration: this.getConfiguration(),
                databaseIdentifier: this._mountOptions().databaseIdentifier
            });
        }
        return this._jobsStore;
    }
    /**
     * Adds CORS headers when the request origin is allowed, so the standalone
     * browser dashboard can read the API cross-origin.
     * @param {import("./registry.js").JobsMountOptions} options - Mount options.
     * @returns {void} - No return value.
     */
    _applyCorsHeaders(options) {
        const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [];
        if (allowedOrigins.length === 0)
            return;
        const origin = this.request().origin();
        const allowAll = allowedOrigins.includes("*");
        if (!origin)
            return;
        if (!allowAll && !allowedOrigins.includes(origin))
            return;
        const response = this.response();
        response.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin);
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    /**
     * Applies CORS headers, authorizes the request, and runs the action body only
     * when authorized. Renders a 401 otherwise. The base controller has no
     * before-action halting, so authorization is enforced here per action.
     * @param {() => Promise<void>} actionFn - Action body.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _respond(actionFn) {
        const options = this._mountOptions();
        this._applyCorsHeaders(options);
        const authorized = await authorizeJobsRequest({
            ability: this.currentAbility(),
            configuration: this.getConfiguration(),
            options,
            request: this.request()
        });
        if (!authorized) {
            await this.render({ json: { error: "unauthorized" }, status: 401 });
            return;
        }
        await actionFn();
    }
    /**
     * Runs health.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async health() {
        await this._respond(async () => {
            const health = await this.getConfiguration().backgroundJobsHealth();
            await this.render({ json: {
                    capabilities: { backgroundJobCountDeltas: 1 },
                    ok: health.ready,
                    ready: health.ready,
                    service: "velocious-background-jobs"
                }, status: health.ready ? 200 : 503 });
        });
    }
    /**
     * Runs stats.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async stats() {
        await this._respond(async () => {
            const snapshot = await this._store().countSnapshot();
            await this.render({ json: {
                    capabilities: { backgroundJobCountDeltas: 1 },
                    counts: snapshot.counts,
                    generatedAtMs: Date.now(),
                    revision: snapshot.revision,
                    total: snapshot.total
                } });
        });
    }
    /**
     * Runs index.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async index() {
        await this._respond(async () => {
            const params = this.params();
            const status = this._sanitizeStatus(params.status);
            const jobName = typeof params.jobName === "string" && params.jobName.length > 0 ? params.jobName : undefined;
            const page = this._positiveInt(params.page, 1);
            const perPage = Math.min(this._positiveInt(params.perPage, DEFAULT_PER_PAGE), MAX_PER_PAGE);
            const { sortColumn, sortDirection } = this._sanitizeSort(params.sort);
            const store = this._store();
            const jobs = await store.listJobs({ jobName, limit: perPage, offset: (page - 1) * perPage, sortColumn, sortDirection, status });
            const total = await store.countJobs({ jobName, status });
            await this.render({ json: {
                    jobs: jobs.map((job) => this._serializeJob(job)),
                    pagination: { page, perPage, total, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 }
                } });
        });
    }
    /**
     * Runs show.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async show() {
        await this._respond(async () => {
            const job = await this._store().getJob(this.params().id);
            if (!job) {
                await this.render({ json: { error: "not_found" }, status: 404 });
                return;
            }
            await this.render({ json: { job: this._serializeJob(job) } });
        });
    }
    /**
     * Runs schedule.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async schedule() {
        await this._respond(async () => {
            const scheduled = await this.getConfiguration().getScheduledBackgroundJobsConfig();
            await this.render({ json: { schedule: this._serializeSchedule(scheduled) } });
        });
    }
    /**
     * Runs serialize job.
     * @param {import("../types.js").BackgroundJobRow} job - Job row.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Serialized job for the API.
     */
    _serializeJob(job) {
        const redactArgs = Boolean(this._mountOptions().redactArgs);
        return {
            args: redactArgs ? undefined : job.args,
            argsRedacted: redactArgs,
            attempts: job.attempts,
            completedAtMs: job.completedAtMs,
            createdAtMs: job.createdAtMs,
            executionMode: job.executionMode,
            failedAtMs: job.failedAtMs,
            handedOffAtMs: job.handedOffAtMs,
            id: job.id,
            jobName: job.jobName,
            lastError: job.lastError,
            maxRetries: job.maxRetries,
            orphanedAtMs: job.orphanedAtMs,
            scheduleKey: job.scheduleKey,
            scheduledAtMs: job.scheduledAtMs,
            status: job.status,
            workerId: job.workerId
        };
    }
    /**
     * Runs serialize schedule.
     * @param {import("../../configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined} scheduled - Scheduled jobs config.
     * @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized recurring jobs.
     */
    _serializeSchedule(scheduled) {
        const jobs = scheduled?.jobs;
        if (!jobs || typeof jobs !== "object")
            return [];
        const redactArgs = Boolean(this._mountOptions().redactArgs);
        return Object.keys(jobs).map((name) => {
            const entry = jobs[name] || /** @type {ReturnType<typeof JSON.parse>} */ ({});
            return {
                args: redactArgs ? undefined : (entry.args || []),
                cron: entry.cron,
                enabled: entry.enabled !== false,
                every: entry.every,
                jobName: typeof entry.class === "function" ? entry.class.name : undefined,
                name,
                options: entry.options || {}
            };
        });
    }
    /**
     * Runs sanitize status.
     * @param {ReturnType<typeof JSON.parse>} value - Raw status param.
     * @returns {string | undefined} - Valid status or undefined.
     */
    _sanitizeStatus(value) {
        return typeof value === "string" && DASHBOARD_STATUSES.includes(value) ? value : undefined;
    }
    /**
     * Runs sanitize sort.
     * @param {ReturnType<typeof JSON.parse>} value - Raw sort param (e.g. "createdAtMs" or "-failedAtMs").
     * @returns {{sortColumn: string, sortDirection: "ASC" | "DESC"}} - Normalized sort.
     */
    _sanitizeSort(value) {
        if (typeof value !== "string" || value.length === 0) {
            return { sortColumn: "createdAtMs", sortDirection: "DESC" };
        }
        const descending = value.startsWith("-");
        const key = descending ? value.slice(1) : value;
        const sortColumn = SORTABLE_KEYS.includes(key) ? key : "createdAtMs";
        return { sortColumn, sortDirection: descending ? "DESC" : "ASC" };
    }
    /**
     * Runs positive int.
     * @param {ReturnType<typeof JSON.parse>} value - Raw numeric param.
     * @param {number} fallback - Fallback when invalid.
     * @returns {number} - Positive integer.
     */
    _positiveInt(value, fallback) {
        const numeric = Number(Array.isArray(value) ? value[0] : value);
        if (!Number.isFinite(numeric) || numeric < 1)
            return fallback;
        return Math.floor(numeric);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvd2ViL2NvbnRyb2xsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sVUFBVSxNQUFNLHFCQUFxQixDQUFBO0FBQzVDLE9BQU8sbUJBQW1CLE1BQU0sYUFBYSxDQUFBO0FBQzdDLE9BQU8sRUFBQyxvQkFBb0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBQ3ZELE9BQU8sRUFBQyxZQUFZLEVBQUMsTUFBTSxlQUFlLENBQUE7QUFFMUMsTUFBTSxrQkFBa0IsR0FBRyxDQUFDLFFBQVEsRUFBRSxZQUFZLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQTtBQUN0RixNQUFNLGFBQWEsR0FBRyxDQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsZUFBZSxDQUFDLENBQUE7QUFDbEgsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7QUFDM0IsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFBO0FBRXhCOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLG9DQUFxQyxTQUFRLFVBQVU7SUFDMUU7OztPQUdHO0lBQ0gsYUFBYTtRQUNYLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQTtRQUU3QyxPQUFPLFlBQVksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsRUFBRSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDSixJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ3JCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxtQkFBbUIsQ0FBQztnQkFDeEMsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFB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LEVBQUMsVUFBVSxFQUFFLGFBQWEsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFDLENBQUE7SUFDakUsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsWUFBWSxDQUFDLEtBQUssRUFBRSxRQUFRO1FBQzFCLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRS9ELElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLE9BQU8sR0FBRyxDQUFDO1lBQUUsT0FBTyxRQUFRLENBQUE7UUFFN0QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQzVCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29udHJvbGxlciBmcm9tIFwiLi4vLi4vY29udHJvbGxlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTdG9yZSBmcm9tIFwiLi4vc3RvcmUuanNcIlxuaW1wb3J0IHthdXRob3JpemVKb2JzUmVxdWVzdH0gZnJvbSBcIi4vYXV0aG9yaXphdGlvbi5qc1wiXG5pbXBvcnQge2dldEpvYnNNb3VudH0gZnJvbSBcIi4vcmVnaXN0cnkuanNcIlxuXG5jb25zdCBEQVNIQk9BUkRfU1RBVFVTRVMgPSBbXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIsIFwiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwib3JwaGFuZWRcIl1cbmNvbnN0IFNPUlRBQkxFX0tFWVMgPSBbXCJhdHRlbXB0c1wiLCBcImNvbXBsZXRlZEF0TXNcIiwgXCJjcmVhdGVkQXRNc1wiLCBcImZhaWxlZEF0TXNcIiwgXCJoYW5kZWRPZmZBdE1zXCIsIFwic2NoZWR1bGVkQXRNc1wiXVxuY29uc3QgREVGQVVMVF9QRVJfUEFHRSA9IDI1XG5jb25zdCBNQVhfUEVSX1BBR0UgPSAxMDBcblxuLyoqXG4gKiBSZWFkLW9ubHkgSFRUUCBBUEkgYmFja2luZyB0aGUgYmFja2dyb3VuZC1qb2JzIGRhc2hib2FyZC4gTW91bnRlZCBieVxuICoge0BsaW5rIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXMgYSByb3V0ZS1yZXNvbHZlciBob29rIHNvIGl0IGNhbiBzaGlwXG4gKiBpbnNpZGUgdGhlIHZlbG9jaW91cyBwYWNrYWdlLiBFdmVyeSBhY3Rpb24gaXMgZ2F0ZWQgYnkge0BsaW5rIGF1dGhvcml6ZUpvYnNSZXF1ZXN0fS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzQmFja2dyb3VuZEpvYnNXZWJDb250cm9sbGVyIGV4dGVuZHMgQ29udHJvbGxlciB7XG4gIC8qKlxuICAgKiBSdW5zIG1vdW50IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JlZ2lzdHJ5LmpzXCIpLkpvYnNNb3VudE9wdGlvbnN9IC0gT3B0aW9ucyBmb3IgdGhlIG1vdW50IHRoYXQgbWF0Y2hlZCB0aGlzIHJlcXVlc3QuXG4gICAqL1xuICBfbW91bnRPcHRpb25zKCkge1xuICAgIGNvbnN0IGF0ID0gdGhpcy5wYXJhbXMoKS52ZWxvY2lvdXNKb2JzTW91bnRBdFxuXG4gICAgcmV0dXJuIGdldEpvYnNNb3VudCh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSwgYXQpIHx8IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9yZS5cbiAgICogQHJldHVybnMge0JhY2tncm91bmRKb2JzU3RvcmV9IC0gSm9icyBzdG9yZSBzY29wZWQgdG8gdGhlIG1vdW50J3MgZGF0YWJhc2UuXG4gICAqL1xuICBfc3RvcmUoKSB7XG4gICAgaWYgKCF0aGlzLl9qb2JzU3RvcmUpIHtcbiAgICAgIHRoaXMuX2pvYnNTdG9yZSA9IG5ldyBCYWNrZ3JvdW5kSm9ic1N0b3JlKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5fbW91bnRPcHRpb25zKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9qb2JzU3RvcmVcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIENPUlMgaGVhZGVycyB3aGVuIHRoZSByZXF1ZXN0IG9yaWdpbiBpcyBhbGxvd2VkLCBzbyB0aGUgc3RhbmRhbG9uZVxuICAgKiBicm93c2VyIGRhc2hib2FyZCBjYW4gcmVhZCB0aGUgQVBJIGNyb3NzLW9yaWdpbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlZ2lzdHJ5LmpzXCIpLkpvYnNNb3VudE9wdGlvbnN9IG9wdGlvbnMgLSBNb3VudCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXBwbHlDb3JzSGVhZGVycyhvcHRpb25zKSB7XG4gICAgY29uc3QgYWxsb3dlZE9yaWdpbnMgPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuYWxsb3dlZE9yaWdpbnMpID8gb3B0aW9ucy5hbGxvd2VkT3JpZ2lucyA6IFtdXG5cbiAgICBpZiAoYWxsb3dlZE9yaWdpbnMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IG9yaWdpbiA9IHRoaXMucmVxdWVzdCgpLm9yaWdpbigpXG4gICAgY29uc3QgYWxsb3dBbGwgPSBhbGxvd2VkT3JpZ2lucy5pbmNsdWRlcyhcIipcIilcblxuICAgIGlmICghb3JpZ2luKSByZXR1cm5cbiAgICBpZiAoIWFsbG93QWxsICYmICFhbGxvd2VkT3JpZ2lucy5pbmNsdWRlcyhvcmlnaW4pKSByZXR1cm5cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gdGhpcy5yZXNwb25zZSgpXG5cbiAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIiwgYWxsb3dBbGwgPyBcIipcIiA6IG9yaWdpbilcbiAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJWYXJ5XCIsIFwiT3JpZ2luXCIpXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiLCBcImF1dGhvcml6YXRpb24sIGNvbnRlbnQtdHlwZVwiKVxuICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHNcIiwgXCJHRVQsIFBPU1QsIERFTEVURSwgT1BUSU9OU1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgQ09SUyBoZWFkZXJzLCBhdXRob3JpemVzIHRoZSByZXF1ZXN0LCBhbmQgcnVucyB0aGUgYWN0aW9uIGJvZHkgb25seVxuICAgKiB3aGVuIGF1dGhvcml6ZWQuIFJlbmRlcnMgYSA0MDEgb3RoZXJ3aXNlLiBUaGUgYmFzZSBjb250cm9sbGVyIGhhcyBub1xuICAgKiBiZWZvcmUtYWN0aW9uIGhhbHRpbmcsIHNvIGF1dGhvcml6YXRpb24gaXMgZW5mb3JjZWQgaGVyZSBwZXIgYWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGFjdGlvbkZuIC0gQWN0aW9uIGJvZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVzcG9uZChhY3Rpb25Gbikge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLl9tb3VudE9wdGlvbnMoKVxuXG4gICAgdGhpcy5fYXBwbHlDb3JzSGVhZGVycyhvcHRpb25zKVxuXG4gICAgY29uc3QgYXV0aG9yaXplZCA9IGF3YWl0IGF1dGhvcml6ZUpvYnNSZXF1ZXN0KHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuY3VycmVudEFiaWxpdHkoKSxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCgpXG4gICAgfSlcblxuICAgIGlmICghYXV0aG9yaXplZCkge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe2pzb246IHtlcnJvcjogXCJ1bmF1dGhvcml6ZWRcIn0sIHN0YXR1czogNDAxfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IGFjdGlvbkZuKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhlYWx0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGhlYWx0aCgpIHtcbiAgICBhd2FpdCB0aGlzLl9yZXNwb25kKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGhlYWx0aCA9IGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmJhY2tncm91bmRKb2JzSGVhbHRoKClcblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe2pzb246IHtcbiAgICAgICAgY2FwYWJpbGl0aWVzOiB7YmFja2dyb3VuZEpvYkNvdW50RGVsdGFzOiAxfSxcbiAgICAgICAgb2s6IGhlYWx0aC5yZWFkeSxcbiAgICAgICAgcmVhZHk6IGhlYWx0aC5yZWFkeSxcbiAgICAgICAgc2VydmljZTogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2JzXCJcbiAgICAgIH0sIHN0YXR1czogaGVhbHRoLnJlYWR5ID8gMjAwIDogNTAzfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzdGF0cygpIHtcbiAgICBhd2FpdCB0aGlzLl9yZXNwb25kKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5fc3RvcmUoKS5jb3VudFNuYXBzaG90KClcblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe2pzb246IHtcbiAgICAgICAgY2FwYWJpbGl0aWVzOiB7YmFja2dyb3VuZEpvYkNvdW50RGVsdGFzOiAxfSxcbiAgICAgICAgY291bnRzOiBzbmFwc2hvdC5jb3VudHMsXG4gICAgICAgIGdlbmVyYXRlZEF0TXM6IERhdGUubm93KCksXG4gICAgICAgIHJldmlzaW9uOiBzbmFwc2hvdC5yZXZpc2lvbixcbiAgICAgICAgdG90YWw6IHNuYXBzaG90LnRvdGFsXG4gICAgICB9fSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5kZXguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbmRleCgpIHtcbiAgICBhd2FpdCB0aGlzLl9yZXNwb25kKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMucGFyYW1zKClcbiAgICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMuX3Nhbml0aXplU3RhdHVzKHBhcmFtcy5zdGF0dXMpXG4gICAgICBjb25zdCBqb2JOYW1lID0gdHlwZW9mIHBhcmFtcy5qb2JOYW1lID09PSBcInN0cmluZ1wiICYmIHBhcmFtcy5qb2JOYW1lLmxlbmd0aCA+IDAgPyBwYXJhbXMuam9iTmFtZSA6IHVuZGVmaW5lZFxuICAgICAgY29uc3QgcGFnZSA9IHRoaXMuX3Bvc2l0aXZlSW50KHBhcmFtcy5wYWdlLCAxKVxuICAgICAgY29uc3QgcGVyUGFnZSA9IE1hdGgubWluKHRoaXMuX3Bvc2l0aXZlSW50KHBhcmFtcy5wZXJQYWdlLCBERUZBVUxUX1BFUl9QQUdFKSwgTUFYX1BFUl9QQUdFKVxuICAgICAgY29uc3Qge3NvcnRDb2x1bW4sIHNvcnREaXJlY3Rpb259ID0gdGhpcy5fc2FuaXRpemVTb3J0KHBhcmFtcy5zb3J0KVxuICAgICAgY29uc3Qgc3RvcmUgPSB0aGlzLl9zdG9yZSgpXG4gICAgICBjb25zdCBqb2JzID0gYXdhaXQgc3RvcmUubGlzdEpvYnMoe2pvYk5hbWUsIGxpbWl0OiBwZXJQYWdlLCBvZmZzZXQ6IChwYWdlIC0gMSkgKiBwZXJQYWdlLCBzb3J0Q29sdW1uLCBzb3J0RGlyZWN0aW9uLCBzdGF0dXN9KVxuICAgICAgY29uc3QgdG90YWwgPSBhd2FpdCBzdG9yZS5jb3VudEpvYnMoe2pvYk5hbWUsIHN0YXR1c30pXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiB7XG4gICAgICAgIGpvYnM6IGpvYnMubWFwKChqb2IpID0+IHRoaXMuX3NlcmlhbGl6ZUpvYihqb2IpKSxcbiAgICAgICAgcGFnaW5hdGlvbjoge3BhZ2UsIHBlclBhZ2UsIHRvdGFsLCB0b3RhbFBhZ2VzOiBwZXJQYWdlID4gMCA/IE1hdGguY2VpbCh0b3RhbCAvIHBlclBhZ2UpIDogMH1cbiAgICAgIH19KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2hvdygpIHtcbiAgICBhd2FpdCB0aGlzLl9yZXNwb25kKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX3N0b3JlKCkuZ2V0Sm9iKHRoaXMucGFyYW1zKCkuaWQpXG5cbiAgICAgIGlmICgham9iKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiB7ZXJyb3I6IFwibm90X2ZvdW5kXCJ9LCBzdGF0dXM6IDQwNH0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7anNvbjoge2pvYjogdGhpcy5fc2VyaWFsaXplSm9iKGpvYil9fSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZWR1bGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzY2hlZHVsZSgpIHtcbiAgICBhd2FpdCB0aGlzLl9yZXNwb25kKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVkdWxlZCA9IGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldFNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnKClcblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe2pzb246IHtzY2hlZHVsZTogdGhpcy5fc2VyaWFsaXplU2NoZWR1bGUoc2NoZWR1bGVkKX19KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VyaWFsaXplZCBqb2IgZm9yIHRoZSBBUEkuXG4gICAqL1xuICBfc2VyaWFsaXplSm9iKGpvYikge1xuICAgIGNvbnN0IHJlZGFjdEFyZ3MgPSBCb29sZWFuKHRoaXMuX21vdW50T3B0aW9ucygpLnJlZGFjdEFyZ3MpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYXJnczogcmVkYWN0QXJncyA/IHVuZGVmaW5lZCA6IGpvYi5hcmdzLFxuICAgICAgYXJnc1JlZGFjdGVkOiByZWRhY3RBcmdzLFxuICAgICAgYXR0ZW1wdHM6IGpvYi5hdHRlbXB0cyxcbiAgICAgIGNvbXBsZXRlZEF0TXM6IGpvYi5jb21wbGV0ZWRBdE1zLFxuICAgICAgY3JlYXRlZEF0TXM6IGpvYi5jcmVhdGVkQXRNcyxcbiAgICAgIGV4ZWN1dGlvbk1vZGU6IGpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgZmFpbGVkQXRNczogam9iLmZhaWxlZEF0TXMsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBqb2IuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIGlkOiBqb2IuaWQsXG4gICAgICBqb2JOYW1lOiBqb2Iuam9iTmFtZSxcbiAgICAgIGxhc3RFcnJvcjogam9iLmxhc3RFcnJvcixcbiAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzLFxuICAgICAgb3JwaGFuZWRBdE1zOiBqb2Iub3JwaGFuZWRBdE1zLFxuICAgICAgc2NoZWR1bGVLZXk6IGpvYi5zY2hlZHVsZUtleSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IGpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc3RhdHVzOiBqb2Iuc3RhdHVzLFxuICAgICAgd29ya2VySWQ6IGpvYi53b3JrZXJJZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6ZSBzY2hlZHVsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gc2NoZWR1bGVkIC0gU2NoZWR1bGVkIGpvYnMgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIHJlY3VycmluZyBqb2JzLlxuICAgKi9cbiAgX3NlcmlhbGl6ZVNjaGVkdWxlKHNjaGVkdWxlZCkge1xuICAgIGNvbnN0IGpvYnMgPSBzY2hlZHVsZWQ/LmpvYnNcblxuICAgIGlmICgham9icyB8fCB0eXBlb2Ygam9icyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIFtdXG5cbiAgICBjb25zdCByZWRhY3RBcmdzID0gQm9vbGVhbih0aGlzLl9tb3VudE9wdGlvbnMoKS5yZWRhY3RBcmdzKVxuXG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKGpvYnMpLm1hcCgobmFtZSkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSBqb2JzW25hbWVdIHx8IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh7fSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYXJnczogcmVkYWN0QXJncyA/IHVuZGVmaW5lZCA6IChlbnRyeS5hcmdzIHx8IFtdKSxcbiAgICAgICAgY3JvbjogZW50cnkuY3JvbixcbiAgICAgICAgZW5hYmxlZDogZW50cnkuZW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgICAgIGV2ZXJ5OiBlbnRyeS5ldmVyeSxcbiAgICAgICAgam9iTmFtZTogdHlwZW9mIGVudHJ5LmNsYXNzID09PSBcImZ1bmN0aW9uXCIgPyBlbnRyeS5jbGFzcy5uYW1lIDogdW5kZWZpbmVkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBvcHRpb25zOiBlbnRyeS5vcHRpb25zIHx8IHt9XG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhbml0aXplIHN0YXR1cy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBSYXcgc3RhdHVzIHBhcmFtLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFZhbGlkIHN0YXR1cyBvciB1bmRlZmluZWQuXG4gICAqL1xuICBfc2FuaXRpemVTdGF0dXModmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIERBU0hCT0FSRF9TVEFUVVNFUy5pbmNsdWRlcyh2YWx1ZSkgPyB2YWx1ZSA6IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2FuaXRpemUgc29ydC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBSYXcgc29ydCBwYXJhbSAoZS5nLiBcImNyZWF0ZWRBdE1zXCIgb3IgXCItZmFpbGVkQXRNc1wiKS5cbiAgICogQHJldHVybnMge3tzb3J0Q29sdW1uOiBzdHJpbmcsIHNvcnREaXJlY3Rpb246IFwiQVNDXCIgfCBcIkRFU0NcIn19IC0gTm9ybWFsaXplZCBzb3J0LlxuICAgKi9cbiAgX3Nhbml0aXplU29ydCh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgdmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4ge3NvcnRDb2x1bW46IFwiY3JlYXRlZEF0TXNcIiwgc29ydERpcmVjdGlvbjogXCJERVNDXCJ9XG4gICAgfVxuXG4gICAgY29uc3QgZGVzY2VuZGluZyA9IHZhbHVlLnN0YXJ0c1dpdGgoXCItXCIpXG4gICAgY29uc3Qga2V5ID0gZGVzY2VuZGluZyA/IHZhbHVlLnNsaWNlKDEpIDogdmFsdWVcbiAgICBjb25zdCBzb3J0Q29sdW1uID0gU09SVEFCTEVfS0VZUy5pbmNsdWRlcyhrZXkpID8ga2V5IDogXCJjcmVhdGVkQXRNc1wiXG5cbiAgICByZXR1cm4ge3NvcnRDb2x1bW4sIHNvcnREaXJlY3Rpb246IGRlc2NlbmRpbmcgPyBcIkRFU0NcIiA6IFwiQVNDXCJ9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwb3NpdGl2ZSBpbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUmF3IG51bWVyaWMgcGFyYW0uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBmYWxsYmFjayAtIEZhbGxiYWNrIHdoZW4gaW52YWxpZC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBQb3NpdGl2ZSBpbnRlZ2VyLlxuICAgKi9cbiAgX3Bvc2l0aXZlSW50KHZhbHVlLCBmYWxsYmFjaykge1xuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIoQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZVswXSA6IHZhbHVlKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobnVtZXJpYykgfHwgbnVtZXJpYyA8IDEpIHJldHVybiBmYWxsYmFja1xuXG4gICAgcmV0dXJuIE1hdGguZmxvb3IobnVtZXJpYylcbiAgfVxufVxuIl19