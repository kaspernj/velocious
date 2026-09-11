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
            childInstanceId: job.childInstanceId,
            childPid: job.childPid,
            childReceivedAtMs: job.childReceivedAtMs,
            childStartedAtMs: job.childStartedAtMs,
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
            scheduleOrder: job.scheduleOrder,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvd2ViL2NvbnRyb2xsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sVUFBVSxNQUFNLHFCQUFxQixDQUFBO0FBQzVDLE9BQU8sbUJBQW1CLE1BQU0sYUFBYSxDQUFBO0FBQzdDLE9BQU8sRUFBQyxvQkFBb0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBQ3ZELE9BQU8sRUFBQyxZQUFZLEVBQUMsTUFBTSxlQUFlLENBQUE7QUFFMUMsTUFBTSxrQkFBa0IsR0FBRyxDQUFDLFFBQVEsRUFBRSxZQUFZLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQTtBQUN0RixNQUFNLGFBQWEsR0FBRyxDQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsZUFBZSxDQUFDLENBQUE7QUFDbEgsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7QUFDM0IsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFBO0FBRXhCOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLG9DQUFxQyxTQUFRLFVBQVU7SUFDMUU7OztPQUdHO0lBQ0gsYUFBYTtRQUNYLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQTtRQUU3QyxPQUFPLFlBQVksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsRUFBRSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDSixJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ3JCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxtQkFBbUIsQ0FBQztnQkFDeEMsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFB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QyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUE7UUFDL0MsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUE7UUFFcEUsT0FBTyxFQUFDLFVBQVUsRUFBRSxhQUFhLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBQyxDQUFBO0lBQ2pFLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFlBQVksQ0FBQyxLQUFLLEVBQUUsUUFBUTtRQUMxQixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUUvRCxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxPQUFPLEdBQUcsQ0FBQztZQUFFLE9BQU8sUUFBUSxDQUFBO1FBRTdELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUM1QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbnRyb2xsZXIgZnJvbSBcIi4uLy4uL2NvbnRyb2xsZXIuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU3RvcmUgZnJvbSBcIi4uL3N0b3JlLmpzXCJcbmltcG9ydCB7YXV0aG9yaXplSm9ic1JlcXVlc3R9IGZyb20gXCIuL2F1dGhvcml6YXRpb24uanNcIlxuaW1wb3J0IHtnZXRKb2JzTW91bnR9IGZyb20gXCIuL3JlZ2lzdHJ5LmpzXCJcblxuY29uc3QgREFTSEJPQVJEX1NUQVRVU0VTID0gW1wicXVldWVkXCIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcIm9ycGhhbmVkXCJdXG5jb25zdCBTT1JUQUJMRV9LRVlTID0gW1wiYXR0ZW1wdHNcIiwgXCJjb21wbGV0ZWRBdE1zXCIsIFwiY3JlYXRlZEF0TXNcIiwgXCJmYWlsZWRBdE1zXCIsIFwiaGFuZGVkT2ZmQXRNc1wiLCBcInNjaGVkdWxlZEF0TXNcIl1cbmNvbnN0IERFRkFVTFRfUEVSX1BBR0UgPSAyNVxuY29uc3QgTUFYX1BFUl9QQUdFID0gMTAwXG5cbi8qKlxuICogUmVhZC1vbmx5IEhUVFAgQVBJIGJhY2tpbmcgdGhlIGJhY2tncm91bmQtam9icyBkYXNoYm9hcmQuIE1vdW50ZWQgYnlcbiAqIHtAbGluayBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFzIGEgcm91dGUtcmVzb2x2ZXIgaG9vayBzbyBpdCBjYW4gc2hpcFxuICogaW5zaWRlIHRoZSB2ZWxvY2lvdXMgcGFja2FnZS4gRXZlcnkgYWN0aW9uIGlzIGdhdGVkIGJ5IHtAbGluayBhdXRob3JpemVKb2JzUmVxdWVzdH0uXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0JhY2tncm91bmRKb2JzV2ViQ29udHJvbGxlciBleHRlbmRzIENvbnRyb2xsZXIge1xuICAvKipcbiAgICogUnVucyBtb3VudCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9yZWdpc3RyeS5qc1wiKS5Kb2JzTW91bnRPcHRpb25zfSAtIE9wdGlvbnMgZm9yIHRoZSBtb3VudCB0aGF0IG1hdGNoZWQgdGhpcyByZXF1ZXN0LlxuICAgKi9cbiAgX21vdW50T3B0aW9ucygpIHtcbiAgICBjb25zdCBhdCA9IHRoaXMucGFyYW1zKCkudmVsb2Npb3VzSm9ic01vdW50QXRcblxuICAgIHJldHVybiBnZXRKb2JzTW91bnQodGhpcy5nZXRDb25maWd1cmF0aW9uKCksIGF0KSB8fCB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcmUuXG4gICAqIEByZXR1cm5zIHtCYWNrZ3JvdW5kSm9ic1N0b3JlfSAtIEpvYnMgc3RvcmUgc2NvcGVkIHRvIHRoZSBtb3VudCdzIGRhdGFiYXNlLlxuICAgKi9cbiAgX3N0b3JlKCkge1xuICAgIGlmICghdGhpcy5fam9ic1N0b3JlKSB7XG4gICAgICB0aGlzLl9qb2JzU3RvcmUgPSBuZXcgQmFja2dyb3VuZEpvYnNTdG9yZSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuX21vdW50T3B0aW9ucygpLmRhdGFiYXNlSWRlbnRpZmllclxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fam9ic1N0b3JlXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBDT1JTIGhlYWRlcnMgd2hlbiB0aGUgcmVxdWVzdCBvcmlnaW4gaXMgYWxsb3dlZCwgc28gdGhlIHN0YW5kYWxvbmVcbiAgICogYnJvd3NlciBkYXNoYm9hcmQgY2FuIHJlYWQgdGhlIEFQSSBjcm9zcy1vcmlnaW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZWdpc3RyeS5qc1wiKS5Kb2JzTW91bnRPcHRpb25zfSBvcHRpb25zIC0gTW91bnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2FwcGx5Q29yc0hlYWRlcnMob3B0aW9ucykge1xuICAgIGNvbnN0IGFsbG93ZWRPcmlnaW5zID0gQXJyYXkuaXNBcnJheShvcHRpb25zLmFsbG93ZWRPcmlnaW5zKSA/IG9wdGlvbnMuYWxsb3dlZE9yaWdpbnMgOiBbXVxuXG4gICAgaWYgKGFsbG93ZWRPcmlnaW5zLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBvcmlnaW4gPSB0aGlzLnJlcXVlc3QoKS5vcmlnaW4oKVxuICAgIGNvbnN0IGFsbG93QWxsID0gYWxsb3dlZE9yaWdpbnMuaW5jbHVkZXMoXCIqXCIpXG5cbiAgICBpZiAoIW9yaWdpbikgcmV0dXJuXG4gICAgaWYgKCFhbGxvd0FsbCAmJiAhYWxsb3dlZE9yaWdpbnMuaW5jbHVkZXMob3JpZ2luKSkgcmV0dXJuXG5cbiAgICBjb25zdCByZXNwb25zZSA9IHRoaXMucmVzcG9uc2UoKVxuXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIsIGFsbG93QWxsID8gXCIqXCIgOiBvcmlnaW4pXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiVmFyeVwiLCBcIk9yaWdpblwiKVxuICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnNcIiwgXCJhdXRob3JpemF0aW9uLCBjb250ZW50LXR5cGVcIilcbiAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzXCIsIFwiR0VULCBQT1NULCBERUxFVEUsIE9QVElPTlNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIENPUlMgaGVhZGVycywgYXV0aG9yaXplcyB0aGUgcmVxdWVzdCwgYW5kIHJ1bnMgdGhlIGFjdGlvbiBib2R5IG9ubHlcbiAgICogd2hlbiBhdXRob3JpemVkLiBSZW5kZXJzIGEgNDAxIG90aGVyd2lzZS4gVGhlIGJhc2UgY29udHJvbGxlciBoYXMgbm9cbiAgICogYmVmb3JlLWFjdGlvbiBoYWx0aW5nLCBzbyBhdXRob3JpemF0aW9uIGlzIGVuZm9yY2VkIGhlcmUgcGVyIGFjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBhY3Rpb25GbiAtIEFjdGlvbiBib2R5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3Jlc3BvbmQoYWN0aW9uRm4pIHtcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fbW91bnRPcHRpb25zKClcblxuICAgIHRoaXMuX2FwcGx5Q29yc0hlYWRlcnMob3B0aW9ucylcblxuICAgIGNvbnN0IGF1dGhvcml6ZWQgPSBhd2FpdCBhdXRob3JpemVKb2JzUmVxdWVzdCh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmN1cnJlbnRBYmlsaXR5KCksXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIG9wdGlvbnMsXG4gICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QoKVxuICAgIH0pXG5cbiAgICBpZiAoIWF1dGhvcml6ZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiB7ZXJyb3I6IFwidW5hdXRob3JpemVkXCJ9LCBzdGF0dXM6IDQwMX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCBhY3Rpb25GbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoZWFsdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBoZWFsdGgoKSB7XG4gICAgYXdhaXQgdGhpcy5fcmVzcG9uZChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBoZWFsdGggPSBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5iYWNrZ3JvdW5kSm9ic0hlYWx0aCgpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiB7XG4gICAgICAgIGNhcGFiaWxpdGllczoge2JhY2tncm91bmRKb2JDb3VudERlbHRhczogMX0sXG4gICAgICAgIG9rOiBoZWFsdGgucmVhZHksXG4gICAgICAgIHJlYWR5OiBoZWFsdGgucmVhZHksXG4gICAgICAgIHNlcnZpY2U6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9ic1wiXG4gICAgICB9LCBzdGF0dXM6IGhlYWx0aC5yZWFkeSA/IDIwMCA6IDUwM30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc3RhdHMoKSB7XG4gICAgYXdhaXQgdGhpcy5fcmVzcG9uZChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX3N0b3JlKCkuY291bnRTbmFwc2hvdCgpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiB7XG4gICAgICAgIGNhcGFiaWxpdGllczoge2JhY2tncm91bmRKb2JDb3VudERlbHRhczogMX0sXG4gICAgICAgIGNvdW50czogc25hcHNob3QuY291bnRzLFxuICAgICAgICBnZW5lcmF0ZWRBdE1zOiBEYXRlLm5vdygpLFxuICAgICAgICByZXZpc2lvbjogc25hcHNob3QucmV2aXNpb24sXG4gICAgICAgIHRvdGFsOiBzbmFwc2hvdC50b3RhbFxuICAgICAgfX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5kZXgoKSB7XG4gICAgYXdhaXQgdGhpcy5fcmVzcG9uZChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwYXJhbXMgPSB0aGlzLnBhcmFtcygpXG4gICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLl9zYW5pdGl6ZVN0YXR1cyhwYXJhbXMuc3RhdHVzKVxuICAgICAgY29uc3Qgam9iTmFtZSA9IHR5cGVvZiBwYXJhbXMuam9iTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBwYXJhbXMuam9iTmFtZS5sZW5ndGggPiAwID8gcGFyYW1zLmpvYk5hbWUgOiB1bmRlZmluZWRcbiAgICAgIGNvbnN0IHBhZ2UgPSB0aGlzLl9wb3NpdGl2ZUludChwYXJhbXMucGFnZSwgMSlcbiAgICAgIGNvbnN0IHBlclBhZ2UgPSBNYXRoLm1pbih0aGlzLl9wb3NpdGl2ZUludChwYXJhbXMucGVyUGFnZSwgREVGQVVMVF9QRVJfUEFHRSksIE1BWF9QRVJfUEFHRSlcbiAgICAgIGNvbnN0IHtzb3J0Q29sdW1uLCBzb3J0RGlyZWN0aW9ufSA9IHRoaXMuX3Nhbml0aXplU29ydChwYXJhbXMuc29ydClcbiAgICAgIGNvbnN0IHN0b3JlID0gdGhpcy5fc3RvcmUoKVxuICAgICAgY29uc3Qgam9icyA9IGF3YWl0IHN0b3JlLmxpc3RKb2JzKHtqb2JOYW1lLCBsaW1pdDogcGVyUGFnZSwgb2Zmc2V0OiAocGFnZSAtIDEpICogcGVyUGFnZSwgc29ydENvbHVtbiwgc29ydERpcmVjdGlvbiwgc3RhdHVzfSlcbiAgICAgIGNvbnN0IHRvdGFsID0gYXdhaXQgc3RvcmUuY291bnRKb2JzKHtqb2JOYW1lLCBzdGF0dXN9KVxuXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7anNvbjoge1xuICAgICAgICBqb2JzOiBqb2JzLm1hcCgoam9iKSA9PiB0aGlzLl9zZXJpYWxpemVKb2Ioam9iKSksXG4gICAgICAgIHBhZ2luYXRpb246IHtwYWdlLCBwZXJQYWdlLCB0b3RhbCwgdG90YWxQYWdlczogcGVyUGFnZSA+IDAgPyBNYXRoLmNlaWwodG90YWwgLyBwZXJQYWdlKSA6IDB9XG4gICAgICB9fSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNob3coKSB7XG4gICAgYXdhaXQgdGhpcy5fcmVzcG9uZChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9zdG9yZSgpLmdldEpvYih0aGlzLnBhcmFtcygpLmlkKVxuXG4gICAgICBpZiAoIWpvYikge1xuICAgICAgICBhd2FpdCB0aGlzLnJlbmRlcih7anNvbjoge2Vycm9yOiBcIm5vdF9mb3VuZFwifSwgc3RhdHVzOiA0MDR9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe2pzb246IHtqb2I6IHRoaXMuX3NlcmlhbGl6ZUpvYihqb2IpfX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVkdWxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2NoZWR1bGUoKSB7XG4gICAgYXdhaXQgdGhpcy5fcmVzcG9uZChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlZHVsZWQgPSBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtqc29uOiB7c2NoZWR1bGU6IHRoaXMuX3NlcmlhbGl6ZVNjaGVkdWxlKHNjaGVkdWxlZCl9fSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNlcmlhbGl6ZWQgam9iIGZvciB0aGUgQVBJLlxuICAgKi9cbiAgX3NlcmlhbGl6ZUpvYihqb2IpIHtcbiAgICBjb25zdCByZWRhY3RBcmdzID0gQm9vbGVhbih0aGlzLl9tb3VudE9wdGlvbnMoKS5yZWRhY3RBcmdzKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3M6IHJlZGFjdEFyZ3MgPyB1bmRlZmluZWQgOiBqb2IuYXJncyxcbiAgICAgIGFyZ3NSZWRhY3RlZDogcmVkYWN0QXJncyxcbiAgICAgIGF0dGVtcHRzOiBqb2IuYXR0ZW1wdHMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IGpvYi5jaGlsZEluc3RhbmNlSWQsXG4gICAgICBjaGlsZFBpZDogam9iLmNoaWxkUGlkLFxuICAgICAgY2hpbGRSZWNlaXZlZEF0TXM6IGpvYi5jaGlsZFJlY2VpdmVkQXRNcyxcbiAgICAgIGNoaWxkU3RhcnRlZEF0TXM6IGpvYi5jaGlsZFN0YXJ0ZWRBdE1zLFxuICAgICAgY29tcGxldGVkQXRNczogam9iLmNvbXBsZXRlZEF0TXMsXG4gICAgICBjcmVhdGVkQXRNczogam9iLmNyZWF0ZWRBdE1zLFxuICAgICAgZXhlY3V0aW9uTW9kZTogam9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICBmYWlsZWRBdE1zOiBqb2IuZmFpbGVkQXRNcyxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IGpvYi5oYW5kZWRPZmZBdE1zLFxuICAgICAgaWQ6IGpvYi5pZCxcbiAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgbGFzdEVycm9yOiBqb2IubGFzdEVycm9yLFxuICAgICAgbWF4UmV0cmllczogam9iLm1heFJldHJpZXMsXG4gICAgICBvcnBoYW5lZEF0TXM6IGpvYi5vcnBoYW5lZEF0TXMsXG4gICAgICBzY2hlZHVsZUtleTogam9iLnNjaGVkdWxlS2V5LFxuICAgICAgc2NoZWR1bGVPcmRlcjogam9iLnNjaGVkdWxlT3JkZXIsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBqb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgIHdvcmtlcklkOiBqb2Iud29ya2VySWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUgc2NoZWR1bGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9IHNjaGVkdWxlZCAtIFNjaGVkdWxlZCBqb2JzIGNvbmZpZy5cbiAgICogQHJldHVybnMge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2VyaWFsaXplZCByZWN1cnJpbmcgam9icy5cbiAgICovXG4gIF9zZXJpYWxpemVTY2hlZHVsZShzY2hlZHVsZWQpIHtcbiAgICBjb25zdCBqb2JzID0gc2NoZWR1bGVkPy5qb2JzXG5cbiAgICBpZiAoIWpvYnMgfHwgdHlwZW9mIGpvYnMgIT09IFwib2JqZWN0XCIpIHJldHVybiBbXVxuXG4gICAgY29uc3QgcmVkYWN0QXJncyA9IEJvb2xlYW4odGhpcy5fbW91bnRPcHRpb25zKCkucmVkYWN0QXJncylcblxuICAgIHJldHVybiBPYmplY3Qua2V5cyhqb2JzKS5tYXAoKG5hbWUpID0+IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gam9ic1tuYW1lXSB8fCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoe30pXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFyZ3M6IHJlZGFjdEFyZ3MgPyB1bmRlZmluZWQgOiAoZW50cnkuYXJncyB8fCBbXSksXG4gICAgICAgIGNyb246IGVudHJ5LmNyb24sXG4gICAgICAgIGVuYWJsZWQ6IGVudHJ5LmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgICBldmVyeTogZW50cnkuZXZlcnksXG4gICAgICAgIGpvYk5hbWU6IHR5cGVvZiBlbnRyeS5jbGFzcyA9PT0gXCJmdW5jdGlvblwiID8gZW50cnkuY2xhc3MubmFtZSA6IHVuZGVmaW5lZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgb3B0aW9uczogZW50cnkub3B0aW9ucyB8fCB7fVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzYW5pdGl6ZSBzdGF0dXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUmF3IHN0YXR1cyBwYXJhbS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBWYWxpZCBzdGF0dXMgb3IgdW5kZWZpbmVkLlxuICAgKi9cbiAgX3Nhbml0aXplU3RhdHVzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBEQVNIQk9BUkRfU1RBVFVTRVMuaW5jbHVkZXModmFsdWUpID8gdmFsdWUgOiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhbml0aXplIHNvcnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUmF3IHNvcnQgcGFyYW0gKGUuZy4gXCJjcmVhdGVkQXRNc1wiIG9yIFwiLWZhaWxlZEF0TXNcIikuXG4gICAqIEByZXR1cm5zIHt7c29ydENvbHVtbjogc3RyaW5nLCBzb3J0RGlyZWN0aW9uOiBcIkFTQ1wiIHwgXCJERVNDXCJ9fSAtIE5vcm1hbGl6ZWQgc29ydC5cbiAgICovXG4gIF9zYW5pdGl6ZVNvcnQodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHtzb3J0Q29sdW1uOiBcImNyZWF0ZWRBdE1zXCIsIHNvcnREaXJlY3Rpb246IFwiREVTQ1wifVxuICAgIH1cblxuICAgIGNvbnN0IGRlc2NlbmRpbmcgPSB2YWx1ZS5zdGFydHNXaXRoKFwiLVwiKVxuICAgIGNvbnN0IGtleSA9IGRlc2NlbmRpbmcgPyB2YWx1ZS5zbGljZSgxKSA6IHZhbHVlXG4gICAgY29uc3Qgc29ydENvbHVtbiA9IFNPUlRBQkxFX0tFWVMuaW5jbHVkZXMoa2V5KSA/IGtleSA6IFwiY3JlYXRlZEF0TXNcIlxuXG4gICAgcmV0dXJuIHtzb3J0Q29sdW1uLCBzb3J0RGlyZWN0aW9uOiBkZXNjZW5kaW5nID8gXCJERVNDXCIgOiBcIkFTQ1wifVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcG9zaXRpdmUgaW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFJhdyBudW1lcmljIHBhcmFtLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZmFsbGJhY2sgLSBGYWxsYmFjayB3aGVuIGludmFsaWQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUG9zaXRpdmUgaW50ZWdlci5cbiAgICovXG4gIF9wb3NpdGl2ZUludCh2YWx1ZSwgZmFsbGJhY2spIHtcbiAgICBjb25zdCBudW1lcmljID0gTnVtYmVyKEFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWVbMF0gOiB2YWx1ZSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG51bWVyaWMpIHx8IG51bWVyaWMgPCAxKSByZXR1cm4gZmFsbGJhY2tcblxuICAgIHJldHVybiBNYXRoLmZsb29yKG51bWVyaWMpXG4gIH1cbn1cbiJdfQ==